const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "2mb" }));

// Thinkora AI frontend. HTML is served below so the file-upload UI can be injected safely.
app.use(express.static(path.join(__dirname), { index: false }));

// Hugging Face AI
const hf = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN
});

// In-memory file uploads: files are processed and discarded after extraction.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json"
    ];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Image uploads are kept in memory only and immediately sent to the vision model.
const visionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Thinkora AI",
    developer: "INNOCENT VINUU"
  });
});

// Extract text from a PDF or common text-based document.
app.post("/api/files", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Please upload a PDF, TXT, MD, CSV, or JSON file."
    });
  }

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
    const truncated = text.length > maxChars;

    res.json({
      name: req.file.originalname,
      type: req.file.mimetype,
      text: text.slice(0, maxChars),
      truncated
    });
  } catch (error) {
    console.error("Thinkora file error:", error);
    res.status(422).json({
      error: "Thinkora AI could not read this file."
    });
  }
});

// Analyze an uploaded image with a vision-language model.
app.post("/api/vision", visionUpload.single("image"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "Please upload a JPG, PNG, WEBP, or GIF image."
    });
  }

  const prompt = typeof req.body?.prompt === "string" && req.body.prompt.trim()
    ? req.body.prompt.trim().slice(0, 4000)
    : "Describe this image clearly and tell me the important details you can see.";

  try {
    const imageDataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const completion = await hf.chat.completions.create({
      // Explicitly use a Hugging Face provider/model confirmed for VLM chat.
      // This avoids the previous automatic route selecting a text-only response path.
      model: "zai-org/GLM-5.3-Flash:novita",
      messages: [
        {
          role: "system",
          content:
            "You are Thinkora AI. You are a vision-capable AI assistant. Analyze the supplied image carefully and answer the user's question accurately. Do not claim to be ChatGPT or another company's AI. If something is unclear or unreadable, say so instead of guessing."
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } }
          ]
        }
      ],
      max_tokens: 800
    });

    const reply = completion.choices?.[0]?.message?.content;

    res.json({
      reply: reply || "I could not analyze this image.",
      name: req.file.originalname
    });
  } catch (error) {
    console.error("Thinkora vision error:", error);
    res.status(500).json({
      error: "Thinkora AI could not analyze this image right now."
    });
  }
});

