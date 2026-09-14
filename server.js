const express = require("express");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

// Thinkora AI frontend
app.use(express.static(path.join(__dirname)));

// Hugging Face AI
const hf = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Thinkora AI",
    developer: "INNOCENT VINUU"
  });
});

// AI chat with conversation memory support
app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;
  const history = Array.isArray(req.body?.messages)
    ? req.body.messages
    : [];

  if (!message) {
    return res.status(400).json({
      error: "Message is required."
    });
  }

  try {
    const messages = [
      {
        role: "system",
        content:
          "You are Thinkora AI, a helpful, professional and intelligent AI assistant. Remember and use the conversation context provided to you. Give clear, accurate and useful answers."
      },
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const completion = await hf.chat.completions.create({
      model: "openai/gpt-oss-120b:fastest",
      messages: messages
    });

    const reply = completion.choices?.[0]?.message?.content;

    res.json({
      reply: reply || "I could not generate a response."
    });
  } catch (error) {
    console.error("Thinkora AI error:", error);

    res.status(500).json({
      error: "Thinkora AI could not process your request right now."
    });
  }
});

// Serve frontend
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Thinkora AI running on port ${PORT}`);
});
