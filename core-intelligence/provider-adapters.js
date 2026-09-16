// Thinkora Core — provider adapter helpers.
// Adapters receive the normalized router request and delegate transport to injected functions.
// No provider credential is stored here.

function createOnlineAdapter({ execute, stream } = {}) {
  if (typeof execute !== 'function') throw new TypeError('Online adapter requires execute().');
  return async function onlineAdapter(request, provider) {
    const result = await execute(request, provider);
    return { ...(result || {}), provider };
  };
}

function createOnlineStreamAdapter({ stream } = {}) {
  if (typeof stream !== 'function') throw new TypeError('Online stream adapter requires stream().');
  return async function onlineStreamAdapter(request, provider) {
    const result = await stream(request, provider);
    return { ...(result || {}), provider, streamed: true };
  };
}

function createOfflineAdapter({ execute } = {}) {
  if (typeof execute !== 'function') throw new TypeError('Offline adapter requires execute().');
  return async function offlineAdapter(request, provider) {
    const result = await execute(request, provider);
    return { ...(result || {}), provider };
  };
}

module.exports = {
  createOnlineAdapter,
  createOnlineStreamAdapter,
  createOfflineAdapter
};
