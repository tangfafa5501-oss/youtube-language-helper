import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
const code = await readFile(new URL('../../.output/chrome-mv3/background.js', import.meta.url), 'utf8');
const events = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } }; };
async function harness(restrict = true, response = () => Response.json({ plan: 'test', maxCredits: 10, usedCredits: 1 })) {
  let listener, data = {}, access;
  const requests = [], removed = events(), updated = events(); let permissionRemoved = 0;
  const context = createContext({ console, URL, AbortController, AbortSignal, DOMException, TextDecoder, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'own', onMessage: { addListener: fn => { listener = fn; } } },
      sidePanel: { setPanelBehavior: async () => {} },
      permissions: { contains: async () => true, remove: async () => { permissionRemoved++; return true; } },
      tabs: { get: async () => ({ url: 'https://www.youtube.com/watch?v=X627czLUsGY&t=100' }), onRemoved: removed, onUpdated: updated },
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
  return { send, requests, removed, updated, setStored: value => { data = value; }, get permissionRemoved() { return permissionRemoved; } };
}
test('production background saves, reports presence, and deletes a key without returning it or making network calls', async () => {
  const h = await harness();
  assert.deepEqual((await h.send('settings')).settings,
    { hasKey: false, language: 'en', theme: 'system', displayMode: 'phrases' });
  const saved = await h.send('save', { key: 'fixture-secret', language: 'en' });
  assert.equal(saved.settings.hasKey, true); assert.equal(JSON.stringify(saved).includes('fixture-secret'), false);
  const loaded = await h.send('settings'); assert.equal(loaded.settings.hasKey, true);
  assert.equal(JSON.stringify(loaded).includes('fixture-secret'), false); assert.equal(h.requests.length, 0);
  const deleted = await h.send('delete'); assert.equal(deleted.settings.hasKey, false);
  assert.equal(h.permissionRemoved, 1);
  assert.equal((await h.send('test')).ok, false); assert.equal(h.requests.length, 0);
});

test('side-panel appearance preferences persist without exposing or deleting the saved API key', async () => {
  const h = await harness();
  await h.send('save', { key: 'fixture-secret', language: 'en' });
  const changed = await h.send('save-preferences', { theme: 'dark', displayMode: 'raw' }, 'chrome-extension://own/sidepanel.html');
  assert.deepEqual(changed.settings, { hasKey: true, language: 'en', theme: 'dark', displayMode: 'raw' });
  assert.equal(JSON.stringify(changed).includes('fixture-secret'), false);
  const loaded = await h.send('settings', {}, 'chrome-extension://own/sidepanel.html');
  assert.deepEqual(loaded.settings, changed.settings);
  assert.equal(h.requests.length, 0);
});

test('saving trims the language and aborts work that still uses the previous settings', async () => {
  const h = await harness(true, (_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  await h.send('save', { key: 'fixture-secret', language: ' en-GB ' });
  assert.equal((await h.send('settings')).settings.language, 'en-GB');
  const pending = h.send('transcript', { tabId: 1, videoId: 'X627czLUsGY' }, 'chrome-extension://own/sidepanel.html');
  await new Promise(resolve => setImmediate(resolve));
  const saved = await h.send('save', { key: 'replacement-secret', language: 'en' });
  assert.equal(saved.ok, true);
  assert.equal((await pending).ok, false);
});

test('closing or navigating the bound tab aborts its local Supadata polling', async () => {
  for (const action of ['removed', 'updated']) {
    let aborted = false;
    const h = await harness(true, (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); }, { once: true });
    }));
    await h.send('save', { key: 'fixture-secret', language: 'en' });
    const pending = h.send('transcript', { tabId: 1, videoId: 'X627czLUsGY' }, 'chrome-extension://own/sidepanel.html');
    await new Promise(resolve => setImmediate(resolve));
    if (action === 'removed') h.removed.emit(1);
    else h.updated.emit(1, { url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    assert.equal((await pending).ok, false);
    assert.equal(aborted, true);
  }
});

test('non-positive tab ids are rejected before any paid transcript request', async () => {
  const h = await harness(); await h.send('save', { key: 'fixture-secret', language: 'en' });
  const result = await h.send('transcript', { tabId: 0, videoId: 'X627czLUsGY' }, 'chrome-extension://own/sidepanel.html');
  assert.equal(result.ok, false); assert.equal(h.requests.length, 0);
});

test('corrupt stored keys and oversized replacement keys fail closed without a network request', async () => {
  const h = await harness();
  h.setStored({ 'supadata-v1': { key: 'bad key with spaces', language: 'en' } });
  assert.equal((await h.send('settings')).settings.hasKey, false);
  assert.equal((await h.send('test')).ok, false);
  assert.equal((await h.send('save', { key: 'x'.repeat(513), language: 'en' })).ok, false);
  assert.equal(h.requests.length, 0);
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
