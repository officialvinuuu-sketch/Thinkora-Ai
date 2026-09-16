// Thinkora Core — Universal AI Router runtime foundation.
// One normalized request enters the router; provider adapters execute it.
// Adapters stay outside this module so provider credentials and transport remain isolated.

const { PROVIDERS, normalizeMode } = require('./config');

const ROUTER_VERSION = '1.1.0';

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
  // Auto and explicit Online currently use the production Gemini adapter.
  // More online providers can be added here without changing the request contract.
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

async function execute(input, adapters = {}) {
  const request = normalizeRequest(input);
  const provider = chooseProvider(request);
  const adapter = adapters[provider.id];
  if (typeof adapter !== 'function') {
    const error = new Error(`No adapter configured for provider: ${provider.id}`);
    error.code = 'PROVIDER_ADAPTER_UNAVAILABLE';
    error.status = 503;
    throw error;
  }

  const result = await adapter(request, provider);
  return createResult({ ...(result || {}), provider });
}

module.exports = {
  ROUTER_VERSION,
  normalizeRequest,
  chooseProvider,
  createResult,
  execute
};
