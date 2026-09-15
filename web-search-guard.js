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

function findSourceDates(result) {
  const dates = [];
  const published = normalizeDate(result?.published_date);
  if (published) dates.push(published);

  const url = String(result?.url || '');
  const urlDate = url.match(/(?:^|[^0-9])(20\d{2})[-\/]?(0[1-9]|1[0-2])[-\/]?(0[1-9]|[12]\d|3[01])(?:[^0-9]|$)/);
  if (urlDate) dates.push(`${urlDate[1]}-${urlDate[2]}-${urlDate[3]}`);

  const text = `${result?.title || ''} ${result?.content || ''}`;
  const textDate = text.match(/\b(20\d{2})[-\/]?(0[1-9]|1[0-2])[-\/]?(0[1-9]|[12]\d|3[01])\b/);
  if (textDate) dates.push(`${textDate[1]}-${textDate[2]}-${textDate[3]}`);

  return [...new Set(dates)];
}

global.fetch = async function(input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (url !== 'https://api.tavily.com/search' || !init || typeof init.body !== 'string') {
    return originalFetch(input, init);
  }

  let requestBody;
  try { requestBody = JSON.parse(init.body); } catch (_) { return originalFetch(input, init); }

  const query = String(requestBody.query || '');
  const aiNews = isAiNewsQuery(query);
  const indiaDate = extractIndiaDate(query);

  if (aiNews) {
    requestBody.query = `${query} Focus only on artificial intelligence, AI companies, AI models, AI products, AI chips, AI research, or AI policy news. Exclude unrelated general world, politics, sports, weather, or military news unless directly about AI.`.slice(0, 2000);
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
        const sourceDates = findSourceDates(r);
        return sourceDates.every(date => date === indiaDate);
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
