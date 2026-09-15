/* Thinkora AI — isolated offline client
 * Safe integration helper. Does not modify the main UI by itself.
 * Requires llama.cpp server at http://127.0.0.1:8080
 */
(function (global) {
  'use strict';

  const DEFAULT_URL = 'http://127.0.0.1:8080';
  const SYSTEM_PROMPT = 'You are Thinkora AI, a helpful and concise assistant. Answer clearly and naturally. If you do not know something, say so rather than inventing facts.';

  async function isAvailable(baseUrl = DEFAULT_URL) {
    try {
      const r = await fetch(baseUrl + '/health', { method: 'GET', cache: 'no-store' });
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  async function chat(message, options = {}) {
    const baseUrl = options.baseUrl || DEFAULT_URL;
    const messages = Array.isArray(options.messages) && options.messages.length
      ? options.messages
      : [{ role: 'user', content: String(message || '') }];

    const r = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        messages: [{ role: 'system', content: options.systemPrompt || SYSTEM_PROMPT }, ...messages],
        max_tokens: Number.isFinite(options.maxTokens) ? options.maxTokens : 256,
        chat_template_kwargs: { enable_thinking: false }
      })
    });

    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error((data && data.error) || 'Offline AI request failed');

    const reply = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    if (!reply) throw new Error('Offline AI returned an empty response');
    return reply;
  }

  global.ThinkoraOffline = Object.freeze({ isAvailable, chat, DEFAULT_URL });
})(window);
