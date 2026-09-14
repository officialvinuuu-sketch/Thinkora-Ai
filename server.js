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
  const file = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const polish = `<style id="thinkora-sidebar-polish">.sidebar-head{display:flex;align-items:center;justify-content:space-between}.sidebar-close{display:none;border:0;background:transparent;color:#aaa;font-size:22px;padding:6px;border-radius:8px}.sidebar-close:hover{background:#303030;color:#fff}.chat-search{width:100%;height:38px;border:1px solid #3d3d3d;border-radius:9px;background:#242424;color:#eee;outline:0;padding:0 11px;font-size:12px;margin-top:10px}.chat-search:focus{border-color:#666}.chat-search::placeholder{color:#777}.history-empty{color:#666;font-size:12px;padding:14px 9px}.new-chat{transition:background .15s,border-color .15s}.new-chat:active{transform:scale(.99)}@media(max-width:800px){.sidebar-head{padding-right:2px}.sidebar-close{display:block}}</style><script>(function(){const s=document.getElementById('sidebar'),brand=s&&s.querySelector('.brand'),newChat=document.getElementById('newChat'),history=document.getElementById('history');if(!s||!brand||!newChat||!history)return;const head=document.createElement('div');head.className='sidebar-head';brand.parentNode.insertBefore(head,brand);head.appendChild(brand);const close=document.createElement('button');close.className='sidebar-close';close.setAttribute('aria-label','Close sidebar');close.textContent='×';head.appendChild(close);const search=document.createElement('input');search.className='chat-search';search.type='search';search.placeholder='Search chats';search.setAttribute('aria-label','Search chats');newChat.parentNode.insertBefore(search,newChat.nextSibling);const originalRender=window.renderHistory;function filter(){const q=search.value.trim().toLowerCase();let count=0;history.querySelectorAll('.history-item').forEach(b=>{const show=!q||b.textContent.toLowerCase().includes(q);b.style.display=show?'':'none';if(show)count++});let empty=history.querySelector('.history-empty');if(q&&!count){if(!empty){empty=document.createElement('div');empty.className='history-empty';history.appendChild(empty)}empty.textContent='No matching chats';}else if(empty)empty.remove();}search.addEventListener('input',filter);close.addEventListener('click',function(){s.classList.remove('open');const o=document.getElementById('overlay');if(o)o.classList.remove('show')});if(originalRender){const wrapped=function(){originalRender();filter()};window.renderHistory=wrapped;}setTimeout(filter,0);})();</script><style id="thinkora-message-actions">.message-actions{display:flex;gap:6px;margin-top:8px;opacity:.72}.message-action{border:1px solid #444;background:#292929;color:#aaa;border-radius:7px;padding:5px 9px;font-size:11px}.message-action:hover{background:#353535;color:#eee}.message-action:active{transform:scale(.98)}@media(max-width:800px){.message-actions{opacity:1}.message-action{padding:6px 10px}}</style><script>(function(){const root=document.getElementById('chatInner');if(!root)return;function addActions(row){if(!row.classList.contains('assistant')||row.querySelector('.message-actions'))return;const content=row.querySelector('.content');if(!content)return;const text=content.innerText.trim();if(!text||text==='Thinking…'||text==='Analyzing image…')return;const bar=document.createElement('div');bar.className='message-actions';const copy=document.createElement('button');copy.className='message-action';copy.textContent='Copy';copy.onclick=async function(){try{await navigator.clipboard.writeText(content.innerText);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy',1200)}catch(e){copy.textContent='Copy failed';setTimeout(()=>copy.textContent='Copy',1200)}};bar.appendChild(copy);const c=typeof window.current==='function'?window.current():null;const canRetry=!!(c&&c.messages&&c.messages.length&&c.messages[c.messages.length-1].role==='assistant'&&c.messages.length>=2&&c.messages[c.messages.length-2].role==='user'&&!String(c.messages[c.messages.length-2].content).includes('📷'));if(canRetry){const retry=document.createElement('button');retry.className='message-action';retry.textContent='Retry';retry.onclick=async function(){const chatObj=window.current();if(!chatObj)return;const lastUser=chatObj.messages[chatObj.messages.length-2];if(!lastUser||lastUser.role!=='user')return;retry.disabled=true;retry.textContent='Retrying…';try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(lastUser.content).replace(/^.*?\n?📎 /,'').trim(),messages:chatObj.messages.slice(0,-2)})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Retry failed');chatObj.messages[chatObj.messages.length-1]={role:'assistant',content:d.reply};if(typeof window.save==='function')window.save();content.innerHTML=typeof window.markdown==='function'?window.markdown(d.reply):d.reply;bar.remove();addActions(row)}catch(e){retry.textContent='Retry failed';setTimeout(()=>retry.textContent='Retry',1500)}finally{retry.disabled=false}};bar.appendChild(retry)}content.appendChild(bar)}const observer=new MutationObserver(()=>root.querySelectorAll('.message.assistant').forEach(addActions));observer.observe(root,{childList:true,subtree:true});root.querySelectorAll('.message.assistant').forEach(addActions)})();</script>`;
  res.type("html").send(file.replace("</body>", polish + "</body>"));
});

app.listen(PORT, "0.0.0.0", () => console.log(`Thinkora AI running on port ${PORT}`));
