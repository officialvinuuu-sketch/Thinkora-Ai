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
  const iso = title.match(/\\b20\\d{2}[-\/]\\d{2}[-\/]\\d{2}\\b/);
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

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  requestBody.messages[webIndex].content += `\n\nTHINKORA SMART WEB ANSWER MODE: Act like a careful research assistant, not a search-result summarizer. First understand the user's intent, then select only the strongest evidence. For current AI news, a qualifying item must describe a concrete, meaningful development: a launch, release, research result, funding round, acquisition, partnership, infrastructure/chip announcement, rollout, court/regulatory decision, or other clearly new event. Do not promote opinion pieces, generic explainers, market reaction, job listings, background stories, old incidents, podcasts about older news, event-session listings, or articles that merely mention AI. Do not turn a snippet into a new headline. Keep the source's actual headline meaning intact. One real-world event must produce at most one answer item even when several sources cover it. Prefer primary announcements and high-quality reporting; use secondary sources for corroboration, not as separate events. For a request for the top 5, return up to 5 genuinely distinct high-value developments, not five just to fill the quota. If only 2 or 3 are well supported, return only those and say fewer verified developments were available. For explicit dates, use the target date as a hard freshness requirement. Publisher timestamps and URLs can use different time zones, so do not reject a current-day result solely because its metadata or URL uses a neighboring calendar date. However, if the article TITLE itself explicitly states an older publication/event date, reject it. Never invent facts, dates, headlines, rankings, sources or URLs. Use only supplied Web Search Results for web-grounded claims. Give a direct answer first, then concise supporting details. Use natural headings and bullets when useful, avoid repetitive disclaimers, and clearly distinguish verified facts from uncertainty.`;
}

global.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';

  if (url.includes('router.huggingface.co/v1/chat/completions') && init && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body);
      improveWebAnswer(body);
      return originalFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
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
    ? ` Target date: ${indiaDate}. Return only developments newly reported, announced, released, published, or officially updated in that date window. Do not treat older news as today's news.`
    : '';

  const common = ` Focus on major concrete AI developments. Prioritize launches, model releases, product releases, research, funding, acquisitions, partnerships, infrastructure/chips, rollouts, court decisions, and AI regulation. Exclude generic explainers, opinion, commentary, job listings, market-reaction stories, old incidents, podcasts about older stories, and unrelated news. One result should represent one distinct real-world development.${datePhrase}`;
  const queries = [
    `${query}${common} Find the most important AI company and product developments.`,
    `${query}${common} Find major AI research, infrastructure, funding, acquisition, and partnership developments.`,
    `${query}${common} Find major AI policy, regulation, legal, safety, and platform developments.`
  ];

  const requests = queries.map(q => {
    const body = Object.assign({}, baseBody, {
      query: q.slice(0, 2000),
      search_depth: 'basic',
      max_results: 6,
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
  const eventTitle = /\b(launch(?:es|ed)?|release(?:s|d)?|released|introduc(?:es|ed)|announc(?:es|ed|ement)|unveil(?:s|ed)|acqui(?:res|red)|acquisition|buy(?:s|ing)?|raise(?:s|d)?|funding|financing|partnership|partner(?:s|ed)?|deal|investment|invest(?:s|ed)?|rolls? out|rollout|ships?|shipped|debut(?:s|ed)|secures?|research|researcher|study|benchmark|model|chip|product|opens?|publishes?|files?|court|judge|regulation|regulatory|policy|consultation|approval|ruling|lawsuit|warns?|warning|targets?|calls?|adds?|slows?|plans?|expands?|backs?|supports?|faces?|tests?|deploys?|integrates?|enables?|reveals?|unveils?)\b/i;
  const lowTitle = /\b(opinion|commentary|explainer|guide|how to|what happens when|questions answered|market reaction|stocks?|sentiment|resignation|former (?:president|employee|researcher)|podcast|newsletter|morning bid|slowdown debate)\b/i;
  const lowContent = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|evergreen explainer|opinion column)\b/i;
  const trusted = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com','prnewswire.com','businesswire.com','apple.com','openai.com','anthropic.com','google.com','blog.google','microsoft.com','blogs.microsoft.com','nvidia.com']);

  results = results.filter(r => {
    const title = String(r?.title || '').trim();
    const content = String(r?.content || '').trim();
    const urlText = String(r?.url || '');
    const combined = `${title} ${content} ${urlText}`;
    if (!title || !urlText) return false;
    if (!relevance.test(combined)) return false;
    if (!eventTitle.test(title)) return false;
    if (lowTitle.test(title)) return false;
    if (lowContent.test(combined)) return false;
    if (indiaDate && hasExplicitOldDateInTitle(r, indiaDate)) return false;
    return true;
  });

  // Remove exact URLs and near-identical headlines while keeping different events from the same publisher.
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
      if (/\b(launch|release|released|acquisition|funding|research|chip|product|regulation|ruling|partnership)\b/i.test(title)) s += 5;
      if (/\b(major|million|billion|official|new model|new product|acquisition|funding|series [a-e])\b/i.test(`${title} ${content}`)) s += 2;
      if (content.length > 250) s += 1;
      return s;
    };
    return score(b) - score(a);
  });

  const data = Object.assign({}, successful.data || {}, { results: results.slice(0, 12) });
  return new Response(JSON.stringify(data), {
    status: successful.response.status,
    statusText: successful.response.statusText,
    headers: successful.response.headers
  });
};
