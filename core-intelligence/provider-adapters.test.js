const assert = require('assert');
const { PROVIDERS } = require('./config');
const { createOnlineAdapter, createOnlineStreamAdapter, createOfflineAdapter } = require('./provider-adapters');

(async () => {
  const online = createOnlineAdapter({
    execute: async (request, provider) => ({ reply: request.message, model: provider.id })
  });
  const onlineResult = await online({ message: 'hello' }, PROVIDERS.online);
  assert.equal(onlineResult.reply, 'hello');
  assert.equal(onlineResult.provider.id, PROVIDERS.online.id);

  const streamed = createOnlineStreamAdapter({
    stream: async (request, provider) => ({ reply: request.message, model: provider.id })
  });
  const streamResult = await streamed({ message: 'stream' }, PROVIDERS.online);
  assert.equal(streamResult.reply, 'stream');
  assert.equal(streamResult.streamed, true);

  const offline = createOfflineAdapter({
    execute: async () => ({ reply: 'offline ok', model: 'local-qwen' })
  });
  const offlineResult = await offline({ message: 'hello' }, PROVIDERS.offline);
  assert.equal(offlineResult.reply, 'offline ok');
  assert.equal(offlineResult.provider.id, PROVIDERS.offline.id);

  console.log('Provider adapter contract tests: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
