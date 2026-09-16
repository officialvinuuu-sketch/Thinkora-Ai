const PROVIDERS = Object.freeze({
  online: Object.freeze({
    id: 'gemini-online',
    label: 'Smart Online',
    endpoint: '/api/online-chat-stream',
    credential: 'GEMINI_API_KEY'
  }),
  offline: Object.freeze({
    id: 'llama-local',
    label: 'Offline AI',
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    credential: null
  })
});

const MODES = Object.freeze(['auto', 'online', 'offline']);
const DEFAULT_MODE = 'auto';

function normalizeMode(value) {
  return MODES.includes(value) ? value : DEFAULT_MODE;
}

module.exports = { PROVIDERS, MODES, DEFAULT_MODE, normalizeMode };
