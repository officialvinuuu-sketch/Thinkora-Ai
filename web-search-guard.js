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

function hasConflictingUrlDate(result, indiaDate) {
  const url = String(result?.url || '');
  const match = url.match(/\/(20\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])(?:\/|$)/);
  if (!match) return false;
  const urlDate = `${match[1]}-${match[2]}-${match[3]}`;
  return urlDate !== indiaDate;
}

function findSourceDates(result) {
  const dates = [];
  const published = normalizeDate(result?.published_date);
  if (published) dates.push(published);

  const url = String(result?.url || '');
  const urlDate = url.match(/(?:^|[^0-9])(20\d{2})[-\/]?(0[1-9]|1[0-2])[-\/]?(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  if (urlDate) dates.push(`${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`);

  const text = `${result?.title || ''} ${result?.content || ''}`;
  const numericDate = text.match(/\b(20\d{2})[-\/]?(0[1-9]|1[0-2])[-\/]?(0[1-9]|[12]\d|3[01])\b/);
  if (numericDate) dates.push(`${numericDate[1]}-${numericDate[2]}-${numericDate[3]}`);

  const writtenDate = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i);
  if (writtenDate) {
    const month = {
      january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
      july:'07', august:'08', september:'09', october:'10', november:'11', december:'12'
    }[writtenDate[1].toLowerCase()];
    dates.push(`${writtenDate[3]}-${month}-${String(writtenDate[2]).padStart(2, '0')}`);
  }

  return [...new Set(dates)];
}

function improveWebAnswer(requestBody) {
  if (!Array.isArray(requestBody.messages)) return;
  const webIndex = requestBody.messages.findIndex(m =>
    m && m.role === 'system' && typeof m.content === 'string' &&
    m.content.includes('The user explicitly enabled Web Search')
  );
  if (webIndex < 0) return;

  const instruction = `\n\nSMART ANSWER MODE: Act like a capable research assistant, not a search-result copier. Synthesize the supplied sources into a concise, natural answer that directly answers the user's question. Do not dump the search-result table or repeat raw snippets. For news/headline requests, give a clean numbered list with the exact source headline when requested, followed by a brief useful summary only when supported by the source. Do not output raw URLs unless the user explicitly asks for source URLs. If the user explicitly asks for exact source URLs, include the exact URL for each verified item, but keep the presentation clean and concise. Never create duplicate numbering, placeholder text, fake headlines, fake dates, or unsupported claims. Use only the supplied sources for web-grounded claims.`;
  requestBody.messages[webIndex].content += instruction;
}

global.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';

  // Make Web Search answers read like a smart assistant instead of a raw search dump.
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
    requestBody.query = `${query} Focus only on artificial intelligence, AI companies, AI models, AI products, AI chips, AI research, or AI policy news. Exclude unrelated general world, politics, sports, weather, or military news unless directly about AI. Return only results that are clearly about AI.`.slice(0, 2000);
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
        const sourceDates = findSourceDates(r);
        return sourceDates.length > 0 && sourceDates.every(date => date === indiaDate);
      });
    }

    return new Response(JSON.stringify(Object.assign({}, data, { results })), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (_) {
    return response;
  }
};
