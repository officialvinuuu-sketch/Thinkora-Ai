const originalFetch = global.fetch;

function isAiNewsQuery(query) {
  const q = String(query || '').toLowerCase();
  return /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia)\b/i.test(q) &&
    /\b(news|headline|headlines|breaking|latest|current|today|recent)\b/i.test(q);
}

function extractIndiaDate(query) {
  const match = String(query || '').match(/Current date in India:\s*(\d{4}-\d{2}-\d{2})/i);
  return match ? match[1] : '';
}

function normalizeDate(value) {
  const match = String(value || '').match(/(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function getUrlDate(result) {
  const url = String(result?.url || '');
  const match = url.match(/(?:^|\/)(20\d{2})[\/-](0[1-9]|1[0-2])[\/-](0[1-9]|[12]\d|3[01])(?:\/|[^0-9]|$)/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function hasConflictingUrlDate(result, indiaDate) {
  const urlDate = getUrlDate(result);
  return Boolean(urlDate && indiaDate && urlDate !== indiaDate);
}

function getPublishedDate(result) {
  return normalizeDate(result?.published_date);
}

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  const instruction = `\n\nSMART ANSWER MODE: Act like a capable research assistant, not a search-result copier. First understand the user's intent, then select the most relevant and freshest supplied evidence. For news requests, prioritize substantive current developments that materially matter to AI: major launches or releases, important model or product announcements, significant research findings, major funding/acquisitions/partnerships, meaningful AI policy or safety decisions, and major company or industry changes. Prefer direct reporting of a new development over job listings, old incidents, evergreen explainers, generic opinion, resignation posts, speculative commentary, or articles whose main event happened earlier. Rank by importance, relevance and recency, then remove duplicate or near-duplicate stories. Do not simply echo search-result order. Synthesize evidence into a concise, natural answer and explain why each item matters when useful. Use simple bullet points (•) for multiple developments; do NOT use numbered lists and do NOT repeat the same number. Do not dump raw snippets or a markdown source table. Preserve the source's exact headline only when the user asks for the exact headline; otherwise summarize naturally. Do not output raw URLs unless the user explicitly asks for them. If exact source URLs are requested, copy them exactly from the supplied sources and associate each URL with the correct item. Never invent headlines, dates, sources, URLs, or facts. IMPORTANT: A supplied source does not need a published_date field to be usable. The search was explicitly performed for today's India date. If a source has no explicit conflicting date, it may be used as current evidence, but never invent or state a publication date that the source does not provide. Reject a source as stale when its supplied publication date, URL date, or source text clearly shows it is from an earlier date. Do not say that no current sources exist merely because publication-date metadata is missing. If the supplied sources are genuinely insufficient for a confident answer, say so rather than filling gaps. Use only the supplied Web Search Results for web-grounded claims.`;
  requestBody.messages[webIndex].content += instruction;
}

global.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';

  if (url.includes('router.huggingface.co/v1/chat/completions') && init && typeof init.body === 'string') {
    try {
      const requestBody = JSON.parse(init.body);
      improveWebAnswer(requestBody);
      return originalFetch(input, Object.assign({}, init, { body: JSON.stringify(requestBody) }));
    } catch (_) {
      return originalFetch(input, init);
    }
  }

  if (url !== 'https://api.tavily.com/search' || !init || typeof init.body !== 'string') {
    return originalFetch(input, init);
  }

  let requestBody;
  try { requestBody = JSON.parse(init.body); } catch (_) { return originalFetch(input, init); }

  const query = String(requestBody.query || '');
  const aiNews = isAiNewsQuery(query);
  const indiaDate = extractIndiaDate(query);

  if (aiNews) {
    requestBody.query = `${query} Focus only on artificial intelligence, AI companies, AI models, AI products, AI chips, AI research, or AI policy news. Prefer substantive new developments reported or announced today. Prioritize major launches, releases, research, funding, acquisitions, partnerships, policy or safety decisions. Exclude job listings, old incidents, evergreen explainers, generic opinion, resignation posts, speculative commentary, and unrelated general world, politics, sports, weather, or military news unless directly about a new AI development. Return only clearly AI-focused current news.`.slice(0, 2000);
    requestBody.max_results = Math.max(Number(requestBody.max_results) || 5, 10);
    if (indiaDate) delete requestBody.time_range;
  }

  const response = await originalFetch(input, Object.assign({}, init, { body: JSON.stringify(requestBody) }));
  if (!aiNews || !response.ok) return response;

  try {
    const data = await response.clone().json();
    const relevance = /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|large language model|robotics|ai model|ai chip)\b/i;
    let results = Array.isArray(data.results) ? data.results : [];

    results = results.filter(r => {
      const text = `${r.title || ''} ${r.content || ''} ${r.url || ''}`;
      return relevance.test(text);
    });

    if (indiaDate) {
      results = results.filter(r => {
        if (hasConflictingUrlDate(r, indiaDate)) return false;
        const published = getPublishedDate(r);
        if (published && published !== indiaDate) return false;
        return true;
      });
    }

    const seenUrls = new Set();
    const seenTitleKeys = new Set();
    results = results.filter(r => {
      const normalizedUrl = String(r.url || '').trim().toLowerCase().replace(/\/$/, '');
      const titleKey = String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 12).join(' ');
      if (normalizedUrl && seenUrls.has(normalizedUrl)) return false;
      if (titleKey && seenTitleKeys.has(titleKey)) return false;
      if (normalizedUrl) seenUrls.add(normalizedUrl);
      if (titleKey) seenTitleKeys.add(titleKey);
      return true;
    });

    const lowValue = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|opinion|column|commentary|explainer|how to|guide|resignation|exit note|former staff|former researcher|warns of|fearmongering|investor sentiment|stock (?:market|shares?)|market volatility)\b/i;
    const highValue = /\b(announc(?:e|ed|es|ement)|launch(?:ed|es)?|release(?:d|s)?|unveil(?:ed|s)?|debut(?:ed|s)?|funding|raised|acqui(?:re|red|res)|partnership|deal|model|chip|policy|regulation|research|study|benchmark|security|product|rollout|update|open[- ]source|investment)\b/i;
    const majorSignal = /\b(billion|million|major|breakthrough|new model|new product|world's first|first-of-its-kind|largest|significant|official)\b/i;

    results.sort((a, b) => {
      const score = result => {
        const text = `${result.title || ''} ${result.content || ''}`.toLowerCase();
        let value = 0;
        if (getPublishedDate(result) === indiaDate) value += 5;
        if (getUrlDate(result) === indiaDate) value += 2;
        if (highValue.test(text)) value += 4;
        if (majorSignal.test(text)) value += 2;
        if (lowValue.test(text)) value -= 8;
        if (/\b(announced today|launched today|released today|published today|today)\b/i.test(text)) value += 2;
        const terms = ['artificial intelligence', 'generative ai', 'ai model', 'openai', 'anthropic', 'gemini', 'nvidia', 'llm'];
        value += terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
        return value;
      };
      return score(b) - score(a);
    });

    return new Response(JSON.stringify(Object.assign({}, data, { results: results.slice(0, 10) })), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (_) {
    return response;
  }
};
