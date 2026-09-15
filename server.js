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

let pdfjsPromise;
async function getPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowedMime = ["application/pdf", "text/plain", "text/markdown", "text/csv", "application/json", "application/octet-stream", "binary/octet-stream"];
    const allowedExt = [".pdf", ".txt", ".md", ".csv", ".json"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, allowedMime.includes(file.mimetype) || allowedExt.includes(ext));
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

async function extractScannedPdfText(buffer, originalName) {
  const pdfjsLib = await getPdfJs();
  const { createCanvas } = require("@napi-rs/canvas");
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, 5);
  const parts = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxWidth = 1400;
    const scale = Math.min(1.8, maxWidth / Math.max(baseViewport.width, 1));
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    const imageData = canvas.toDataURL("image/jpeg", 0.82);

    const completion = await hf.chat.completions.create({
      model: "zai-org/GLM-4.5V:fastest",
      messages: [
        {
          role: "system",
          content: "You are Thinkora AI document OCR. Read the supplied PDF page carefully. Transcribe all useful visible text, preserving headings, numbers, lists and table information as accurately as possible. Do not describe the image unless needed to explain unreadable content. If text is unclear, mark it as [unclear] rather than inventing it."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Extract the text from page ${pageNumber} of the PDF named ${originalName}.` },
            { type: "image_url", image_url: { url: imageData, detail: "high" } }
          ]
        }
      ],
      max_tokens: 1800
    });

    const text = completion.choices?.[0]?.message?.content;
    if (text) parts.push(`\n--- PAGE ${pageNumber} ---\n${text}`);
  }

  return { text: parts.join("\n").trim(), pagesRead: pageCount, totalPages: pdf.numPages };
}

async function tavilySearch(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY is not configured");
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: query.slice(0, 2000),
      search_depth: "basic",
      max_results: 5,
      include_answer: false,
      include_raw_content: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.error || `Tavily HTTP ${response.status}`);
  return Array.isArray(data.results) ? data.results : [];
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "Thinkora AI", developer: "INNOCENT VINUU" });
});

app.post("/api/files", documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please upload a PDF, TXT, MD, CSV, or JSON file." });
  try {
    let text = "";
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    if (req.file.mimetype === "application/pdf" || ext === ".pdf") {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || "";
      text = text.replace(/\u0000/g, "").trim();

      if (!text) {
        console.log(`Thinkora PDF OCR fallback: ${req.file.originalname}`);
        const ocr = await extractScannedPdfText(req.file.buffer, req.file.originalname);
        text = ocr.text;
        if (!text) return res.status(422).json({ error: "Thinkora AI could not find readable text in this PDF." });
        const maxChars = 80000;
        return res.json({ name: req.file.originalname, type: req.file.mimetype, text: text.slice(0, maxChars), truncated: text.length > maxChars, ocr: true, pagesRead: ocr.pagesRead, totalPages: ocr.totalPages });
      }
    } else {
      text = req.file.buffer.toString("utf8").replace(/\u0000/g, "").trim();
    }
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
      model: "zai-org/GLM-4.5V:fastest",
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
  const webSearch = req.body?.webSearch === true;
  if (!message) return res.status(400).json({ error: "Message is required." });
  try {
    let webContext = "";
    let sources = [];
    if (webSearch) {
      const results = await tavilySearch(message);
      sources = results.map(r => ({ title: r.title || "Web result", url: r.url || "", content: (r.content || "").slice(0, 2500) })).filter(r => r.url);
      webContext = sources.length
        ? `\n\nWEB SEARCH RESULTS (current web information; use these sources when relevant):\n${sources.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.content}`).join("\n\n")}`
        : "\n\nWEB SEARCH RESULTS: No useful results were returned. Say that clearly rather than inventing current information.";
    }
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"),
      ...(fileContext ? [{ role: "system", content: `The user uploaded a document named ${fileName || "uploaded file"}. Use its extracted text when answering questions about it. If the requested information is not present, say so clearly.\n\nDOCUMENT TEXT:\n${fileContext}` }] : []),
      ...(webContext ? [{ role: "system", content: `The user explicitly enabled Web Search. Use the retrieved web results to answer current or web-dependent questions. Prefer the freshest relevant evidence, distinguish facts from uncertainty, and do not invent details. When useful, cite sources in the answer using the source title and URL text.\n${webContext}` }] : []),
      { role: "user", content: message }
    ];
    const completion = await hf.chat.completions.create({ model: "openai/gpt-oss-120b:fastest", messages, max_tokens: 1600 });
    res.json({ reply: completion.choices?.[0]?.message?.content || "I could not generate a response.", sources });
  } catch (error) {
    console.error("Thinkora AI error:", error);
    const msg = webSearch && /TAVILY|Tavily|HTTP 4\d\d|HTTP 5\d\d/i.test(error.message || "")
      ? "Thinkora Web Search is temporarily unavailable. Your normal AI chat is still available."
      : "Thinkora AI could not process your request right now.";
    res.status(500).json({ error: msg });
  }
});

