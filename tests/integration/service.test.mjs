import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
const code = await readFile(new URL('../../.output/chrome-mv3/background.js', import.meta.url), 'utf8');
const events = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: (...args) => { for (const fn of listeners) fn(...args); } }; };
async function harness(restrict = true, response = () => Response.json({})) {
  const listeners = new Set(); let data = {}, sessionData = {}, access;
  const requests = [], removed = events(), updated = events(), completed = events(), sentToTabs = []; let permissionRemoved = 0;
  let currentTabUrl = 'https://www.youtube.com/watch?v=X627czLUsGY&t=100';
  const context = createContext({ console, URL, AbortController, AbortSignal, DOMException, TextDecoder, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'own', onMessage: { addListener: fn => listeners.add(fn) } },
      sidePanel: { setPanelBehavior: async () => {} },
      permissions: { contains: async () => true, remove: async () => { permissionRemoved++; return true; } },
      tabs: { get: async () => ({ url: currentTabUrl }),
        sendMessage: async (tabId, message) => { sentToTabs.push({ tabId, message }); }, onRemoved: removed, onUpdated: updated },
      webRequest: { onCompleted: completed },
      storage: { local: {
        setAccessLevel: async value => { access = value.accessLevel; if (!restrict) throw Error('denied'); },
        get: async () => data, set: async value => { assert.equal(access, 'TRUSTED_CONTEXTS'); data = { ...data, ...value }; },
        remove: async key => { for (const item of Array.isArray(key) ? key : [key]) delete data[item]; },
      }, session: { get: async () => sessionData, set: async value => { sessionData = value; } } },
    },
    fetch: async (url, options) => { requests.push({ url, options }); return response(url, options); },
  });
  await runInContext(code, context);
  const dispatch = (message, sender) => new Promise(resolve => {
    let settled = false;
    const done = result => { if (!settled) { settled = true; resolve(structuredClone(result)); } };
    for (const listener of listeners) {
      const handled = listener(message, sender, done);
      if (settled || handled === true) return;
    }
    done(undefined);
  });
  const send = (type, payload = {}, url = 'chrome-extension://own/options.html') => dispatch(
    { channel: 'ylh-service-v1', version: 1, type, ...payload }, { id: 'own', url });
  const sendNative = (type, payload = {}, sender = {}) => dispatch(
    { channel: 'ylh-youtube-native-v1', version: 1, type, videoId: 'X627czLUsGY', language: 'en', kind: 'manual', ...payload },
    { id: 'own', frameId: 0, url: 'https://www.youtube.com/watch?v=X627czLUsGY', tab: { id: 1 }, ...sender });
  const sendNativeLatest = () => dispatch(
    { channel: 'ylh-youtube-native-v1', version: 1, type: 'latest', videoId: 'X627czLUsGY' },
    { id: 'own', frameId: 0, url: 'https://www.youtube.com/watch?v=X627czLUsGY', tab: { id: 1 } });
  return { send, sendNative, sendNativeLatest, requests, removed, updated, completed, sentToTabs, setStored: value => { data = value; },
    setCurrentTabUrl: value => { currentTabUrl = value; },
    localStored: () => structuredClone(data),
    sessionStored: () => structuredClone(sessionData), get permissionRemoved() { return permissionRemoved; } };
}
test('production background persists only local display and language preferences without a network request', async () => {
  const h = await harness();
  assert.deepEqual((await h.send('settings')).settings,
    { language: 'en', theme: 'system', displayMode: 'phrases' });
  const changed = await h.send('save-preferences', { theme: 'dark', displayMode: 'phrases', language: ' en-GB ' },
    'chrome-extension://own/sidepanel.html');
  assert.deepEqual(changed.settings, { language: 'en-GB', theme: 'dark', displayMode: 'phrases' });
  assert.deepEqual((await h.send('settings')).settings, changed.settings);
  assert.equal(h.requests.length, 0);
});

test('legacy Supadata storage is sanitized, removed and never copied into current settings', async () => {
  const h = await harness();
  h.setStored({ 'supadata-v1': { key: 'fixture-secret', language: 'en-GB', theme: 'dark', displayMode: 'raw' } });
  const loaded = await h.send('settings');
  assert.deepEqual(loaded.settings, { language: 'en-GB', theme: 'dark', displayMode: 'phrases' });
  assert.equal(h.localStored()['settings-v2'].displayMode, 'phrases');
  assert.equal(JSON.stringify(h.localStored()).includes('fixture-secret'), false);
  assert.equal('supadata-v1' in h.localStored(), false);
  assert.equal(h.permissionRemoved, 1);
  assert.equal(h.requests.length, 0);
});

