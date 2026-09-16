const TRANSIENT_HTTP = new Set([408, 429, 500, 502, 503, 504]);

function isTransientError(error) {
  return TRANSIENT_HTTP.has(Number(error?.status));
}

function shouldFallbackToOffline(error) {
  if (!error) return true;
  if (error.name === 'AbortError') return true;
  if (isTransientError(error)) return true;
  return true;
}

module.exports = { TRANSIENT_HTTP, isTransientError, shouldFallbackToOffline };
