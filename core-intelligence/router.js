// Thinkora Core — Universal AI Router runtime.
// One normalized request enters the router; provider adapters execute it.
// Adapters stay outside this module so provider credentials and transport remain isolated.

const { PROVIDERS, normalizeMode } = require('./config');
const { shouldFallbackToOffline } = require('./provider-policy');

const ROUTER_VERSION = '1.3.0';

function normalizeRequest(input = {}) {
  const messages = Array.isArray(input.messages)
    ? input.messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    : [];

  return Object.freeze({
    message: typeof input.message === 'string' ? input.message.trim() : '',
    messages,
    mode: normalizeMode(input.mode),
    webSearch: input.webSearch === true,
    hasImage: input.hasImage === true,
    hasFile: Boolean(input.fileContext),
    fileContext: typeof input.fileContext === 'string' ? input.fileContext.slice(0, 80000) : '',
    fileName: typeof input.fileName === 'string' ? input.fileName.slice(0, 200) : ''
  });
}

function chooseProvider(request) {
  if (request.mode === 'offline') return PROVIDERS.offline;
  return PROVIDERS.online;
}

function createResult({ reply = '', provider = null, model = '', sources = [], streamed = false, fallback = false, error = null } = {}) {
  return Object.freeze({
    reply: String(reply || ''),
    sources: Array.isArray(sources) ? sources : [],
    mode: provider?.id === PROVIDERS.offline.id ? 'offline' : 'online',
    provider: provider?.id || null,
    model: model || '',
    streamed: Boolean(streamed),
    fallback: Boolean(fallback),
    error: error ? String(error.message || error) : null,
    routerVersion: ROUTER_VERSION
  });
}

function getAdapter(adapters, provider) {
  const adapter = adapters[provider.id];
  if (typeof adapter !== 'function') {
    const error = new Error(`No adapter configured for provider: ${provider.id}`);
    error.code = 'PROVIDER_ADAPTER_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
  return adapter;
}

async function execute(input, adapters = {}) {
  const request = normalizeRequest(input);
  const primaryProvider = chooseProvider(request);
  const primaryAdapter = getAdapter(adapters, primaryProvider);

  try {
    const result = await primaryAdapter(request, primaryProvider);
    return createResult({ ...(result || {}), provider: primaryProvider });
  } catch (primaryError) {
    if (request.mode !== 'auto' || primaryProvider.id !== PROVIDERS.online.id || !shouldFallbackToOffline(primaryError)) {
      throw primaryError;
    }
    if (primaryError?.streamedText) throw primaryError;

    const offlineProvider = PROVIDERS.offline;
    const offlineAdapter = getAdapter(adapters, offlineProvider);
    try {
      const result = await offlineAdapter(request, offlineProvider);
      return createResult({ ...(result || {}), provider: offlineProvider, fallback: true });
    } catch (offlineError) {
      offlineError.code = offlineError.code || 'OFFLINE_FALLBACK_FAILED';
      offlineError.primaryError = primaryError;
      throw offlineError;
    }
  }
}

// Streaming follows the same Auto policy. The streaming adapter must mark
// streamedText=true when any output has already reached the client so the
// router never splices Offline output into a partial Online response.
async function executeStream(input, adapters = {}) {
  const request = normalizeRequest(input);
  const primaryProvider = chooseProvider(request);
  const primaryAdapter = getAdapter(adapters, primaryProvider);

  try {
    const result = await primaryAdapter(request, primaryProvider);
    return createResult({ ...(result || {}), provider: primaryProvider, streamed: true });
  } catch (primaryError) {
    if (request.mode !== 'auto' || primaryProvider.id !== PROVIDERS.online.id || !shouldFallbackToOffline(primaryError)) {
      throw primaryError;
    }
    if (primaryError?.streamedText) throw primaryError;

    const offlineProvider = PROVIDERS.offline;
    const offlineAdapter = getAdapter(adapters, offlineProvider);
    try {
      const result = await offlineAdapter(request, offlineProvider);
      return createResult({ ...(result || {}), provider: offlineProvider, fallback: true, streamed: true });
    } catch (offlineError) {
      offlineError.code = offlineError.code || 'OFFLINE_STREAM_FALLBACK_FAILED';
      offlineError.primaryError = primaryError;
      throw offlineError;
    }
  }
}

module.exports = {
  ROUTER_VERSION,
  normalizeRequest,
  chooseProvider,
  createResult,
  execute,
  executeStream
};