test('removed Supadata operations fail closed and cannot issue a paid request', async () => {
  const h = await harness();
  for (const type of ['save', 'delete', 'test', 'transcript']) {
    const result = await h.send(type, { key: 'fixture-secret', tabId: 1, videoId: 'X627czLUsGY' },
      'chrome-extension://own/sidepanel.html');
    assert.equal(result.ok, false);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(JSON.stringify(h.localStored()).includes('fixture-secret'), false);
});

test('production settings reject malformed values, untrusted senders and unavailable protected storage', async () => {
  const h = await harness();
  assert.equal((await h.send('save-preferences', { theme: 'dark', displayMode: 'raw', language: 'en&x=1' })).ok, false);
  assert.equal((await h.send('save-preferences', { theme: 'dark', displayMode: 'raw', language: 'en' })).ok, false);
  assert.equal((await h.send('save-preferences', { theme: 'dark', displayMode: 'raw', language: 'en' },
    'https://www.youtube.com/watch?v=X627czLUsGY')).ok, false);
  const blocked = await harness(false);
  assert.equal((await blocked.send('settings')).ok, false);
  assert.equal(h.requests.length, 0); assert.equal(blocked.requests.length, 0);
});

test('production background captures YouTube completed timedtext once and serves raw JSON3 from session cache', async () => {
  const body = JSON.stringify({ events: [{ tStartMs: 40, dDurationMs: 960, segs: [{ utf8: 'Native line.' }] }] });
  const h = await harness(true, url => String(url).includes('/api/timedtext') ? new Response(body) : Response.json({}));
  const requestCompletedAt = Date.now() - 5;
  h.completed.emit({ tabId: 1, statusCode: 200, timeStamp: requestCompletedAt,
    url: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en&pot=session-proof&potc=3&fmt=json3' });
  for (let attempt = 0; attempt < 20 && !h.sessionStored()['youtube-native-cache-v1']; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const cached = await h.sendNative('cache');
  assert.equal(cached.ok, true); assert.equal(cached.entry.body, body);
  assert.equal(cached.entry.format, 'youtube-timedtext-json3');
  assert.equal(cached.entry.requestCompletedAt, requestCompletedAt);
  const latest = await h.sendNativeLatest();
  assert.equal(latest.ok, true); assert.equal(latest.entry.body, body);
  assert.equal(JSON.stringify(cached).includes('session-proof'), false);
  assert.equal(JSON.stringify(h.sessionStored()).includes('session-proof'), false);
  assert.equal(h.sentToTabs.length, 1);
});

test('native selected-track fetch reuses in-memory YouTube auth without exposing it to the content script', async () => {
  const body = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Selected.' }] }] });
  const h = await harness(true, url => String(url).includes('/api/timedtext') ? new Response(body) : Response.json({}));
  h.completed.emit({ tabId: 1, statusCode: 200,
    url: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en&pot=private-proof&potc=4&fmt=json3' });
  await new Promise(resolve => setImmediate(resolve));
  const result = await h.sendNative('fetch', { baseUrl: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en&sig=track',
    client: { c: 'WEB', cver: '2.2026', evil: 'ignored' } });
  assert.equal(result.ok, true); assert.equal(result.entry.body, body);
  assert.equal(JSON.stringify(result).includes('private-proof'), false);
  const selected = h.requests.map(request => new URL(request.url)).find(url => url.searchParams.get('sig') === 'track');
  assert.equal(selected.searchParams.get('pot'), 'private-proof'); assert.equal(selected.searchParams.get('c'), 'WEB');
  assert.equal(selected.searchParams.has('evil'), false);
});

test('native background route rejects an unbound page before any selected-track request', async () => {
  const h = await harness(); const before = h.requests.length;
  h.setCurrentTabUrl('https://www.youtube.com/watch?v=abcdefghijk');
  const result = await h.sendNative('fetch', { baseUrl: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en' });
  assert.equal(result.ok, false); assert.equal(h.requests.length, before);
});

test('native background trusts the live bound tab when optional sender URL or frame metadata is absent or stale', async () => {
  const body = JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'Bound.' }] }] });
  const h = await harness(true, url => String(url).includes('/api/timedtext') ? new Response(body) : Response.json({}));
  const withoutOptionalMetadata = await h.sendNative('fetch',
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en' }, { frameId: undefined, url: undefined });
  assert.equal(withoutOptionalMetadata.ok, true);
  const staleDocumentUrl = await h.sendNative('fetch',
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en' },
    { url: 'https://www.youtube.com/', frameId: 0 });
  assert.equal(staleDocumentUrl.ok, true);
  const childFrame = await h.sendNative('fetch',
    { baseUrl: 'https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en' }, { frameId: 2 });
  assert.equal(childFrame.ok, false);
});
