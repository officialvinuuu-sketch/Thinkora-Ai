const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

// Existing Thinkora AI frontend ko serve karega
app.use(express.static(path.join(__dirname)));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Thinkora AI",
    developer: "INNOCENT VINUU"
  });
});

// Temporary AI endpoint.
// AI model hum next stage mein securely connect karenge.
app.post("/api/chat", (req, res) => {
  const message = req.body?.message;

  if (!message) {
    return res.status(400).json({
      error: "Message is required."
    });
  }

  res.json({
    reply:
      "Thinkora AI backend is connected. AI model integration is the next step."
  });
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Thinkora AI running on port ${PORT}`);
});
