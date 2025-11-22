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

  // 1️⃣ System message that tells the model the *current* page state
  const system = `
You are a front‑end assistant. The user is editing a web page.
The HTML you're working on is placed inside the the #demo-root element of a following structure
\`\`\`html
<!DOCTYPE html>
<html lang="en">
 <head>
  <meta charset="UTF-8">
  <title>WIP</title>
  <style id="demo-style">
  /* CSS you return is placed here (and to document.adoptedStyleSheets) */
  </style>
 </head>
 <body>
  <div id="app">
   <div id="demo-root">
    <!-- Demo area – HTML you return is placed here -->
   </div>
   <!-- Other things you don't need to care about -->
  </div>
 </body>
</html>
\`\`\`
The HTML content is placed within a div block inside a body, so your response can't use html, head, title, body, etc tags.
When the user wants you to add CSS to the whole page (like a background), add it to #demo-root instead of html or body.

Current HTML (inside #demo-root):
\`\`\`html
${state.html || "<!-- none -->"}
\`\`\`

Current CSS (scoped to #demo-root):
\`\`\`css
${state.css || "/* none */"}
\`\`\`

Only respond with **complete** HTML and/or CSS wrapped in fenced code blocks. Additions must also include the existing content, they replace the old content completely.
When making only style changes, omit html, when making only HTML changes, omit css.
`;
  msgs.push({ role: "system", content: system.trim() });

  // 2️⃣ Replay the *previous* user requests, each followed by a dummy assistant reply.
  // This gives the model the same conversation flow it would have seen, but without
  // sending the real (often large) assistant answers.
  for (const userPrompt of history) {
    msgs.push({ role: "user", content: userPrompt });
    msgs.push({ role: "assistant", content: "Request completed" });
  }

  // 3️⃣ The *current* user prompt will be appended by the route handler itself.
  // (see below)

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

  console.info(messages)

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.7,
        messages,
        stream: false
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
