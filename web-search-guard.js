const originalFetch = global.fetch;

function isAiNewsQuery(query) {
  const q = String(query || '').toLowerCase();
  return /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia)\b/i.test(q) &&
    /\b(news|headline|headlines|breaking|latest|current|today|recent|development|developments)\b/i.test(q);
}

function extractIndiaDate(query) {
  const m = String(query || '').match(/Current date in India:\s*(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : '';
}

function normalizeDate(value) {
  const m = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function getUrlDate(result) {
  const url = String(result?.url || '');
  const m = url.match(/(?:^|\/)(20\d{2})[\/-](0[1-9]|1[0-2])[\/-](0[1-9]|[12]\d|3[01])(?:\/|[^0-9]|$)/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function getHost(result) {
  try { return new URL(String(result?.url || '')).hostname.toLowerCase().replace(/^www\./, ''); }
  catch (_) { return ''; }
}

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  requestBody.messages[webIndex].content += `\n\nSMART ANSWER MODE: Act like a capable research assistant, not a search-result copier. For news, rank supplied sources by relevance, recency, importance and source quality. Prioritize genuinely new major AI launches, model releases, research, funding, acquisitions, partnerships, products, chips, or policy/safety decisions. Exclude job listings, generic opinion, commentary, resignation posts, old incidents, evergreen explainers and unrelated stories. One article or primary event must produce at most one answer item; never split mentions inside one article into separate developments. Remove duplicate or near-duplicate stories. Use concise natural bullet points, not numbered lists. Do not dump snippets or source tables. Do not invent facts, headlines, dates, sources or URLs. For an explicit calendar-date request, only use a source when its supplied publication date or clearly date-stamped URL matches the requested date. If the source has no date evidence, exclude it rather than guessing. Never relabel an earlier source as today's news. If exact URLs are requested, copy them exactly from the supplied search results. If fewer genuinely distinct current developments are supported, return fewer rather than filling gaps. Use only the supplied Web Search Results for web-grounded claims.`;
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

  let body;
  try { body = JSON.parse(init.body); } catch (_) { return originalFetch(input, init); }

  const query = String(body.query || '');
  const aiNews = isAiNewsQuery(query);
  const indiaDate = extractIndiaDate(query);

  if (aiNews) {
    body.query = `${query} Focus only on clearly AI-focused current news. Prefer major new launches, model releases, research, funding, acquisitions, partnerships, products, chips, or policy/safety decisions. Exclude job listings, old incidents, generic opinion, commentary, resignation posts, evergreen explainers and unrelated stories. Return distinct primary developments only.`.slice(0, 2000);
    body.max_results = Math.max(Number(body.max_results) || 5, 10);
    body.time_range = 'day';
    body.topic = 'news';
  }

  const response = await originalFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
  if (!aiNews || !response.ok) return response;

  try {
    const data = await response.clone().json();
    let results = Array.isArray(data.results) ? data.results : [];
    const relevance = /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|large language model|robotics|ai model|ai chip)\b/i;
    const lowValue = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|opinion|column|commentary|explainer|how to|guide|resignation|exit note|former staff|former researcher|fearmongering|investor sentiment|market volatility)\b/i;
    const highValue = /\b(announc(?:e|ed|es|ement)|launch(?:ed|es)?|release(?:d|s)?|unveil(?:ed|s)?|debut(?:ed|s)?|funding|raised|acqui(?:re|red|res)|partnership|deal|model|chip|policy|regulation|research|study|benchmark|security|product|rollout|update|open[- ]source|investment)\b/i;
    const trusted = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com']);

    results = results.filter(r => relevance.test(`${r.title || ''} ${r.content || ''} ${r.url || ''}`));

    if (indiaDate) {
      results = results.filter(r => {
        const published = normalizeDate(r?.published_date);
        const urlDate = getUrlDate(r);
        // For an explicit calendar date, require direct date evidence. This prevents older stories from being presented as current.
        if (published) return published === indiaDate;
        if (urlDate) return urlDate === indiaDate;
        return false;
      });
    }

    const seen = new Set();
    results = results.filter(r => {
      const key = String(r.url || '').trim().toLowerCase().replace(/\/$/, '') || String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    results.sort((a, b) => {
      const score = r => {
        const text = `${r.title || ''} ${r.content || ''}`.toLowerCase();
        const host = getHost(r);
        let s = 0;
        const published = normalizeDate(r?.published_date);
        const urlDate = getUrlDate(r);
        if (published === indiaDate) s += 8;
        if (urlDate === indiaDate) s += 3;
        if (highValue.test(text)) s += 4;
        if (lowValue.test(text)) s -= 10;
        if (trusted.has(host)) s += 5;
        if (/\b(major|million|billion|new model|new product|official|breakthrough)\b/i.test(text)) s += 2;
        return s;
      };
      return score(b) - score(a);
    });

    return new Response(JSON.stringify(Object.assign({}, data, { results: results.slice(0, 10) })), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (_) { return response; }
};
