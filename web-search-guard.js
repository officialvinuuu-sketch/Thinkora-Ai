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

  const instruction = `\n\nSMART ANSWER MODE: Act like a capable research assistant, not a search-result copier. First understand the user's intent, then use the supplied sources to select the most relevant and freshest evidence. Synthesize the evidence into a concise, natural answer. For news requests, rank items by relevance and recency and remove duplicate or near-duplicate stories. Do not simply echo the search-result order. Do not dump raw snippets or a markdown source table. Use clean numbered bullets when listing multiple developments. Preserve the source's exact headline only when the user asks for the exact headline; otherwise you may summarize it naturally. Do not output raw URLs unless the user explicitly asks for them. If exact source URLs are requested, copy them exactly from the supplied sources and associate each URL with the correct item. Never invent headlines, dates, sources, URLs, or facts. If the supplied sources are insufficient, say so rather than filling gaps. Use only the supplied Web Search Results for web-grounded claims.`;
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
    requestBody.query = `${query} Focus only on artificial intelligence, AI companies, AI models, AI products, AI chips, AI research, or AI policy news. Exclude unrelated general world, politics, sports, weather, or military news unless directly about AI. Return only clearly AI-focused news.`.slice(0, 2000);
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
        // A dated URL is strong evidence of the article date. Reject it when it conflicts.
        if (hasConflictingUrlDate(r, indiaDate)) return false;

        // A provider publication date is also strong evidence. Do not inspect arbitrary
        // dates mentioned inside article text because those may refer to older events.
        const published = getPublishedDate(r);
        if (published && published !== indiaDate) return false;

        // Keep undated URLs only when they have no explicit conflicting publication date.
        return true;
      });
    }

    // Remove duplicate URLs and near-duplicate titles while preserving source order.
    const seenUrls = new Set();
    const seenTitleKeys = new Set();
    results = results.filter(r => {
      const normalizedUrl = String(r.url || '').trim().toLowerCase().replace(/\/$/, '');
      const titleKey = String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).slice(0, 10).join(' ');
      if (normalizedUrl && seenUrls.has(normalizedUrl)) return false;
      if (titleKey && seenTitleKeys.has(titleKey)) return false;
      if (normalizedUrl) seenUrls.add(normalizedUrl);
      if (titleKey) seenTitleKeys.add(titleKey);
      return true;
    });

    // Prefer results with an explicit publication date and stronger AI relevance.
    results.sort((a, b) => {
      const aDate = getPublishedDate(a) === indiaDate ? 1 : 0;
      const bDate = getPublishedDate(b) === indiaDate ? 1 : 0;
      if (aDate !== bDate) return bDate - aDate;
      const aText = `${a.title || ''} ${a.content || ''}`.toLowerCase();
      const bText = `${b.title || ''} ${b.content || ''}`.toLowerCase();
      const terms = ['artificial intelligence', 'generative ai', 'ai model', 'openai', 'anthropic', 'gemini', 'nvidia', 'llm'];
      const score = text => terms.reduce((n, term) => n + (text.includes(term) ? 1 : 0), 0);
      return score(bText) - score(aText);
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
