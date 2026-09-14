const express = require("express");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname, { index: false }));

const hf = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN
});

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"];
    cb(null, allowed.includes(file.mimetype));
  }
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  }
});

const SYSTEM_PROMPT = "You are Thinkora AI, a professional, helpful and intelligent AI assistant. Answer clearly, accurately and naturally. Your identity is Thinkora AI. Never claim to be ChatGPT or another company's AI. If you do not know something, say so rather than inventing facts.";

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Thinkora AI", developer: "INNOCENT VINUU" });
});

app.post("/api/files", documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please upload a PDF, TXT, MD, CSV, or JSON file." });
  try {
    let text = "";
    if (req.file.mimetype === "application/pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || "";
    } else {
      text = req.file.buffer.toString("utf8");
    }
    text = text.replace(/\u0000/g, "").trim();
    const maxChars = 80000;
    res.json({ name: req.file.originalname, type: req.file.mimetype, text: text.slice(0, maxChars), truncated: text.length > maxChars });
  } catch (error) {
    console.error("Thinkora file error:", error);
    res.status(422).json({ error: "Thinkora AI could not read this file." });
  }
});

app.post("/api/vision", imageUpload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please upload a JPG, PNG, WEBP, or GIF image." });
  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim() ? req.body.prompt.trim().slice(0, 4000) : "Describe this image clearly and tell me the important details you can see.";
  try {
    const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const completion = await hf.chat.completions.create({
      model: "Qwen/Qwen2.5-VL-3B-Instruct:fastest",
      messages: [
        { role: "system", content: "You are Thinkora AI with vision. You can inspect the supplied image. Carefully answer the user's question about the image. Describe visible objects, people, text, layout, colors and other relevant details. Never say you cannot view the image when an image is supplied. If something is genuinely unreadable or uncertain, say exactly what is unclear." },
        { role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
        ] }
      ],
      max_tokens: 1000
    });
    const reply = completion.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Vision model returned no text");
    res.json({ reply, name: req.file.originalname });
  } catch (error) {
    console.error("Thinkora vision error:", error);
    res.status(500).json({ error: "Thinkora AI could not analyze this image right now." });
  }
});

app.post("/api/chat", async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const history = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const fileContext = typeof req.body?.fileContext === "string" ? req.body.fileContext.slice(0, 80000) : "";
  const fileName = typeof req.body?.fileName === "string" ? req.body.fileName.slice(0, 200) : "";
  if (!message) return res.status(400).json({ error: "Message is required." });
  try {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"),
      ...(fileContext ? [{ role: "system", content: `The user uploaded a document named ${fileName || "uploaded file"}. Use its extracted text when answering questions about it. If the requested information is not present, say so clearly.\n\nDOCUMENT TEXT:\n${fileContext}` }] : []),
      { role: "user", content: message }
    ];
    const completion = await hf.chat.completions.create({ model: "openai/gpt-oss-120b:fastest", messages, max_tokens: 1600 });
    res.json({ reply: completion.choices?.[0]?.message?.content || "I could not generate a response." });
  } catch (error) {
    console.error("Thinkora AI error:", error);
    res.status(500).json({ error: "Thinkora AI could not process your request right now." });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Thinkora AI running on port ${PORT}`));
