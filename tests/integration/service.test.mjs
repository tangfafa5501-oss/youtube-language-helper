import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
const code = await readFile(new URL('../../.output/chrome-mv3/background.js', import.meta.url), 'utf8');
async function harness(restrict = true, response = () => Response.json({ plan: 'test', maxCredits: 10, usedCredits: 1 })) {
  let listener, data = {}, access;
  const requests = [];
  const context = createContext({ console, URL, AbortController, AbortSignal, TextDecoder, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'own', onMessage: { addListener: fn => { listener = fn; } } },
      sidePanel: { setPanelBehavior: async () => {} },
      permissions: { contains: async () => true },
      tabs: { get: async () => ({ url: 'https://www.youtube.com/watch?v=X627czLUsGY&t=100' }) },
      storage: { local: {
        setAccessLevel: async value => { access = value.accessLevel; if (!restrict) throw Error('denied'); },
        get: async () => data, set: async value => { assert.equal(access, 'TRUSTED_CONTEXTS'); data = value; },
        remove: async () => { data = {}; },
      } },
    },
    fetch: async (url, options) => { requests.push({ url, options }); return response(url, options); },
  });
  await runInContext(code, context);
  const send = (type, payload = {}, url = 'chrome-extension://own/options.html') => new Promise(resolve => {
    listener({ channel: 'ylh-service-v1', version: 1, type, ...payload }, { id: 'own', url }, result => resolve(structuredClone(result)));
  });
  return { send, requests };
}
test('production background saves, reports presence, and deletes a key without returning it or making network calls', async () => {
  const h = await harness();
  const saved = await h.send('save', { key: 'fixture-secret', language: 'en' });
  assert.equal(saved.settings.hasKey, true); assert.equal(JSON.stringify(saved).includes('fixture-secret'), false);
  const loaded = await h.send('settings'); assert.equal(loaded.settings.hasKey, true);
  assert.equal(JSON.stringify(loaded).includes('fixture-secret'), false); assert.equal(h.requests.length, 0);
  const deleted = await h.send('delete'); assert.equal(deleted.settings.hasKey, false);
  assert.equal((await h.send('test')).ok, false); assert.equal(h.requests.length, 0);
});
test('production background transcript route uses the ported digest service, never YouTube timedtext', async () => {
  const raw = { lang: 'en', content: [{ text: '>> raw', offset: 1_200_125, duration: 375 }] };
  const h = await harness(true, () => Response.json(raw));
  await h.send('save', { key: 'fixture-secret', language: 'en' });
  const result = await h.send('transcript', { tabId: 1, videoId: 'X627czLUsGY' }, 'chrome-extension://own/sidepanel.html');
  assert.equal(result.ok, true); assert.deepEqual(result.data, raw); assert.equal(h.requests.length, 1);
  const request = h.requests[0]; const url = new URL(request.url);
  assert.equal(url.origin, 'https://api.supadata.ai'); assert.equal(url.pathname, '/v1/transcript');
  assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch?v=X627czLUsGY');
  assert.equal(url.searchParams.get('mode'), 'native'); assert.equal(url.searchParams.get('text'), 'false');
  assert.equal(request.options.method, 'GET'); assert.equal(request.options.headers['x-api-key'], 'fixture-secret');
  assert.equal(JSON.stringify(result).includes('fixture-secret'), false);
});
test('production background rejects a content-script sender and fails closed if storage cannot be protected', async () => {
  const h = await harness();
  assert.equal((await h.send('save', { key: 'fixture-secret', language: 'en' }, 'https://www.youtube.com/watch?v=X627czLUsGY')).ok, false);
  const blocked = await harness(false);
  assert.equal((await blocked.send('save', { key: 'fixture-secret', language: 'en' })).ok, false);
  assert.equal(blocked.requests.length, 0);
});

test('production background preserves an explicit regional request even when the provider normalizes its response language', async () => {
  const raw = { lang: 'en', availableLangs: ['en'], content: [{ text: 'Hello, students. Welcome!', offset: 40, duration: 5840 }] };
  const h = await harness(true, () => Response.json(raw));
  await h.send('save', { key: 'fixture-secret', language: 'en' });
  const result = await h.send('transcript', { tabId: 1, videoId: 'X627czLUsGY', language: 'en-GB' }, 'chrome-extension://own/sidepanel.html');
  assert.equal(new URL(h.requests[0].url).searchParams.get('lang'), 'en-GB');
  assert.equal(result.requestedLanguage, 'en-GB'); assert.deepEqual(result.data, raw);
  assert.equal((await h.send('settings')).settings.language, 'en');
  assert.equal(h.requests.length, 1); // No automatic fallback or second paid request.
});

test('production background rejects malformed per-request languages before issuing any request', async () => {
  const h = await harness(); await h.send('save', { key: 'fixture-secret', language: 'en' });
  const result = await h.send('transcript', { tabId: 1, videoId: 'X627czLUsGY', language: 'en&mode=generate' }, 'chrome-extension://own/sidepanel.html');
  assert.equal(result.ok, false); assert.equal(h.requests.length, 0);
});
test('production background account test goes only to Supadata after explicit action', async () => {
  const h = await harness(); await h.send('save', { key: 'fixture-secret', language: 'en' });
  assert.equal(h.requests.length, 0);
  const tested = await h.send('test'); assert.equal(tested.ok, true);
  assert.equal(h.requests[0].url, 'https://api.supadata.ai/v1/me'); assert.equal(h.requests[0].options.headers['x-api-key'], 'fixture-secret');
  assert.equal(JSON.stringify(tested).includes('fixture-secret'), false);
});
