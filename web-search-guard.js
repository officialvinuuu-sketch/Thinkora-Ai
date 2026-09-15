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
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

function hasExplicitOldDateInTitle(result, targetDate) {
  const title = String(result?.title || '');
  if (!targetDate || !title) return false;
  const months = 'January February March April May June July August September October November December'.split(' ');
  const older = new RegExp(`\\b(?:${months.join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,)?\\s+20\\d{2}\\b`, 'i');
  const iso = title.match(/\\b20\\d{2}[-\\/]\\d{2}[-\\/]\\d{2}\\b/);
  if (iso && iso[0] !== targetDate) return true;
  const named = title.match(older);
  if (named) {
    const parsed = new Date(named[0].replace(/(st|nd|rd|th)/i, ''));
    if (!Number.isNaN(parsed.getTime())) {
      const titleDate = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
      return titleDate !== targetDate;
    }
  }
  return false;
}

function isFreshForTargetDate(result, targetDate) {
  if (!targetDate) return true;
  const raw = String(result?.published_date || '').trim();
  if (!raw) return true;
  const parsed = parsePublishedIndiaDate(raw);
  if (!parsed) return true;
  return parsed === targetDate;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|and|for|of|to|in|on|with|from|says|said|today|latest|ai)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  let out = String(text || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/\r/g, '')
    .replace(/^\s*\|?\s*#\s*\|.*$/gim, '')
    .replace(/^\s*\|?\s*-{2,}\s*\|.*$/gim, '')
    .replace(/^\s*\|?\s*Development[^\n]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = out.split('\n');
  let number = 0;
  out = lines.map(line => {
    const m = line.match(/^\s*\d+\.\s+(.*)$/);
    if (!m) return line;
    number += 1;
    return `${number}. ${m[1].trim()}`;
  }).join('\n');

  return out;
}

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  requestBody.messages[webIndex].content += `\n\nTHINKORA SMART WEB ANSWER MODE: Act like a careful research assistant, not a search-result summarizer. For current AI news, select only concrete, meaningful developments supported directly by the supplied sources. One real-world event = one answer item, even if multiple sources cover it. Prefer primary announcements and high-quality reporting; use secondary sources for corroboration, not as separate events. For explicit dates, use the target date as a hard freshness requirement. Do not include an article whose published date resolves to an older India calendar date. Do not use a URL date as proof of publication date. Never invent facts, dates, headlines, source names or URLs.\n\nHEADLINE AND SOURCE RULES: For each selected item, use the supplied source TITLE as the headline with only trivial punctuation cleanup; do not invent a new headline. The explanation must describe the same event as that TITLE. Copy the exact URL from that same supplied source. Do not combine facts from unrelated sources into one item. Do not use a weak company press release when a major independent report covers the same event. Avoid market-reaction stories, investor-sentiment stories, generic industry commentary, and small vendor announcements unless they represent a clearly major AI development.\n\nOUTPUT FORMAT RULES: Do NOT use a Markdown table. Do NOT output HTML such as <br>. Do NOT output a literal table separator such as |---|. Do NOT write labels like 'URL:' on a separate malformed line. Answer with a clean numbered list starting at 1 and incrementing by one. Each item must be: '1. **Exact source title** — 1-2 sentence explanation. Source: exact URL'. If fewer than five distinct verified major developments are supported, return only those and say 'Fewer than five verified developments were available.' Never fill the list with weak or duplicate items. Give the direct answer first and keep it concise.`;
}

