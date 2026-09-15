const originalFetch = global.fetch;

function isAiNewsQuery(query) {
  const q = String(query || '').toLowerCase();
  return /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|robotics)\b/i.test(q) &&
    /\b(news|headline|headlines|breaking|latest|current|today|recent|development|developments|update|updates)\b/i.test(q);
}

function extractIndiaDate(query) {
  const m = String(query || '').match(/Current date in India:\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : '';
}

function getHost(result) {
  try { return new URL(String(result?.url || '')).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return ''; }
}

function parsePublishedIndiaDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function hasExplicitOldDateInTitle(result, targetDate) {
  const title = String(result?.title || '');
  if (!targetDate || !title) return false;
  const iso = title.match(/\b20\d{2}[-\/]\d{2}[-\/]\d{2}\b/);
  if (iso && iso[0] !== targetDate) return true;
  const months = 'January February March April May June July August September October November December'.split(' ');
  const m = title.match(new RegExp(`\\b(?:${months.join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+20\\d{2}\\b`, 'i'));
  if (!m) return false;
  const d = new Date(m[0].replace(/(st|nd|rd|th)/i, ''));
  if (Number.isNaN(d.getTime())) return false;
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return date !== targetDate;
}

function isFreshForTargetDate(result, targetDate) {
  if (!targetDate) return true;
  const raw = String(result?.published_date || '').trim();
  if (!raw) return true;
  const parsed = parsePublishedIndiaDate(raw);
  return !parsed || parsed === targetDate;
}

function normalizeTitle(title) {
  return String(title || '').toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|for|of|to|in|on|with|from|says|said|today|latest|ai)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function titleSimilarity(a, b) {
  const aa = new Set(normalizeTitle(a).split(' ').filter(w => w.length > 2));
  const bb = new Set(normalizeTitle(b).split(' ').filter(w => w.length > 2));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const word of aa) if (bb.has(word)) intersection++;
  return intersection / Math.max(aa.size, bb.size);
}

function normalizeWebAssistantText(text) {
  let out = String(text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/\r/g, '').trim();
  out = out.replace(/^\s*\|.*$/gim, line => /https?:\/\//i.test(line) ? line : '');
  out = out.replace(/^\s*[-|]+\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();

  // Force every numbered item to be 1, 2, 3... even when the model repeats "1.".
  let n = 0;
  out = out.replace(/(^|\n)\s*\d+\.\s+/g, (match, prefix) => `${prefix}${++n}. `);
  return out;
}

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  requestBody.messages[webIndex].content += `\n\nTHINKORA SMART WEB ANSWER MODE: Act like a careful research assistant, not a search-result summarizer. For current AI news, select only concrete, meaningful major developments supported directly by the supplied sources. One real-world event = one answer item, even if many articles cover it. Prefer Reuters, AP, BBC, Bloomberg, FT, WSJ, NYT, CNBC, The Verge, TechCrunch, Wired, Ars Technica, MIT Technology Review, and official company/regulator sources. Use secondary sources for corroboration, not as separate events.\n\nFRESHNESS: For an explicit date, treat the target India calendar date as a hard requirement. Never include an article whose published_date resolves to an older India date. Never use a URL date as proof of publication date. Never relabel an older event as today's news.\n\nMAJOR-DEVELOPMENT RULE: Do not select small vendor announcements, retail/self-checkout/loss-prevention products, ordinary SaaS features, local business promotions, jobs/hiring, generic explainers, opinion, commentary, podcasts, newsletters, market reactions, stock-price stories, investor sentiment, or minor integrations. A selected item should be a major company/model launch, significant research result, major funding/acquisition/partnership, important AI infrastructure/chip event, major policy/regulation/legal decision, major safety development, or a widely consequential enterprise deployment.\n\nHEADLINE/SOURCE RULES: Use the supplied source TITLE as the headline with only trivial punctuation cleanup. The explanation must describe that same event. Copy the exact URL from that same supplied source. Never invent a headline, date, source, fact, or URL. Do not combine unrelated sources into one item. Do not split one article or one real-world event into multiple items.\n\nOUTPUT FORMAT: Do NOT use a Markdown table, HTML, <br>, or table separators. Return a clean numbered list starting at 1. Each item must be exactly: '1. **Exact source title** — 1-2 sentence explanation. Source: exact URL'. Continue 2, 3, 4, 5. If fewer than five distinct major verified developments are supported, return only those and say 'Fewer than five verified major developments were available.' Never fill missing slots with weak news.`;
}

async function normalizeCompletionResponse(response) {
  try {
    const data = await response.clone().json();
    const choice = data?.choices?.[0]?.message;
    if (choice && typeof choice.content === 'string') {
      choice.content = normalizeWebAssistantText(choice.content);
      return new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers: response.headers });
    }
  } catch (_) {}
  return response;
}

