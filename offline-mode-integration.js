(function(){
  const LOCAL_URL = "http://127.0.0.1:8080/v1/chat/completions";
  const ONLINE_URL = "/api/online-chat-stream";
  const KEY = "thinkoraModelMode";
  const originalFetch = window.fetch.bind(window);
  let mode = localStorage.getItem(KEY) || "auto";

  function localMessages(body){
    const history = Array.isArray(body.messages) ? body.messages : [];
    const messages = [
      { role:"system", content:"You are Thinkora AI, a professional, helpful and intelligent AI assistant. Answer clearly, accurately and naturally. Your identity is Thinkora AI. You are running in Offline AI mode, so do not claim to have live internet access or current information. If the user asks for current/live information, say that internet access is required." },
      ...history.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"),
      { role:"user", content: typeof body.message === "string" ? body.message : "" }
    ];
    if(body.fileContext){
      messages.splice(messages.length-1,0,{ role:"system", content:`The user uploaded a document named ${body.fileName || "uploaded file"}. Use this extracted text when answering questions about it.\n\nDOCUMENT TEXT:\n${String(body.fileContext).slice(0,80000)}` });
    }
    return messages;
  }

  async function offlineChat(body){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 20000);
    try{
      const r = await originalFetch(LOCAL_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:localMessages(body),max_tokens:512,chat_template_kwargs:{enable_thinking:false}}),signal:controller.signal});
      const d = await r.json().catch(()=>({}));
      if(!r.ok) throw new Error(d.error?.message || d.error || `Offline AI HTTP ${r.status}`);
      return new Response(JSON.stringify({reply:d.choices?.[0]?.message?.content||"Offline AI could not generate a response.",sources:[],mode:"offline"}),{status:200,headers:{"Content-Type":"application/json"}});
    } finally { clearTimeout(timer); }
  }

  function createStreamBubble(){
    const root=document.getElementById("chatInner");
    if(!root)return null;
    const row=document.createElement("div");
    row.className="message assistant thinkora-streaming-message";
    row.innerHTML='<div class="avatar">T</div><div class="content"><p class="thinkora-streaming-text"></p></div>';
    root.appendChild(row);
    const chat=document.getElementById("chat");
    if(chat)chat.scrollTop=chat.scrollHeight;
    return {row,text:row.querySelector(".thinkora-streaming-text")};
  }
  function removeStreamBubble(bubble){ if(bubble?.row?.parentNode) bubble.row.parentNode.removeChild(bubble.row); }

  async function consumeSSE(response,bubble,label){
    if(!response.body)throw new Error(`${label} streaming response has no body.`);
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer="",reply="",sources=[],model="";
    const consume=raw=>{
      for(const event of raw.split(/\r?\n\r?\n/)){
        for(const line of event.split(/\r?\n/)){
          if(!line.startsWith("data:"))continue;
          const value=line.slice(5).trim();
          if(!value||value==="[DONE]")continue;
          let d;try{d=JSON.parse(value)}catch{continue;}
          if(d.type==="delta"&&typeof d.text==="string"){
            reply+=d.text;
            if(bubble?.text){bubble.text.textContent=reply;const chat=document.getElementById("chat");if(chat)chat.scrollTop=chat.scrollHeight;}
          }else if(d.type==="done"){
            sources=Array.isArray(d.sources)?d.sources:[];model=d.model||"";
          }else if(d.type==="error"){
            const error=new Error(d.error||`${label} streaming failed.`);
            if(reply)error.streamedText=true;
            throw error;
          }
        }
      }
    };
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      buffer+=decoder.decode(value,{stream:true});
      const parts=buffer.split(/\r?\n\r?\n/);
      buffer=parts.pop()||"";
      consume(parts.join("\n\n"));
    }
    buffer+=decoder.decode();
    if(buffer)consume(buffer);
    if(!reply.trim())throw new Error(`${label} returned no text.`);
    return {reply,sources,model};
  }

  async function offlineStream(body){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 60000);
    const bubble=createStreamBubble();
    try{
      const r=await originalFetch(LOCAL_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:localMessages(body),max_tokens:512,stream:true,chat_template_kwargs:{enable_thinking:false}}),signal:controller.signal});
      if(!r.ok){
        const d=await r.json().catch(()=>({}));
        throw new Error(d.error?.message||d.error||`Offline AI HTTP ${r.status}`);
      }
      const result=await consumeSSE(r,bubble,"Offline AI");
      return new Response(JSON.stringify({reply:result.reply,sources:result.sources,mode:"offline",model:result.model}),{status:200,headers:{"Content-Type":"application/json"}});
    }catch(e){
      removeStreamBubble(bubble);
      throw e;
    }finally{clearTimeout(timer);}
  }

  async function onlineChat(body,options){
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), 30000);
    const bubble=createStreamBubble();
    try{
      const r = await originalFetch(ONLINE_URL,Object.assign({},options,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:controller.signal}));
      if(!r.ok){
        const d = await r.json().catch(()=>({}));
        throw new Error(d.error || `Smart Online HTTP ${r.status}`);
      }
      const result=await consumeSSE(r,bubble,"Smart Online");
      return new Response(JSON.stringify({reply:result.reply,sources:result.sources,mode:"online-gemini",model:result.model}),{status:200,headers:{"Content-Type":"application/json"}});
    }catch(e){
      removeStreamBubble(bubble);
      throw e;
    }finally{clearTimeout(timer);}
  }

  async function routeChat(body,options){
    if(mode === "offline") return offlineStream(body);
    if(mode === "online") return onlineChat(body,options);
    try{
      return await onlineChat(body,options);
    }catch(e){
      if(e?.streamedText)throw e;
      return offlineStream(body);
    }
  }
  window.fetch=function(resource,options){
    const url=typeof resource==="string"?resource:(resource&&resource.url)||"";
    if(url.endsWith("/api/chat")&&options&&options.method==="POST"){
      try{return routeChat(JSON.parse(options.body||"{}"),options);}catch(e){}
    }
    return originalFetch(resource,options);
  };
  function install(){
    if(document.getElementById("thinkoraModelRow"))return;
    const style=document.createElement("style");style.id="thinkoraOfflineStyle";style.textContent='.thinkora-model-row{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid #303030;background:#171717;overflow-x:auto;scrollbar-width:none}.thinkora-model-row::-webkit-scrollbar{display:none}.thinkora-model-label{font-size:11px;color:#888;white-space:nowrap}.thinkora-model-btn{border:1px solid #444;background:#292929;color:#aaa;border-radius:9px;padding:7px 11px;font-size:12px;white-space:nowrap}.thinkora-model-btn.active{background:#fff;color:#111;border-color:#fff}.thinkora-mode-badge{font-size:11px;color:#777;white-space:nowrap}.thinkora-streaming-text{white-space:pre-wrap}@media(max-width:800px){.thinkora-model-row{padding:7px 9px}.thinkora-model-label,.thinkora-mode-badge{display:none}}';document.head.appendChild(style);
    const topbar=document.querySelector('.topbar');if(!topbar)return;
    const row=document.createElement('div');row.className='thinkora-model-row';row.id='thinkoraModelRow';row.innerHTML='<span class="thinkora-model-label">AI Mode</span><button class="thinkora-model-btn" data-mode="online">Smart Online</button><button class="thinkora-model-btn" data-mode="offline">Offline AI</button><button class="thinkora-model-btn" data-mode="auto">Auto</button><span class="thinkora-mode-badge" id="thinkoraModeBadge"></span>';topbar.parentNode.insertBefore(row,topbar.nextSibling);
    row.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>{mode=btn.dataset.mode;localStorage.setItem(KEY,mode);renderMode();}));renderMode();
  }
  function renderMode(){const row=document.getElementById("thinkoraModelRow");if(!row)return;row.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));const badge=document.getElementById("thinkoraModeBadge");if(badge)badge.textContent=mode==='online'?'Smart Online':mode==='offline'?'Offline AI':'Auto';}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
