// server.mjs
import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ------------------------------------------------------------------
// Serve static front‑end
// ------------------------------------------------------------------
app.use(express.static(path.join(__dirname, "public")));

// ------------------------------------------------------------------
// Config (read from .env, with sensible fall‑backs)
// ------------------------------------------------------------------
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT =
  process.env.OPENAI_ENDPOINT ||
  "https://api.openai.com/v1/chat/completions"; // default = OpenAI
const MODEL = "gpt-4o-mini";

// ------------------------------------------------------------------
// Helper – build the message list for OpenAI
// ------------------------------------------------------------------
function buildMessages({ history = [], state = {} }) {
  const msgs = [];

  // ----------------------------------------------------------------
  // 1️⃣ System message – tells the model what it can modify
  // ----------------------------------------------------------------
  const system = `
You are a front‑end assistant. The user is editing a web page.
The HTML you're working on is placed inside the the #demo-root element of a following structure
\`\`\`html
<!DOCTYPE html>
<html lang="en">
 <head>
  <meta charset="UTF-8">
  <title>WIP</title>
  <style id="demo-style">/* CSS you return is placed here (and to document.adoptedStyleSheets) */</style>
 </head>
 <body id="demo-root"><!-- Demo area – HTML you return is placed here --></body>
</html>
\`\`\`
The HTML content is placed within a body tag, so your response can't use html, head, title, body, etc tags.

When you need JavaScript, return it in a fenced block labelled \`js\` (or \`javascript\`).

Only respond with **complete** HTML and/or CSS and/or JS wrapped in fenced code blocks. If you output a block of specific type, it overrides all the previous content of the same type. So additions must also contain all the previous content.

If there's no change to a type of resource, omit any blocks of that type (existing content can/will be cleared by an empty block). E.g. No js change -> don't output a js block.

The user may be requesting things one at a time. Try your best to avoid changing things you're not asked to change.
`.trim();

  msgs.push({ role: "system", content: system });

  // ----------------------------------------------------------------
  // 2️⃣ Replay previous user requests (dummy assistant replies)
  // ----------------------------------------------------------------
  for (const userPrompt of history) {
    msgs.push({ role: "user", content: userPrompt });
    msgs.push({ role: "assistant", content: "Request completed" });
  }
  msgs.push({ role: "system", content: `Current HTML (inside #demo-root):
\`\`\`html
${state.html || "<!-- none -->"}
\`\`\`

Current CSS (scoped to #demo-root):
\`\`\`css
${state.css || "/* none */"}
\`\`\`

Current JavaScript (executed inside the iframe):
\`\`\`js
${state.js || "// none"}
\`\`\``})

  // ----------------------------------------------------------------
  // 3️⃣ The current user prompt will be appended by the route handler
  // ----------------------------------------------------------------
  return msgs;
}

// ------------------------------------------------------------------
// Proxy endpoint – receives {prompt, history, state}
// ------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { prompt, history = [], state = {} } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  // Build the full message array, then push the current prompt as the last user message.
  const messages = buildMessages({ history, state });
  messages.push({ role: "user", content: prompt });

  console.info("=== OpenAI request ===");
  console.info(messages);
  console.info("======================");

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        messages,
        stream: false,
        reasoning_format: "auto",
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenAI error:", err);
      return res
        .status(502)
        .json({ error: "OpenAI request failed", details: err });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content ?? "";
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Proxy error", details: e.message });
  }
});

// ------------------------------------------------------------------
// SPA fallback (optional)
// ------------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server listening → http://localhost:${PORT}`)
);
