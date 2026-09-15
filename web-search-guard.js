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

  requestBody.messages[webIndex].content += `\n\nSMART ANSWER MODE: For current AI news, behave like a strict editor. A result is eligible only when its actual article title represents a concrete, new AI event such as a launch, model release, product release, research result, funding round, acquisition, partnership, chip/hardware announcement, rollout, or policy/regulatory decision. Do not promote background articles, generic explainers, market reaction, opinion, commentary, event-session descriptions, old incidents, job listings, or articles that merely mention AI. One article/primary event produces at most one item. Deduplicate near-identical reports of the same event. Do not turn a source snippet into a new headline that is not supported by its title. For explicit calendar-date requests, treat Tavily's current-day news window and source publication metadata as the primary freshness signals. Do not reject a current result only because a publisher URL contains an older path date or because the article text mentions an older date. Reject a result when its publication metadata is explicitly older than the requested date and there is no stronger current-day publication signal. If fewer genuinely distinct current developments are supported, return fewer. Never invent facts, dates, headlines, sources or URLs. Use only supplied Web Search Results for web-grounded claims.`;
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
    const datePhrase = indiaDate
      ? ` The target news date is ${indiaDate}. Search the current-day news window for concrete AI developments first reported or officially announced on that date. Do not intentionally seek older stories.`
      : '';
    body.query = `${query} Focus only on concrete AI news developments. Prioritize major new launches, model releases, research results, funding, acquisitions, partnerships, products, chips/hardware, rollouts, or policy/regulatory decisions. Exclude job listings, old incidents, generic opinion, commentary, market-reaction stories, evergreen explainers, event-session descriptions, and unrelated news. Each result should represent one distinct primary development.${datePhrase}`.slice(0, 2000);
    body.max_results = Math.max(Number(body.max_results) || 5, 12);
    body.time_range = 'day';
    body.topic = 'news';
  }

  const response = await originalFetch(input, Object.assign({}, init, { body: JSON.stringify(body) }));
  if (!aiNews || !response.ok) return response;

  try {
    const data = await response.clone().json();
    let results = Array.isArray(data.results) ? data.results : [];

    const relevance = /\b(ai|artificial intelligence|machine learning|generative ai|genai|openai|chatgpt|anthropic|gemini|claude|copilot|nvidia|deepmind|llm|large language model|robotics|ai model|ai chip)\b/i;
    const titleEvent = /\b(new|launch(?:es|ed)?|release(?:s|d)?|released|introduc(?:es|ed)|announc(?:es|ed|ement)|unveil(?:s|ed)|acqui(?:res|red)|buy(?:s|ing)?|raise(?:s|d)?|funding|financing|partnership|partner(?:s|ed)?|deal|investment|invest(?:s|ed)?|rolls? out|rollout|ships?|debut(?:s|ed)|secures?|research|study|benchmark|model|chip|product|tool|service|deal|policy|regulation)\b/i;
    const lowValueTitle = /\b(opinion|commentary|explainer|guide|how to|what happens when|questions answered|market reaction|stocks?|stock|sentiment|resignation|former (?:president|employee|researcher)|slowdown|slow down)\b/i;
    const lowValueContent = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|evergreen explainer|opinion column)\b/i;
    const trusted = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com','prnewswire.com','businesswire.com']);

    results = results.filter(r => {
      const title = String(r?.title || '').trim();
      const content = String(r?.content || '').trim();
      const combined = `${title} ${content} ${String(r?.url || '')}`;
      if (!relevance.test(combined)) return false;
      if (!titleEvent.test(title)) return false;
      if (lowValueTitle.test(title)) return false;
      if (lowValueContent.test(combined)) return false;

      if (indiaDate) {
        const published = normalizeDate(r?.published_date);
        // Tavily time_range:'day' is the main freshness gate. Only reject an
        // explicitly older publication timestamp; do not inspect article text
        // or URL path dates because both commonly contain historical dates.
        if (published && published < indiaDate) return false;
      }
      return true;
    });

    const seenUrls = new Set();
    const seenTitles = new Set();
    results = results.filter(r => {
      const titleKey = String(r?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 180);
      const urlKey = String(r?.url || '').trim().toLowerCase().replace(/\/$/, '');
      if (!titleKey && !urlKey) return false;
      if (urlKey && seenUrls.has(urlKey)) return false;
      if (titleKey && seenTitles.has(titleKey)) return false;
      if (urlKey) seenUrls.add(urlKey);
      if (titleKey) seenTitles.add(titleKey);
      return true;
    });

    results.sort((a, b) => {
      const score = r => {
        const title = String(r?.title || '');
        const text = `${title} ${r?.content || ''}`;
        const host = getHost(r);
        let s = 0;
        const published = normalizeDate(r?.published_date);
        if (published === indiaDate) s += 8;
        if (trusted.has(host)) s += 6;
        if (titleEvent.test(title)) s += 5;
        if (/\b(major|million|billion|official|new model|new product|acquisition|funding|series [a-e]|launch|released|announced)\b/i.test(text)) s += 2;
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