// AI chat with conversation memory and optional uploaded-document context.
app.post("/api/chat", async (req, res) => {
  const message = req.body?.message;
  const history = Array.isArray(req.body?.messages)
    ? req.body.messages
    : [];
  const fileContext = typeof req.body?.fileContext === "string"
    ? req.body.fileContext.slice(0, 80000)
    : "";
  const fileName = typeof req.body?.fileName === "string"
    ? req.body.fileName.slice(0, 200)
    : "";

  if (!message) {
    return res.status(400).json({ error: "Message is required." });
  }

  try {
    const systemContent =
      "You are Thinkora AI, a helpful, professional and intelligent AI assistant. Answer clearly, accurately and naturally. Never claim to be ChatGPT or another company's AI. Your identity is Thinkora AI.";

    const messages = [
      { role: "system", content: systemContent },
      ...history,
      ...(fileContext
        ? [{
            role: "system",
            content:
              `The user uploaded a document named ${fileName || "uploaded file"}. Use the document text below when answering questions about it. If the answer is not present in the document, say so clearly.\n\nDOCUMENT TEXT:\n${fileContext}`
          }]
        : []),
      { role: "user", content: message }
    ];

    const completion = await hf.chat.completions.create({
      model: "openai/gpt-oss-120b:fastest",
      messages
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

// Inject file and image helpers into the existing frontend without replacing the UI code.
app.get(/.*/, (req, res) => {
  const indexPath = path.join(__dirname, "index.html");

  fs.readFile(indexPath, "utf8", (readError, html) => {
    if (readError) {
      return res.status(500).send("Thinkora AI frontend could not be loaded.");
    }

    const fileFeature = `
<style>
  .file-tools { max-width: 850px; margin: 0 auto 7px; display: flex; align-items: center; gap: 8px; }
  .attach-button { width: 40px; height: 36px; border: 1px solid #555; border-radius: 9px; background: #2f2f2f; color: #eee; cursor: pointer; font-size: 20px; }
  .attach-button:hover { background: #383838; }
  .file-chip { display: none; max-width: calc(100% - 48px); padding: 7px 10px; border: 1px solid #555; border-radius: 9px; background: #2f2f2f; color: #ddd; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-chip.show { display: block; }
  .file-status { color: #888; font-size: 11px; }
  #thinkoraFileInput { display: none; }
  .vision-preview { display: none; width: 100%; max-height: 180px; object-fit: contain; margin-bottom: 8px; border: 1px solid #444; border-radius: 10px; background: #111; }
  .vision-preview.show { display: block; }
</style>
<script>
(function() {
  const inputArea = document.querySelector('.input-area');
  const input = document.getElementById('messageInput');
  if (!inputArea || !input) return;

  const tools = document.createElement('div');
  tools.className = 'file-tools';
  tools.innerHTML = '<button class="attach-button" type="button" aria-label="Attach file">＋</button>' +
    '<div class="file-chip" id="thinkoraFileChip"></div>' +
    '<span class="file-status" id="thinkoraFileStatus"></span>';
  const box = inputArea.querySelector('.input-box');
  if (box) inputArea.insertBefore(tools, box);

  const button = tools.querySelector('.attach-button');
  const chip = tools.querySelector('#thinkoraFileChip');
  const status = tools.querySelector('#thinkoraFileStatus');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'thinkoraFileInput';
  fileInput.accept = '.pdf,.txt,.md,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json';
  tools.appendChild(fileInput);

  let selectedFileContext = '';
  let selectedFileName = '';

  button.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    selectedFileContext = '';
    selectedFileName = '';
    chip.textContent = file.name;
    chip.classList.add('show');
    status.textContent = 'Reading…';
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch('/api/files', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'File could not be read.');
      selectedFileContext = data.text || '';
      selectedFileName = data.name || file.name;
      status.textContent = data.truncated ? 'Ready (first 80,000 characters)' : 'Ready';
    } catch (error) {
      selectedFileContext = '';
      selectedFileName = '';
      status.textContent = error.message || 'Could not read file';
    }
  });

  const originalSend = window.sendMessage;
  window.sendMessage = async function() {
    if (!selectedFileContext) return originalSend();
    const text = input.value.trim();
    if (!text) return originalSend();
    const fileContext = selectedFileContext;
    const fileName = selectedFileName;
    selectedFileContext = '';
    selectedFileName = '';
    chip.classList.remove('show');
    status.textContent = '';
    fileInput.value = '';
    input.dataset.thinkoraFileContext = fileContext;
    input.dataset.thinkoraFileName = fileName;
    try { await originalSend(); } finally {
      delete input.dataset.thinkoraFileContext;
      delete input.dataset.thinkoraFileName;
    }
  };

  // Image understanding helper: camera/gallery images are analyzed by the vision model.
  const preview = document.createElement('img');
  preview.className = 'vision-preview';
  preview.alt = 'Selected image preview';
  if (box) inputArea.querySelector('.composer')?.insertBefore(preview, box);

  async function analyzeImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      status.textContent = 'Please choose an image.';
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      status.textContent = 'Image must be 6 MB or smaller.';
      return;
    }

    chip.textContent = file.name;
    chip.classList.add('show');
    status.textContent = 'Image ready — ask a question and send it.';
    preview.src = URL.createObjectURL(file);
    preview.classList.add('show');

    const reader = new FileReader();
    reader.onload = () => {
      input.dataset.thinkoraImageData = reader.result;
      input.dataset.thinkoraImageName = file.name;
    };
    reader.readAsDataURL(file);
  }

  function bindImagePicker(id) {
    const picker = document.getElementById(id);
    if (picker) picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      analyzeImage(file);
    });
  }
  bindImagePicker('cameraPicker');
  bindImagePicker('galleryPicker');

  const previousSend = window.sendMessage;
  window.sendMessage = async function() {
    const imageData = input.dataset.thinkoraImageData || '';
    if (!imageData) return previousSend();

    const text = input.value.trim() || 'Please analyze this image and describe what you can see.';
    const imageName = input.dataset.thinkoraImageName || 'image';
    const current = ensureCurrentChat(text);
    addMessage('user', text + '\n\n📷 ' + imageName);
    input.value = '';
    addMessage('assistant', 'Analyzing image…');

    delete input.dataset.thinkoraImageData;
    delete input.dataset.thinkoraImageName;
    preview.classList.remove('show');
    chip.classList.remove('show');
    status.textContent = '';

    try {
      const blobResponse = await fetch(imageData);
      const blob = await blobResponse.blob();
      const form = new FormData();
      form.append('image', blob, imageName);
      form.append('prompt', text);
      const response = await fetch('/api/vision', { method: 'POST', body: form });
      const data = await response.json();
      const messages = chat.querySelectorAll('.message');
      const last = messages[messages.length - 1];
      const content = last ? last.querySelector('.content') : null;
      const reply = data.reply || data.error || 'I could not analyze this image.';
      if (content) renderMarkdown(content, reply);
      current.messages.push({ role: 'user', content: text + '\n[Image: ' + imageName + ']' });
      current.messages.push({ role: 'assistant', content: reply });
      saveChats();
      renderHistory();
    } catch (error) {
      const messages = chat.querySelectorAll('.message');
      const last = messages[messages.length - 1];
      const content = last ? last.querySelector('.content') : null;
      if (content) content.textContent = 'Unable to analyze the image right now.';
    }
  };
})();
</script>`;

    let output = html.replace('</body>', fileFeature + '\n</body>');

    const marker = 'const current = ensureCurrentChat(text);';
    const replacement = 'const current = ensureCurrentChat(text);\n  const attachedFileContext = input.dataset.thinkoraFileContext || "";\n  const attachedFileName = input.dataset.thinkoraFileName || "";';
    output = output.replace(marker, replacement);
    output = output.replace(
      'messages: current.messages\n      })',
      'messages: current.messages,\n        fileContext: attachedFileContext,\n        fileName: attachedFileName\n      })'
    );

    res.type('html').send(output);
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Thinkora AI running on port ${PORT}`);
});
