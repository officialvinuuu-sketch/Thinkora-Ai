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
    // Tavily's day window is UTC-based; the explicit India date in the query is safer for India-day news.
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

    // For an explicit India-date news request, reject results whose source provides a conflicting publication date.
    if (indiaDate) {
      results = results.filter(r => {
        if (!r.published_date) return true;
        return String(r.published_date).slice(0, 10) === indiaDate;
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