async function normalizeCompletionResponse(response) {
  try {
    const data = await response.clone().json();
    const choice = data?.choices?.[0]?.message;
    if (choice && typeof choice.content === 'string') {
      choice.content = normalizeWebAssistantText(choice.content);
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
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

  if (url !== 'https://api.tavily.com/search' || !init || typeof init.body !== 'string') {
    return originalFetch(input, init);
  }

  let baseBody;
  try { baseBody = JSON.parse(init.body); } catch (_) { return originalFetch(input, init); }

  const query = String(baseBody.query || '');
  const aiNews = isAiNewsQuery(query);
  const indiaDate = extractIndiaDate(query);
  if (!aiNews) return originalFetch(input, init);

  const datePhrase = indiaDate
    ? ` Target date: ${indiaDate}. Return only developments newly reported, announced, released, published, or officially updated on that date. Do not treat yesterday's results as today's.`
    : '';

  const common = ` Focus on major concrete AI developments. Prioritize launches, model releases, product releases, research, funding, acquisitions, partnerships, infrastructure/chips, rollouts, court decisions, AI regulation, and major enterprise AI moves. Exclude generic explainers, opinion, commentary, jobs, market-reaction stories, investor-sentiment stories, stock-market stories, old incidents, podcasts about older stories, event-session listings, small vendor press releases, and unrelated news. One result should represent one distinct real-world development.${datePhrase}`;
  const queries = [
    `${query}${common} Find major AI company, model, product, agent, and platform developments.`,
    `${query}${common} Find major AI research, infrastructure, chips, funding, acquisition, partnership, and enterprise developments.`,
    `${query}${common} Find major AI policy, regulation, legal, safety, privacy, and court developments.`,
    `${query}${common} Find important AI launches and newly announced AI tools, services, and deployments.`,
    `${query}${common} Find important AI industry developments from high-quality technology and business reporting.`
  ];

  const requests = queries.map(q => {
    const body = Object.assign({}, baseBody, {
      query: q.slice(0, 2000),
      search_depth: 'basic',
      max_results: 8,
      include_answer: false,
      include_raw_content: false,
      topic: 'news',
      time_range: 'day'
    });
    return originalFetch(url, Object.assign({}, init, { body: JSON.stringify(body) }))
      .then(async response => {
        let data = null;
        try { data = await response.clone().json(); } catch (_) {}
        return { response, data };
      })
      .catch(() => ({ response: null, data: null }));
  });

  const fetched = await Promise.all(requests);
  const successful = fetched.find(x => x.response && x.response.ok);
  if (!successful) return fetched[0]?.response || originalFetch(input, init);

  let results = [];
  for (const item of fetched) {
    if (item.data && Array.isArray(item.data.results)) results.push(...item.data.results);
  }

  const relevance = /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|large language model|robotics|ai model|ai chip|agentic)\b/i;
  const lowTitle = /\b(opinion|commentary|explainer|guide|how to|what happens when|questions answered|market reaction|investors? nervous|investor sentiment|stocks?|share price|sentiment|resignation|former (?:president|employee|researcher)|podcast|newsletter|morning bid|slowdown debate|spending slowdown|industry warnings)\b/i;
  const lowContent = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|evergreen explainer|opinion column|investor anxiety|market anxiety|stock market reaction)\b/i;
  const trusted = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com','prnewswire.com','businesswire.com','apple.com','openai.com','anthropic.com','google.com','blog.google','microsoft.com','blogs.microsoft.com','nvidia.com']);

  results = results.filter(r => {
    const title = String(r?.title || '').trim();
    const content = String(r?.content || '').trim();
    const urlText = String(r?.url || '');
    const combined = `${title} ${content} ${urlText}`;
    if (!title || !urlText) return false;
    if (!relevance.test(combined)) return false;
    if (lowTitle.test(title)) return false;
    if (lowContent.test(combined)) return false;
    if (indiaDate && !isFreshForTargetDate(r, indiaDate)) return false;
    if (indiaDate && hasExplicitOldDateInTitle(r, indiaDate)) return false;
    return true;
  });

  const seenUrls = new Set();
  const deduped = [];
  for (const r of results) {
    const urlKey = String(r?.url || '').trim().toLowerCase().replace(/\/$/, '');
    if (!urlKey || seenUrls.has(urlKey)) continue;
    if (deduped.some(x => titleSimilarity(x.title, r.title) >= 0.72)) continue;
    seenUrls.add(urlKey);
    deduped.push(r);
  }
  results = deduped;

  results.sort((a, b) => {
    const score = r => {
      const title = String(r?.title || '');
      const content = String(r?.content || '');
      const host = getHost(r);
      let s = 0;
      const publishedIndia = parsePublishedIndiaDate(r?.published_date);
      if (publishedIndia === indiaDate) s += 8;
      if (trusted.has(host)) s += 7;
      if (/\b(launch|release|released|acquisition|funding|research|chip|product|regulation|ruling|partnership|warns?|warning|targets?|calls?|adds?|plans?|expands?|deploys?|integrates?|enables?|reveals?|unveils?|announces?|commits?|ships?)\b/i.test(title)) s += 5;
      if (/\b(major|million|billion|official|new model|new product|acquisition|funding|series [a-e]|initiative|rollout)\b/i.test(`${title} ${content}`)) s += 2;
      if (host === 'prnewswire.com' || host === 'businesswire.com') s -= 4;
      if (content.length > 250) s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  const data = Object.assign({}, successful.data || {}, { results: results.slice(0, 20) });
  return new Response(JSON.stringify(data), {
    status: successful.response.status,
    statusText: successful.response.statusText,
    headers: successful.response.headers
  });
};
