const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 10000);
const INTERNAL_PORT = PORT + 1;
const integrationPath = path.join(__dirname, 'offline-mode-integration.js');
const integration = fs.readFileSync(integrationPath, 'utf8');
const childEnv = { ...process.env, PORT: String(INTERNAL_PORT) };
const child = spawn(process.execPath, ['-r', './web-search-guard.js', 'server.js'], { env: childEnv, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));

const THINKORA_SYSTEM = 'You are Thinkora AI, a professional, helpful and intelligent AI assistant. Answer clearly, accurately and naturally. Your identity is Thinkora AI. Never claim to be ChatGPT or another company AI. If you do not know something, say so rather than inventing facts.';

function buildGeminiContents(body) {
  const history = Array.isArray(body?.messages) ? body.messages : [];
  const contents = [];
  for (const item of history) {
    if (!item || typeof item.content !== 'string') continue;
    if (item.role === 'user') contents.push({ role: 'user', parts: [{ text: item.content }] });
    else if (item.role === 'assistant') contents.push({ role: 'model', parts: [{ text: item.content }] });
  }
  const parts = [];
  if (body?.fileContext) {
    parts.push({ text: `The user uploaded a document named ${body.fileName || 'uploaded file'}. Use this extracted text when answering questions about it.\n\nDOCUMENT TEXT:\n${String(body.fileContext).slice(0, 80000)}` });
  }
  parts.push({ text: typeof body?.message === 'string' ? body.message : '' });
  contents.push({ role: 'user', parts });
  return contents;
}

async function tavilyContext(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { context: '', sources: [] };
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: query.slice(0, 2000), search_depth: 'basic', max_results: 5, include_answer: false, include_raw_content: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.error || `Tavily HTTP ${response.status}`);
  const results = Array.isArray(data.results) ? data.results : [];
  const sources = results.map(r => ({ title: r.title || 'Web result', url: r.url || '', content: (r.content || '').slice(0, 2500) })).filter(r => r.url);
  const context = sources.length ? `\n\nWEB SEARCH RESULTS:\n${sources.map((r, i) => `[SOURCE ${i + 1}]\nTITLE: ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.content}`).join('\n\n')}` : '';
  return { context, sources };
}

async function callGemini(model, apiKey, payload) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Gemini HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
  if (!reply) throw new Error('Gemini returned no text.');
  return reply;
}

async function handleGemini(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return true; }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured.' }));
    return true;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw || '{}'); } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Invalid JSON request.' }));
    return true;
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Message is required.' }));
    return true;
  }
  try {
    let search = { context: '', sources: [] };
    if (body.webSearch === true) search = await tavilyContext(message);
    const systemInstruction = `${THINKORA_SYSTEM}${search.context ? '\n\nThe user explicitly enabled Web Search. Use the supplied search results as evidence. Never invent URLs, headlines, dates, or facts. If the results do not support an answer, say so clearly.' : ''}${search.context}`;
    const payload = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: buildGeminiContents(body),
      generationConfig: { temperature: 0.6, maxOutputTokens: 1600 }
    };

    let reply;
    let modelUsed = 'gemini-2.5-flash';
    try {
      reply = await callGemini('gemini-2.5-flash', apiKey, payload);
    } catch (primaryError) {
      console.warn('Thinkora Gemini primary model unavailable; trying free-tier fallback:', primaryError.message);
      reply = await callGemini('gemini-2.5-flash-lite', apiKey, payload);
      modelUsed = 'gemini-2.5-flash-lite';
    }

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ reply, sources: search.sources, mode: 'online-gemini', model: modelUsed }));
  } catch (error) {
    console.error('Thinkora Gemini error:', error);
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: error.message || 'Gemini request failed.' }));
  }
  return true;
}

const proxy = http.createServer((req, res) => {
  if (req.url === '/offline-mode-integration.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(integration);
    return;
  }
  if (req.url === '/api/online-chat') {
    handleGemini(req, res);
    return;
  }

  const opts = { hostname: '127.0.0.1', port: INTERNAL_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${INTERNAL_PORT}` } };
  const upstream = http.request(opts, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const body = Buffer.concat(chunks);
      const contentType = String(response.headers['content-type'] || '');
      if ((req.url === '/' || req.url === '/index.html') && contentType.includes('text/html') && !body.includes(Buffer.from('offline-mode-integration.js'))) {
        const html = body.toString('utf8').replace('</head>', '<script src="/offline-mode-integration.js"></script></head>');
        const headers = { ...response.headers, 'content-length': Buffer.byteLength(html) };
        delete headers['content-encoding'];
        res.writeHead(response.statusCode || 200, headers);
        res.end(html);
        return;
      }
      res.writeHead(response.statusCode || 200, response.headers);
      res.end(body);
    });
  });
  upstream.on('error', err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: `Thinkora backend unavailable: ${err.message}` })); });
  req.pipe(upstream);
});

proxy.listen(PORT, '0.0.0.0', () => console.log(`Thinkora production bootstrap listening on port ${PORT}`));