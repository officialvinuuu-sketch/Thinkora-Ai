// Thinkora Core — Universal AI Router foundation.
// This module defines one provider contract and deterministic provider selection.
// It is intentionally provider-agnostic: actual network calls are wired in a later step.

const { PROVIDERS, normalizeMode } = require('./config');

const ROUTER_VERSION = '1.0.0';

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
  const mode = request.mode;

  if (mode === 'offline') return PROVIDERS.offline;

  // Online is the default for Auto and explicit Online mode.
  // Specialized capabilities are represented here so future providers can
  // be selected without changing the public request contract.
  if (request.hasImage) return PROVIDERS.online;
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

module.exports = {
  ROUTER_VERSION,
  normalizeRequest,
  chooseProvider,
  createResult
};