global.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';

  if (url.includes('router.huggingface.co/v1/chat/completions') && init && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      const isWeb = Array.isArray(body.messages) && body.messages.some(m =>
        m && m.role === 'system' && typeof m.content === 'string' && m.content.includes('The user explicitly enabled Web Search')
      );
      improveWebAnswer(body);
      const response = await originalFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
      return isWeb ? normalizeCompletionResponse(response) : response;
    } catch (_) { return originalFetch(input, init); }
  }

  if (url !== 'https://api.tavily.com/search' || !init || typeof init.body !== 'string') return originalFetch(input, init);

  let baseBody;
  try { baseBody = JSON.parse(init.body); } catch (_) { return originalFetch(input, init); }
  const query = String(baseBody.query || '');
  if (!isAiNewsQuery(query)) return originalFetch(input, init);

  const indiaDate = extractIndiaDate(query);
  const datePhrase = indiaDate
    ? ` Target date: ${indiaDate}. Only return developments newly reported, announced, released, published, or officially updated on that date. Do not treat yesterday's results as today's.`
    : '';
  const common = ` Focus on major concrete AI developments. Prioritize frontier-model companies, major product/model launches, significant research, major funding/acquisitions/partnerships, AI chips/infrastructure, major policy/regulation/legal/safety decisions, and consequential enterprise deployments. Exclude small vendor announcements, retail/self-checkout/loss-prevention, ordinary SaaS features, generic explainers, opinion, commentary, jobs, market reaction, stock stories, investor sentiment, podcasts, newsletters, event listings, and old incidents. One result = one distinct real-world development.${datePhrase}`;

  const queries = [
    `${query}${common} Find major AI company, model, agent, platform, and product developments.`,
    `${query}${common} Find major AI research, chips, infrastructure, funding, acquisitions, partnerships, and enterprise developments.`,
    `${query}${common} Find major AI policy, regulation, legal, safety, privacy, and court developments.`,
    `${query}${common} Find major AI launches, deployments, and newly announced tools or services.`,
    `${query}${common} Find major AI developments reported by high-quality technology and business journalism.`
  ];

  const requests = queries.map(q => {
    const body = Object.assign({}, baseBody, {
      query: q.slice(0, 2000), search_depth: 'basic', max_results: 10,
      include_answer: false, include_raw_content: false, topic: 'news', time_range: 'day'
    });
    return originalFetch(url, Object.assign({}, init, { body: JSON.stringify(body) }))
      .then(async response => { let data = null; try { data = await response.clone().json(); } catch (_) {} return { response, data }; })
      .catch(() => ({ response: null, data: null }));
  });

  const fetched = await Promise.all(requests);
  const successful = fetched.find(x => x.response && x.response.ok);
  if (!successful) return fetched[0]?.response || originalFetch(input, init);

  let results = [];
  for (const item of fetched) if (item.data && Array.isArray(item.data.results)) results.push(...item.data.results);

  const relevance = /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|large language model|robotics|ai model|ai chip|agentic)\b/i;
  const lowTitle = /\b(opinion|commentary|explainer|guide|how to|what happens when|questions answered|market reaction|investors? nervous|investor sentiment|stocks?|share price|sentiment|resignation|former (?:president|employee|researcher)|podcast|newsletter|morning bid|slowdown debate|spending slowdown|industry warnings)\b/i;
  const lowContent = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|evergreen explainer|opinion column|investor anxiety|market anxiety|stock market reaction)\b/i;
  const smallVendor = /\b(self[- ]?checkout|loss prevention|loss-prevention|retail checkout|shopping friction|retailers?|restaurant technology|store associates?|merchandising|customer experience platform|marketing platform|sales platform|hr platform|real estate platform|insurance platform|legaltech|proptech|martech)\b/i;
  const trusted = new Set([
    'reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com',
    'apple.com','openai.com','anthropic.com','google.com','blog.google','microsoft.com','blogs.microsoft.com','nvidia.com','meta.com','deepmind.google','x.ai'
  ]);
  const majorSource = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com']);

  results = results.filter(r => {
    const title = String(r?.title || '').trim();
    const content = String(r?.content || '').trim();
    const urlText = String(r?.url || '');
    const host = getHost(r);
    const combined = `${title} ${content} ${urlText}`;
    if (!title || !urlText) return false;
    if (!relevance.test(combined)) return false;
    if (lowTitle.test(title) || lowContent.test(combined)) return false;
    if (smallVendor.test(combined) && !majorSource.has(host)) return false;
    if (indiaDate && !isFreshForTargetDate(r, indiaDate)) return false;
    if (indiaDate && hasExplicitOldDateInTitle(r, indiaDate)) return false;
    return true;
  });

  const seenUrls = new Set();
  const deduped = [];
  for (const r of results) {
    const key = String(r?.url || '').trim().toLowerCase().replace(/\/$/, '');
    if (!key || seenUrls.has(key)) continue;
    if (deduped.some(x => titleSimilarity(x.title, r.title) >= 0.68)) continue;
    seenUrls.add(key);
    deduped.push(r);
  }
  results = deduped;

  results.sort((a, b) => {
    const score = r => {
      const title = String(r?.title || '');
      const content = String(r?.content || '');
      const host = getHost(r);
      let s = 0;
      if (parsePublishedIndiaDate(r?.published_date) === indiaDate) s += 10;
      if (majorSource.has(host)) s += 12;
      else if (trusted.has(host)) s += 6;
      if (/\b(launch|release|released|acquisition|funding|research|chip|product|regulation|ruling|partnership|deploys?|unveils?|announces?|commits?|ships?|initiative|agreement|deal)\b/i.test(title)) s += 6;
      if (/\b(major|million|billion|official|new model|new product|acquisition|funding|series [a-e]|initiative|rollout|nationwide|global)\b/i.test(`${title} ${content}`)) s += 3;
      if (/\b(self[- ]?checkout|retail|shopping|marketing|sales enablement|hr platform)\b/i.test(`${title} ${content}`)) s -= 8;
      if (host === 'prnewswire.com' || host === 'businesswire.com') s -= 5;
      if (content.length > 300) s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  const data = Object.assign({}, successful.data || {}, { results: results.slice(0, 25) });
  return new Response(JSON.stringify(data), { status: successful.response.status, statusText: successful.response.statusText, headers: successful.response.headers });
};
