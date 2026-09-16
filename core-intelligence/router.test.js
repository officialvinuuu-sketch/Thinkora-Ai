const assert = require('assert');
const { PROVIDERS } = require('./config');
const { normalizeRequest, chooseProvider, createResult, execute, ROUTER_VERSION } = require('./router');

const request = normalizeRequest({
  message: '  Hello Thinkora  ',
  messages: [
    { role: 'user', content: 'Previous question' },
    { role: 'assistant', content: 'Previous answer' },
    { role: 'system', content: 'must be ignored' }
  ],
  mode: 'auto',
  webSearch: true,
  fileContext: 'document text',
  fileName: 'test.txt'
});

assert.equal(request.message, 'Hello Thinkora');
assert.equal(request.messages.length, 2);
assert.equal(request.webSearch, true);
assert.equal(request.hasFile, true);
assert.equal(request.fileName, 'test.txt');
assert.equal(chooseProvider(request).id, PROVIDERS.online.id);
assert.equal(chooseProvider(normalizeRequest({ mode: 'offline', message: 'hello' })).id, PROVIDERS.offline.id);
assert.equal(chooseProvider(normalizeRequest({ mode: 'invalid', message: 'hello' })).id, PROVIDERS.online.id);

const result = createResult({
  reply: 'Hello',
  provider: PROVIDERS.online,
  model: 'gemini-3.5-flash-lite',
  sources: [],
  streamed: true,
  fallback: false
});

assert.equal(result.reply, 'Hello');
assert.equal(result.mode, 'online');
assert.equal(result.provider, PROVIDERS.online.id);
assert.equal(result.streamed, true);
assert.equal(result.fallback, false);
assert.equal(result.routerVersion, ROUTER_VERSION);

(async () => {
  const online = await execute(
    { message: 'hello', mode: 'online' },
    { [PROVIDERS.online.id]: async () => ({ reply: 'online reply', model: 'test-online' }) }
  );
  assert.equal(online.reply, 'online reply');
  assert.equal(online.provider, PROVIDERS.online.id);
  assert.equal(online.mode, 'online');

  const offline = await execute(
    { message: 'hello', mode: 'offline' },
    { [PROVIDERS.offline.id]: async () => ({ reply: 'offline reply', model: 'test-offline' }) }
  );
  assert.equal(offline.reply, 'offline reply');
  assert.equal(offline.provider, PROVIDERS.offline.id);
  assert.equal(offline.mode, 'offline');

  let missingAdapter = false;
  try { await execute({ message: 'hello', mode: 'online' }, {}); }
  catch (error) { missingAdapter = error.code === 'PROVIDER_ADAPTER_UNAVAILABLE' && error.status === 503; }
  assert.equal(missingAdapter, true);

  console.log('Universal AI Router execution tests: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