app.get(/.*/, (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  const file = require("fs").readFileSync(path.join(__dirname, "index.html"), "utf8");
  const polish = `<style>
.response-actions > .response-action { display:none !important; }
.response-actions > .more-wrap { display:inline-flex !important; }
.message-actions { display:none !important; }
.web-search-row{display:flex;align-items:center;gap:8px;margin:0 0 7px 6px}
.web-search-toggle{border:1px solid #555;background:#292929;color:#aaa;border-radius:10px;padding:7px 11px;font-size:12px;display:inline-flex;align-items:center;gap:7px}
.web-search-toggle.active{background:#3a3a3a;color:#fff;border-color:#777}
.web-search-dot{width:7px;height:7px;border-radius:50%;background:#777;display:inline-block}
.web-search-toggle.active .web-search-dot{background:#fff}
.web-search-note{font-size:10px;color:#777}
</style><script>(function(){
function installWebSearch(){
  if(document.getElementById('thinkoraWebSearchRow'))return;
  var shell=document.querySelector('.input-shell');
  if(!shell)return;
  var row=document.createElement('div');row.className='web-search-row';row.id='thinkoraWebSearchRow';
  row.innerHTML='<button type="button" class="web-search-toggle" id="thinkoraWebSearch"><span class="web-search-dot"></span><span>Web Search</span></button><span class="web-search-note">Uses free web-search credits</span>';
  shell.parentNode.insertBefore(row,shell);
  var btn=document.getElementById('thinkoraWebSearch');
  window.thinkoraWebSearch=false;
  btn.addEventListener('click',function(){window.thinkoraWebSearch=!window.thinkoraWebSearch;btn.classList.toggle('active',window.thinkoraWebSearch);});
}
var originalFetch=window.fetch.bind(window);
window.fetch=function(resource,options){
  var url=typeof resource==='string'?resource:(resource&&resource.url)||'';
  if(window.thinkoraWebSearch&&url.indexOf('/api/chat')!==-1&&options&&typeof options.body==='string'){
    try{var body=JSON.parse(options.body);body.webSearch=true;options=Object.assign({},options,{body:JSON.stringify(body)});}catch(_){}}
  return originalFetch(resource,options);
};
function fixFileUpload(){if(!window.readDoc||!window.filePicker)return;window.readDoc=async function(f){selectedImage=null;selectedDoc=f;docContext='';docName='';window.thinkoraDocError='';preview.classList.remove('show');preview.removeAttribute('src');attachmentName.textContent=f.name+' — reading…';attachment.classList.add('show');attachMenu.classList.remove('open');let fd=new FormData();fd.append('file',f,f.name);window.thinkoraDocPromise=(async function(){try{let r=await fetch('/api/files',{method:'POST',body:fd});let d={};try{d=await r.json()}catch(_){throw Error('Server returned an invalid response.')}if(!r.ok)throw Error(d.error||'Could not read file');if(!d.text)throw Error('Thinkora AI could not extract readable content from this file.');docContext=d.text;docName=d.name||f.name;attachmentName.textContent=f.name+' — ready';return d}catch(e){window.thinkoraDocError=e.message||'Could not read file';attachmentName.textContent='Upload failed: '+window.thinkoraDocError;selectedDoc=f;throw e}finally{window.thinkoraDocPromise=null}})();try{await window.thinkoraDocPromise}catch(_){}};filePicker.onchange=function(e){let f=e.target.files&&e.target.files[0];if(f)window.readDoc(f)}}
window.addEventListener('load',function(){installWebSearch();fixFileUpload();var originalSend=window.sendMessage;if(originalSend&&window.send){window.sendMessage=async function(){if(window.thinkoraDocPromise){attachmentName.textContent=(selectedDoc&&selectedDoc.name||'File')+' — waiting…';try{await window.thinkoraDocPromise}catch(_){return}}if(window.thinkoraDocError){attachmentName.textContent='Upload failed: '+window.thinkoraDocError;return}return originalSend()};send.onclick=function(){window.sendMessage()};input.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();window.sendMessage()}}}});
function addCopy(){document.querySelectorAll('.more-menu').forEach(function(menu){if(menu.querySelector('[data-thinkora-copy]'))return;var b=document.createElement('button');b.className='more-item';b.setAttribute('data-thinkora-copy','1');b.innerHTML='<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M6 15H5a2 2 0 0 1 2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';b.addEventListener('click',function(){var message=menu.closest('.message');var content=message&&message.querySelector('.content');if(content){navigator.clipboard.writeText(content.innerText||'').catch(function(){});}menu.classList.remove('open');});menu.insertBefore(b,menu.firstChild);});}
new MutationObserver(function(){installWebSearch();addCopy()}).observe(document.body,{childList:true,subtree:true});
addCopy();
})();</script>`;
  res.type("html").send(file.replace("</head>", polish + "</head>"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Thinkora AI running on port ${PORT}`));
