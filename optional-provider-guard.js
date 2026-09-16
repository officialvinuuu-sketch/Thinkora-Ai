// Keep optional Hugging Face/OpenAI-compatible provider from crashing Thinkora at startup.
// The provider is intentionally unavailable when HF_TOKEN is absent; provider-dependent
// endpoints can surface a normal runtime error while Gemini/Offline remain bootable.
const Module = require('module');
const originalLoad = Module._load;

if (!process.env.HF_TOKEN) {
  class OptionalProviderClient {
    constructor() {
      this.chat = {
        completions: {
          create: async function () {
            const error = new Error('Optional Hugging Face provider is not configured (HF_TOKEN missing).');
            error.code = 'OPTIONAL_PROVIDER_UNAVAILABLE';
            error.status = 503;
            throw error;
          }
        }
      };
    }
  }

  Module._load = function (request, parent, isMain) {
    if (request === 'openai') return OptionalProviderClient;
    return originalLoad.call(this, request, parent, isMain);
  };
}
