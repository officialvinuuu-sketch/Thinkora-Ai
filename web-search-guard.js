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

function getTextDate(result) {
  const text = `${result?.title || ''} ${result?.content || ''}`;
  const months = 'January February March April May June July August September October November December'.split(' ');
  const monthPattern = months.join('|');
  const long = text.match(new RegExp(`\\b(${monthPattern})\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, 'i'));
  if (long) {
    const month = months.findIndex(m => m.toLowerCase() === long[1].toLowerCase()) + 1;
    return `${long[3]}-${String(month).padStart(2, '0')}-${String(long[2]).padStart(2, '0')}`;
  }
  const short = text.match(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s+(${monthPattern})(?:,)?\\s+(20\\d{2})\\b`, 'i'));
  if (short) {
    const month = months.findIndex(m => m.toLowerCase() === short[2].toLowerCase()) + 1;
    return `${short[3]}-${String(month).padStart(2, '0')}-${String(short[1]).padStart(2, '0')}`;
  }
  const iso = text.match(/\b(20\d{2})[-\/](0[1-9]|1[0-2])[-\/](0[1-9]|[12]\d|3[01])\b/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : '';
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

  requestBody.messages[webIndex].content += `\n\nSMART ANSWER MODE: For current AI news, behave like a strict editor. A result is eligible only when its actual article title represents a concrete, new AI event such as a launch, model release, product release, research result, funding round, acquisition, partnership, chip/hardware announcement, rollout, or policy/regulatory decision. Do not promote background articles, generic explainers, market reaction, opinion, commentary, event-session descriptions, old incidents, job listings, or articles that merely mention AI. One article/primary event produces at most one item. Deduplicate near-identical reports of the same event. Do not turn a source snippet into a new headline that is not supported by its title. For explicit calendar-date requests, prefer sources with a direct target-date signal in the article text/title/URL. A stale publication metadata field alone must not override a direct target-date signal in the source. But if the article text/title/URL explicitly shows an older date, reject it. If fewer genuinely distinct current developments are supported, return fewer. Never invent facts, dates, headlines, sources or URLs. Use only supplied Web Search Results for web-grounded claims.`;
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
      ? ` The target news date is ${indiaDate}. Find concrete AI developments first reported or officially announced on that date; do not return older articles merely because they mention AI.`
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
    const titleEvent = /\b(new|launch(?:es|ed)?|release(?:s|d)?|released|introduc(?:es|ed)|announc(?:es|ed|ement)|unveil(?:s|ed)|acqui(?:res|red)|buy(?:s|ing)?|raise(?:s|d)?|funding|financing|partnership|partner(?:s|ed)?|deal|investment|invest(?:s|ed)?|rolls? out|rollout|ships?|debut(?:s|ed)|secures?|raises?|research|study|benchmark|model|chip|product)\b/i;
    const lowValueTitle = /\b(opinion|commentary|explainer|guide|how to|what happens when|questions answered|calls? for|urges?|may need to|warns?|warning|highlights?|analysis|market reaction|stocks?|stock|sentiment|resignation|former (?:president|employee|researcher)|slowdown|slow down)\b/i;
    const lowValueContent = /\b(job listings?|careers?|hiring|vacanc(?:y|ies)|jobs? board|evergreen explainer|opinion column)\b/i;
    const trusted = new Set(['reuters.com','apnews.com','bbc.com','bbc.co.uk','bloomberg.com','ft.com','wsj.com','nytimes.com','theverge.com','techcrunch.com','wired.com','arstechnica.com','technologyreview.com','cnbc.com','forbes.com','venturebeat.com','prnewswire.com','businesswire.com']);

    results = results.filter(r => {
      const title = String(r?.title || '').trim();
      const content = String(r?.content || '').trim();
      const urlText = String(r?.url || '');
      const combined = `${title} ${content} ${urlText}`;
      if (!relevance.test(combined)) return false;
      if (!titleEvent.test(title)) return false;
      if (lowValueTitle.test(title)) return false;
      if (lowValueContent.test(combined)) return false;

      if (indiaDate) {
        const published = normalizeDate(r?.published_date);
        const urlDate = getUrlDate(r);
        const textDate = getTextDate(r);
        // Direct article date signals are stronger than Tavily metadata because the latter can be timezone-based.
        if (urlDate && urlDate !== indiaDate) return false;
        if (textDate && textDate !== indiaDate) return false;
        // If no direct date signal exists, keep only results that came from Tavily's current-day news window.
        // A conflicting metadata date alone is tolerated when the source itself has no conflicting date.
        if (!urlDate && !textDate && published && published !== indiaDate) return false;
      }
      return true;
    });

    const seen = new Set();
    results = results.filter(r => {
      const titleKey = String(r?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 180);
      const urlKey = String(r?.url || '').trim().toLowerCase().replace(/\/$/, '');
      const key = urlKey || titleKey;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Prefer primary-source reporting of a concrete event and stronger sources, then fresher explicit dates.
    results.sort((a, b) => {
      const score = r => {
        const title = String(r?.title || '');
        const text = `${title} ${r?.content || ''}`;
        const host = getHost(r);
        let s = 0;
        const published = normalizeDate(r?.published_date);
        const urlDate = getUrlDate(r);
        const textDate = getTextDate(r);
        if (urlDate === indiaDate) s += 8;
        if (textDate === indiaDate) s += 8;
        if (published === indiaDate) s += 3;
        if (trusted.has(host)) s += 5;
        if (titleEvent.test(title)) s += 5;
        if (/\b(major|million|billion|official|new model|new product|acquisition|funding|series [a-e])\b/i.test(text)) s += 2;
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
