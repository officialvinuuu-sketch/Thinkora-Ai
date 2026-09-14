const express = require("express");
const path = require("path");
const fs = require("fs");
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
  fileFilter: (req, file, cb) => cb(null, ["application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"].includes(file.mimetype))
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype))
});

const SYSTEM_PROMPT = "You are Thinkora AI, a professional, helpful and intelligent AI assistant. Answer clearly, accurately and naturally. Your identity is Thinkora AI. Never claim to be ChatGPT or another company's AI. If you do not know something, say so rather than inventing facts.";

app.get("/api/health", (req, res) => res.json({ status: "ok", app: "Thinkora AI", developer: "INNOCENT VINUU" }));

app.post("/api/files", documentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Please upload a PDF, TXT, MD, CSV, or JSON file." });
  try {
    let text = req.file.mimetype === "application/pdf" ? (await pdfParse(req.file.buffer)).text || "" : req.file.buffer.toString("utf8");
    text = text.replace(/\u0000/g, "").trim();
    res.json({ name: req.file.originalname, type: req.file.mimetype, text: text.slice(0, 80000), truncated: text.length > 80000 });
  } catch (e) {
    console.error("Thinkora file error:", e);
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
        { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: dataUrl, detail: "high" } }] }
      ],
      max_tokens: 1000
    });
    const reply = completion.choices?.[0]?.message?.content;
    if (!reply) throw new Error("Vision model returned no text");
    res.json({ reply, name: req.file.originalname });
  } catch (e) {
    console.error("Thinkora vision error:", e);
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
  } catch (e) {
    console.error("Thinkora AI error:", e);
    res.status(500).json({ error: "Thinkora AI could not process your request right now." });
  }
});

app.get(/.*/, (req, res) => {
  const file = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const polish = `<style>
.sidebar-head{display:flex;align-items:center;justify-content:space-between}.sidebar-close{display:none;border:0;background:transparent;color:#aaa;font-size:22px;padding:6px;border-radius:8px}.chat-search{width:100%;height:38px;border:1px solid #3d3d3d;border-radius:9px;background:#242424;color:#eee;outline:0;padding:0 11px;font-size:12px;margin-top:10px}.history-empty{color:#666;font-size:12px;padding:14px 9px}.new-chat{transition:background .15s,border-color .15s}.message-actions{display:flex;gap:6px;margin-top:8px;opacity:.72}.message-action{border:1px solid #444;background:#292929;color:#aaa;border-radius:7px;padding:5px 9px;font-size:11px}.message-action:hover{background:#353535;color:#eee}.thinkora-reveal{animation:thinkoraReveal .7s steps(24,end) both;position:relative}.thinkora-reveal::after{content:"";display:inline-block;width:2px;height:1em;margin-left:3px;vertical-align:-.12em;background:#aaa;animation:thinkoraCursor .75s steps(1,end) infinite}@keyframes thinkoraReveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes thinkoraCursor{50%{opacity:0}}.input-shell:focus-within{border-color:#666;box-shadow:0 0 0 2px rgba(255,255,255,.035),0 5px 20px rgba(0,0,0,.24)}.input{overflow-y:auto}.send{transition:transform .12s,opacity .12s}.send:not(:disabled):active{transform:scale(.94)}.user-actions{display:flex;gap:6px;margin-top:7px}.user-edit{border:1px solid #444;background:#292929;color:#aaa;border-radius:7px;padding:5px 9px;font-size:11px}.user-edit:hover{background:#353535;color:#eee}@media(max-width:800px){.sidebar-close{display:block}.message-actions{opacity:1}.message-action{padding:6px 10px}.user-edit{padding:6px 10px}}
</style>
<script>
(function(){
  const root=document.getElementById('chatInner');
  if(!root)return;
  function addEdit(row){
    if(!row.classList.contains('user')||row.dataset.editAdded)return;
    const content=row.querySelector('.content');
    if(!content)return;
    const text=content.innerText.trim();
    if(!text||/📷|📎/.test(text))return;
    row.dataset.editAdded='1';
    const bar=document.createElement('div');bar.className='user-actions';
    const edit=document.createElement('button');edit.className='user-edit';edit.textContent='Edit';
    edit.onclick=function(){
      const c=typeof window.current==='function'?window.current():null;
      if(!c)return;
      const rows=[...root.querySelectorAll('.message.user')];
      const pos=rows.indexOf(row);
      if(pos<0||!c.messages[pos]||c.messages[pos].role!=='user')return;
      const value=String(c.messages[pos].content||'');
      input.value=value;
      input.dispatchEvent(new Event('input'));
      c.messages=c.messages.slice(0,pos);
      if(typeof window.save==='function')window.save();
      if(typeof window.resetUI==='function')window.resetUI();
      c.messages.forEach(m=>typeof window.addMessage==='function'&&window.addMessage(m.role,m.content));
      if(typeof window.renderHistory==='function')window.renderHistory();
      input.focus();
      input.setSelectionRange(input.value.length,input.value.length);
      window.scrollTo(0,document.body.scrollHeight);
    };
    bar.appendChild(edit);content.appendChild(bar);
  }
  const observer=new MutationObserver(()=>root.querySelectorAll('.message.user').forEach(addEdit));
  observer.observe(root,{childList:true,subtree:true});
  root.querySelectorAll('.message.user').forEach(addEdit);
})();
</script>`;
  res.type("html").send(file.replace("</body>", polish + "</body>"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Thinkora AI running on port ${PORT}`));
