import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const code = await readFile(new URL('../../.output/chrome-mv3/content-scripts/bilibili.js', import.meta.url), 'utf8');
const mainCode = await readFile(new URL('../../.output/chrome-mv3/content-scripts/bilibili-main.js', import.meta.url), 'utf8');
const backgroundCode = await readFile(new URL('../../.output/chrome-mv3/background.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: value => { for (const fn of listeners) fn(value); } }; };

async function harness(t, { withMain = false, separateTracks = false, delayEnglish = false, metadataDelayMs = 0,
  metadataDelays = [], pageCid = '2', failPlayerCount = 0, aiOnly = false } = {}) {
  const timers = new Set(), connect = events(), document = new EventTarget();
  document.documentElement = { dataset: {} };
  const requests = [], backgroundRequests = [], pageRequests = [], headerRules = [];
  let remainingPlayerFailures = failPlayerCount;
  const video = Object.assign(new EventTarget(), { readyState: 4, duration: 300, currentTime: 0, paused: true, playbackRate: 1, seeking: false });
  video.play = async () => { video.paused = false; video.dispatchEvent(new Event('play')); video.dispatchEvent(new Event('playing')); };
  video.pause = () => { video.paused = true; video.dispatchEvent(new Event('pause')); };
  document.title = 'Synthetic Bilibili';
  document.querySelector = selector => selector === '.bpx-state-multi-active-item[data-cid]'
    ? (pageCid ? { getAttribute: name => name === 'data-cid' ? pageCid : null } : null)
    : selector === '[data-cid][aria-current="true"]' ? null
    : selector === '[data-cid]' ? { getAttribute: name => name === 'data-cid' ? 'stale-first-part' : null }
    : selector === 'h1' ? { textContent: 'Synthetic Bilibili' } : video;
  const location = { href: 'https://www.bilibili.com/video/BV1GJ411x7h7/?p=1' };
  const img = '7cd084941338484aae1ad9425b84077c', sub = '4932caff0ff746eab6f01bf08b70ac45';
  const fetch = async url => {
    const value = String(url);
    requests.push(value);
    if (value.includes('/x/web-interface/view')) {
      const delay = metadataDelays.length ? metadataDelays.shift() : metadataDelayMs;
      if (delay) await sleep(delay); return Response.json({ code: 0, data: {
      aid: 1, cid: 2, title: 'Synthetic', pages: [{ page: 1, cid: 2, part: 'Part one' }, { page: 2, cid: 3, part: 'Part two' }],
    } }); }
    if (value.includes('/x/web-interface/nav')) return Response.json({ code: 0, data: { wbi_img: { img_url: `https://i0.hdslb.com/${img}.png`, sub_url: `https://i0.hdslb.com/${sub}.png` } } });
    if (value.includes('/x/player/wbi/v2')) {
      if (remainingPlayerFailures-- > 0) return new Response('', { status: 503 });
      return Response.json({ code: 0, data: { subtitle: { subtitles: aiOnly ? [
      { id: 9, is_ai: true, lan: 'ai-zh', lan_doc: '中文 (AI)', ai_status: 1, subtitle_url: '//i0.hdslb.com/ai.json' },
    ] : separateTracks ? [
      { id: 9, is_ai: true, lan: 'ai-zh', lan_doc: '中文 (AI)', ai_status: 1, subtitle_url: '//i0.hdslb.com/ai.json' },
      { id: 1, is_ai: false, lan: 'en-US', lan_doc: 'English', subtitle_url: '//i0.hdslb.com/en.json' },
      { id: 2, is_ai: false, lan: 'zh-CN', lan_doc: '中文（中国）', subtitle_url: '//i0.hdslb.com/zh-mixed.json' },
      { id: 3, is_ai: false, lan: 'zh-Hans', lan_doc: '中文（简体）', subtitle_url: '//i0.hdslb.com/zh.json' },
    ] : [
      { id: 1, is_ai: false, lan: 'en-US', lan_doc: 'English', subtitle_url: '//i0.hdslb.com/en.json' },
      { id: 2, is_ai: false, lan: 'zh-CN', lan_doc: '中英双语', subtitle_url: '//i0.hdslb.com/bilingual.json' },
    ] } } });
    }
    if (value.includes('ai.json')) return Response.json({ body: [
      { from: 1, to: 4, content: '这是 B站 AI 保底字幕。' },
      { from: 4, to: 7, content: '没有人工轨时仍可立即读取。' },
    ] });
    if (value.includes('en.json')) { if (delayEnglish) await sleep(80); return Response.json({ body: [
      { from: 1, to: 4, content: 'Hello students.' }, { from: 4, to: 7, content: 'Second line.' },
    ] }); }
    if (value.includes('zh-mixed.json')) return Response.json({ body: [
      { from: 1, to: 7, content: '同学们好 Hello students. 第二句 Second line.' },
    ] });
    if (value.includes('zh.json')) return Response.json({ body: [
      { from: 1, to: 7, content: '同学们好。第二句。' },
    ] });
    if (value.includes('bilingual.json')) return Response.json({ body: [
      { from: 1, to: 4, content: 'Hello students.\n同学们好。' },
      { from: 4, to: 7, content: 'Second line.\n第二句。' },
    ] });
    throw new Error(`unexpected URL ${value}`);
  };
  // Execute the shipped worker in a separate world. Direct subtitle fetches in the
  // page world deliberately fail, so success proves the runtime relay was used.
  const workerListeners = new Set();
  const worker = createContext({ console, URL, AbortController, AbortSignal, DOMException, Error, TypeError, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener: fn => workerListeners.add(fn) } },
      declarativeNetRequest: { updateSessionRules: async rules => headerRules.push(structuredClone(rules)) },
      sidePanel: { setPanelBehavior: async () => {} }, permissions: { contains: async () => true, remove: async () => true },
      tabs: { get: async () => ({ url: location.href }), sendMessage: async () => {}, onRemoved: events(), onUpdated: events() },
      webRequest: { onCompleted: events() },
      storage: { local: { setAccessLevel: async () => {}, get: async () => ({}), set: async () => {}, remove: async () => {} },
        session: { get: async () => ({}), set: async () => {} } },
    }, fetch: async (url, options) => { backgroundRequests.push({ url: String(url), options }); return fetch(url); },
  });
  await runInContext(backgroundCode, worker);
  const sendMessage = message => new Promise(resolve => {
    const sender = { id: 'test-extension', frameId: 0, url: location.href, tab: { id: 1 } };
    for (const listener of workerListeners) {
      if (listener(message, sender, result => resolve(structuredClone(result))) === true) return;
    }
    resolve(undefined);
  });
  const pageFetch = async url => {
    pageRequests.push(String(url));
    if (/hdslb\.com\/.*\.json/.test(String(url))) throw new TypeError('Failed to fetch');
    return fetch(url);
  };
  const context = createContext({ console, URL, AbortController, DOMException, CustomEvent, Event, EventTarget, document, location, fetch: pageFetch, Response, TextEncoder, TextDecoder, DataView,
    crypto: { randomUUID }, performance, setTimeout, clearTimeout, queueMicrotask,
    setInterval: (...args) => { const timer = setInterval(...args); timers.add(timer); return timer; }, clearInterval,
    chrome: { runtime: { id: 'test-extension', onConnect: connect, sendMessage, getURL: path => `chrome-extension://test-extension${path}` } },
  });
  runInContext(`var window=globalThis; var windowListeners=new Map();
    window.addEventListener=(type, fn)=>{ if(!windowListeners.has(type)) windowListeners.set(type,new Set()); windowListeners.get(type).add(fn); };
    window.removeEventListener=(type, fn)=>{ windowListeners.get(type)?.delete(fn); };
    window.postMessage=data=>queueMicrotask(()=>{ for(const fn of windowListeners.get('message')??[]) fn({data,source:window,origin:location.origin}); });`, context);
  if (withMain) runInContext(mainCode, context);
  runInContext(code, context);
  const messages = [], onMessage = events(), onDisconnect = events();
  let closed = false;
  const port = { name: 'ylh-panel-v1', sender: { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' },
    onMessage, onDisconnect, postMessage: message => { if (closed) throw Error('disconnected'); messages.push(structuredClone(message)); },
    disconnect: () => { if (!closed) { closed = true; onDisconnect.emit(); } } };
  connect.emit(port);
  for (let i = 0; i < 200 && !messages.some(message => message.status === 'loaded'); i++) await sleep(10);
  t.after(() => { port.disconnect(); for (const timer of timers) clearInterval(timer); });
  const state = () => messages.filter(message => message.version === 1).at(-1);
  const send = message => onMessage.emit({ version: 1, videoId: state().video.videoId, session: state().video.session,
    trackId: state().trackId, ...message });
  const sendRaw = message => onMessage.emit(message);
  const keyEvent = (type, code, extra = {}) => {
    const event = { code, isTrusted: true, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const listener of context.windowListeners.get(type) ?? []) { listener(event); if (event.stopped) break; }
    return event;
  };
  const key = (code, extra = {}) => { const down = keyEvent('keydown', code, extra); keyEvent('keyup', code, { ...extra, repeat: false }); return down; };
  return { state, send, sendRaw, key, keyEvent, video, messages, requests, backgroundRequests, pageRequests, headerRules, location, diagnostics: document.documentElement.dataset,
    disconnect: port.disconnect };
}

test('production Bilibili bridge automatically fetches an AI track when no manual track exists', async t => {
  const h = await harness(t, { withMain: true, aiOnly: true });
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.state().source, 'bilibili');
  assert.equal(h.state().video.tracks.length, 1);
  assert.equal(h.state().video.tracks[0].kind, 'asr');
  assert.equal(h.state().video.tracks[0].name, '中文 (AI)');
  assert.equal(h.state().cues[0].text, '这是 B站 AI 保底字幕。');
  assert.match(h.state().message, /B 站字幕已就绪/);
  assert.equal(h.requests.filter(url => url.includes('ai.json')).length, 1);
  assert.equal(h.backgroundRequests.filter(request => request.url.includes('ai.json')).length, 1);
  assert.equal(h.pageRequests.some(url => url.includes('ai.json')), false);
  assert.equal(h.headerRules.length, 1);
  assert.equal(h.messages.some(message => message.source === 'bilibili-ocr' || message.ocr), false);
});

test('Bilibili page keyboard forwards A/S/D/E/F/Space with the current binding and consumes each event once', async t => {
  const h = await harness(t, { withMain: true, aiOnly: true });
  for (const [code, action] of [['KeyA', 'previous'], ['KeyS', 'replay'], ['KeyD', 'next'], ['KeyE', 'shadowing'], ['KeyF', 'practice'], ['Space', 'play']]) {
    const before = h.messages.length;
    const event = h.key(code);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
    assert.deepEqual(h.messages.slice(before), [{ type: 'bilibili-shortcut', action,
      videoId: h.state().video.videoId, session: h.state().video.session, trackId: h.state().trackId }]);
  }
  const before = h.messages.length;
  assert.equal(h.key('KeyK').defaultPrevented, false);
  assert.equal(h.key('Space', { repeat: true }).defaultPrevented, true, 'consume repeats without posting another play command');
  for (const extra of [{ isTrusted: false }, { ctrlKey: true }, { repeat: true }, { isComposing: true },
    { target: { closest: selector => selector.includes('textarea') ? {} : null } }]) {
    assert.equal(h.key('KeyE', extra).defaultPrevented, false);
  }
  assert.equal(h.messages.length, before);
  h.disconnect();
  assert.equal(h.key('KeyE').defaultPrevented, false);
});

test('Bilibili owns F down/repeat/up exactly once and releases ownership after blur', async t => {
  const h = await harness(t, { aiOnly: true });
  const count = () => h.messages.filter(m => m.type === 'bilibili-shortcut' && m.action === 'practice').length;
  assert.equal(h.keyEvent('keydown', 'KeyF').stopped, true);
  assert.equal(h.keyEvent('keydown', 'KeyF', { repeat: true }).stopped, true);
  assert.equal(h.keyEvent('keypress', 'KeyF').stopped, true);
  assert.equal(h.keyEvent('keyup', 'KeyF').stopped, true); assert.equal(count(), 1);
  assert.equal(h.keyEvent('keyup', 'KeyF').stopped, false);
  h.key('KeyF'); assert.equal(count(), 2);
  h.keyEvent('keydown', 'KeyF'); h.keyEvent('blur', '');
  assert.equal(h.keyEvent('keyup', 'KeyF').stopped, false);
  const before = count();
  for (const extra of [{ isTrusted: false }, { ctrlKey: true }, { repeat: true }, { target: { closest: () => ({}) } }])
    assert.equal(h.key('KeyF', extra).stopped, false);
  h.disconnect(); assert.equal(h.key('KeyF').stopped, false); assert.equal(count(), before);
});

test('Bilibili page keyboard ignores stale video bindings during SPA navigation', async t => {
  const h = await harness(t, { aiOnly: true });
  h.location.href = 'https://www.bilibili.com/video/BV1GJ411x7h7/?p=2';
  assert.equal(h.key('KeyD').defaultPrevented, false);
  assert.equal(h.messages.some(message => message.type === 'bilibili-shortcut'), false);
});

test('production Bilibili page bridge keeps website primary and secondary tracks independent', async t => {
  const h = await harness(t, { withMain: true, separateTracks: true });
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.state().language, 'en-US');
  assert.equal(h.state().secondaryLanguage, 'zh-Hans');
  assert.equal(h.state().cues[0].text, 'Hello students.');
  assert.equal(h.state().secondaryCues[0].text, '同学们好。第二句。');
  assert.deepEqual([h.state().cues[0].startMs, h.state().cues[0].endMs], [1000, 4000]);
  assert.equal(h.state().primaryTrackId, h.state().video.tracks.find(track => track.language === 'en-US').id);
  assert.equal(h.state().secondaryTrackId, h.state().video.tracks.find(track => track.language === 'zh-Hans').id);
  assert.equal(h.requests.filter(url => url.includes('/x/web-interface/view')).length, 0);
  assert.equal(h.requests.filter(url => url.includes('/x/player/wbi/v2')).length, 1);
  assert.equal(h.state().video.tracks.every(track => track.kind === 'manual'), true);
  assert.equal(h.state().video.tracks.some(track => /AI/i.test(track.name)), false);
  assert.equal(h.requests.some(url => url.includes('ai.json')), false);
});

test('a slow page-session bridge is acknowledged and never triggers duplicate fallback requests', async t => {
  const h = await harness(t, { withMain: true, separateTracks: true, metadataDelayMs: 700, pageCid: null });
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.requests.filter(url => url.includes('/x/web-interface/view')).length, 1);
  assert.equal(h.requests.filter(url => url.includes('/x/player/wbi/v2')).length, 1);
});

test('a failed Bilibili metadata load stays stopped until an explicit refresh', async t => {
  const h = await harness(t, { failPlayerCount: 1 });
  assert.equal(h.state().status, 'error');
  const failedRequests = h.requests.filter(url => url.includes('/x/player/wbi/v2')).length;
  await sleep(1_100);
  assert.equal(h.requests.filter(url => url.includes('/x/player/wbi/v2')).length, failedRequests);
  h.sendRaw({ version: 1, type: 'refresh' });
  for (let i = 0; i < 200 && h.state().status !== 'loaded'; i++) await sleep(10);
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.requests.filter(url => url.includes('/x/player/wbi/v2')).length, failedRequests + 1);
});

test('same-BV part navigation cannot apply the previous part bridge response', async t => {
  const h = await harness(t, { withMain: true, separateTracks: true, metadataDelayMs: 250, pageCid: null });
  h.location.href = 'https://www.bilibili.com/video/BV1GJ411x7h7/?p=2';
  for (let i = 0; i < 250 && h.state().video?.title !== 'Part two'; i++) await sleep(10);
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.state().video.title, 'Part two');
  const playerRequests = h.requests.filter(url => url.includes('/x/player/wbi/v2'));
  assert.equal(new URL(playerRequests.at(-1)).searchParams.get('cid'), '3');
});

test('same-BV part navigation rejects old playback before the polling refresh runs', async t => {
  const h = await harness(t), before = h.state(), phrase = before.phrases[0];
  h.location.href = 'https://www.bilibili.com/video/BV1GJ411x7h7/?p=2';
  h.sendRaw({ version: 1, type: 'seek', videoId: before.video.videoId, session: before.video.session,
    trackId: before.trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(50); assert.equal(h.video.currentTime, 0); assert.equal(h.video.paused, true);
});

test('overlapping explicit Bilibili refreshes keep the newest same-route request marked in flight', async t => {
  const h = await harness(t, { withMain: true, separateTracks: true, pageCid: null, metadataDelays: [0, 100, 1_000] });
  h.sendRaw({ version: 1, type: 'refresh' }); await sleep(10); h.sendRaw({ version: 1, type: 'refresh' });
  await sleep(650);
  assert.equal(h.requests.filter(url => url.includes('/x/web-interface/view')).length, 3);
  await sleep(500); assert.equal(h.state().status, 'loaded');
});

test('production Bilibili bridge loads the website bilingual track and preserves real from/to times', async t => {
  const h = await harness(t), state = h.state();
  assert.equal(state.status, 'loaded'); assert.equal(state.video.platform, 'bilibili');
  assert.equal(state.language, 'zh-CN'); assert.equal(state.cues.length, 2);
  assert.equal(state.cues[0].text, 'Hello students.\n同学们好。');
  assert.deepEqual([state.cues[0].startMs, state.cues[0].endMs], [1000, 4000]);
  assert.ok(state.phrases.length >= 1);
  assert.match(state.phrases[0].text, /^Hello students\.\n同学们好。/);
});

test('production Bilibili bridge seeks precisely and enforces manual sentence playback', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20); assert.equal(h.video.currentTime, phrase.startMs / 1000); assert.equal(h.video.paused, false);
  h.video.currentTime = phrase.endMs / 1000 - .025; await sleep(100);
  const actualMs = h.video.currentTime * 1000;
  assert.equal(h.video.paused, true);
  assert.ok(Math.abs(actualMs - phrase.endMs) <= 20, `manual brake drift ${actualMs - phrase.endMs}ms exceeds ±20ms`);
  assert.equal(h.diagnostics.ylhBrakeMode, 'manual');
  assert.equal(h.diagnostics.ylhBrakeTrigger, 'poller');
  assert.equal(Number(h.diagnostics.ylhBrakePollIntervalMs), 12);
  assert.equal(Number(h.diagnostics.ylhBrakeLeadMs), 30);
  assert.ok(Math.abs(Number(h.diagnostics.ylhBrakeDriftMs)) <= 20);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /误差 0\.0ms/);
});

test('Bilibili previous navigation enters manual and play atomically returns to auto', async t => {
  const h = await harness(t), [first, second] = h.state().phrases;
  assert.ok(first && second);
  h.send({ type: 'seek', phraseId: first.id, playMode: 'auto', intent: 'previous' });
  await sleep(20);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'manual');
  await sleep(20); h.video.currentTime = first.endMs / 1000; await sleep(100);
  assert.equal(h.video.paused, true); await sleep(150);
  assert.equal(h.video.currentTime, first.endMs / 1000);
  h.send({ type: 'playback-toggle' }); await sleep(280);
  assert.equal(h.video.currentTime, first.endMs / 1000);
  assert.equal(h.video.paused, false);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
});

for (const mode of ['manual', 'shadowing']) {
  test(`Bilibili toggle pauses ${mode} once then resumes continuous playback at the same position`, async t => {
    const h = await harness(t), phrase = h.state().phrases[0];
    h.send({ type: 'seek', phraseId: phrase.id, playMode: mode }); await sleep(20);
    h.video.currentTime = phrase.startMs / 1000 + .1;
    const position = h.video.currentTime;
    h.send({ type: 'playback-toggle' }); await sleep(20);
    assert.equal(h.video.paused, true);
    await sleep(80); assert.equal(h.video.paused, true); assert.equal(h.video.currentTime, position);
    h.send({ type: 'playback-toggle' }); await sleep(280);
    assert.equal(h.video.paused, false); assert.equal(h.video.currentTime, position);
    assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
    h.video.currentTime = phrase.endMs / 1000 + .1; await sleep(40);
    assert.equal(h.video.paused, false);
  });
}

test('Bilibili shadowing waits the sentence duration then automatically advances', async t => {
  const h = await harness(t), [first, second] = h.state().phrases;
  assert.equal(first.endMs - first.startMs, 3_000); assert.ok(second);
  h.send({ type: 'seek', phraseId: first.id, playMode: 'shadowing' });
  await sleep(20); h.video.currentTime = first.endMs / 1000 - .025;
  await sleep(40);
  const brakeActualMs = Number(h.diagnostics.ylhBrakeActualMs);
  assert.equal(h.video.paused, true);
  assert.ok(Math.abs(brakeActualMs - first.endMs) <= 20,
    `shadowing brake drift ${brakeActualMs - first.endMs}ms exceeds ±20ms`);
  assert.equal(h.diagnostics.ylhBrakeMode, 'shadowing');
  assert.equal(h.diagnostics.ylhBrakeTrigger, 'poller');
  await sleep(1_500);
  assert.equal(h.video.currentTime, first.endMs / 1000); assert.equal(h.video.paused, true);
  await sleep(1_600);
  assert.equal(h.video.currentTime, second.startMs / 1000); assert.equal(h.video.paused, false);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).shadowingStartMs, second.startMs);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'shadowing');
});

test('Bilibili playback controls reject a stale subtitle track binding', async t => {
  const h = await harness(t); h.video.playbackRate = 1; h.video.paused = true;
  h.send({ type: 'playback-rate', rate: 1.5, trackId: 'stale-track' });
  h.send({ type: 'playback-toggle', trackId: 'stale-track' });
  await sleep(30); assert.equal(h.video.playbackRate, 1); assert.equal(h.video.paused, true);
});

test('Bilibili practice replay stays bounded but ordinary play after recording is continuous', async t => {
  const h = await harness(t), first = h.state().phrases[0];
  h.send({ type: 'seek', phraseId: first.id, playMode: 'practice' }); await sleep(20);
  h.video.currentTime = first.endMs / 1000; await sleep(40);
  h.send({ type: 'practice-toggle' }); await sleep(30);
  assert.equal(h.video.currentTime, first.startMs / 1000); assert.equal(h.video.paused, false);
  h.send({ type: 'practice-pause', requestId: 'pause-recording' }); await sleep(20);
  assert.equal(h.video.paused, true);
  assert.ok(h.messages.some(message => message.type === 'practice-response' && message.requestId === 'pause-recording' && !message.error));
  h.send({ type: 'playback-toggle' }); await sleep(280);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
  h.video.currentTime = first.endMs / 1000 + .1; await sleep(40);
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, first.endMs / 1000 + .1);
});

test('Bilibili unsupported audio capture restores the player and returns a bounded error', async t => {
  const h = await harness(t), first = h.state().phrases[0];
  h.send({ type: 'seek', phraseId: first.id, playMode: 'practice' }); await sleep(20);
  h.video.currentTime = 1.5; h.video.playbackRate = 1.5; h.video.paused = true;
  h.send({ type: 'practice-capture', phraseId: first.id, requestId: 'capture-unsupported' }); await sleep(40);
  const response = h.messages.find(message => message.type === 'practice-response' && message.requestId === 'capture-unsupported');
  assert.match(response?.error, /不支持/); assert.equal(h.video.currentTime, 1.5); assert.equal(h.video.playbackRate, 1.5);
  assert.equal(h.video.paused, true);
  h.send({ type: 'practice-pause', requestId: 'stale-practice', trackId: 'old-track' }); await sleep(20);
  assert.equal(h.messages.some(message => message.requestId === 'stale-practice'), false);
});

test('Bilibili sentence-only mode neither forwards recording keys nor accepts audio capture', async t => {
  const h = await harness(t), first = h.state().phrases[0];
  h.send({ type: 'seek', phraseId: first.id, playMode: 'shadowing' }); await sleep(20);
  for (const key of ['KeyR', 'KeyH', 'KeyP', 'KeyG', 'KeyV', 'BracketLeft']) assert.equal(h.key(key).defaultPrevented, false);
  const time = h.video.currentTime;
  h.send({ type: 'practice-capture', phraseId: first.id, requestId: 'not-recording-mode' }); await sleep(20);
  assert.match(h.messages.find(message => message.requestId === 'not-recording-mode')?.error, /麦克风进入跟读模式/);
  assert.equal(h.video.currentTime, time); assert.equal(h.video.paused, false);
});

test('Bilibili does not publish invalid media clock values to the side panel', async t => {
  const h = await harness(t); await sleep(280); h.video.currentTime = Number.NaN;
  const count = h.messages.filter(message => message.type === 'playback-state').length;
  await sleep(300); assert.equal(h.messages.filter(message => message.type === 'playback-state').length, count);
});

test('Bilibili manual playback brakes only after entering the 30ms lead window', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', phraseId: phrase.id, playMode: 'manual' }); await sleep(20);
  h.video.currentTime = phrase.endMs / 1000 - .031; await sleep(40);
  assert.equal(h.video.paused, false); assert.equal(h.video.currentTime, phrase.endMs / 1000 - .031);
  h.video.currentTime = phrase.endMs / 1000 - .030; await sleep(40); assert.equal(h.video.paused, true);
  assert.ok(Math.abs(h.video.currentTime * 1000 - phrase.endMs) <= 20);
});

test('a new Bilibili track selection cancels an older in-flight subtitle load', async t => {
  const h = await harness(t, { delayEnglish: true });
  const english = h.state().video.tracks.find(track => track.language === 'en-US');
  const bilingual = h.state().video.tracks.find(track => /双语/.test(track.name));
  h.send({ type: 'bilibili-select', trackId: english.id });
  await sleep(5);
  h.send({ type: 'bilibili-select', trackId: bilingual.id });
  await sleep(120);
  assert.equal(h.state().trackId, bilingual.id);
  assert.equal(h.state().language, 'zh-CN');
  assert.match(h.state().cues[0].text, /同学们好/);
});

test('changing Bilibili subtitle track destroys the old manual boundary', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20);
  const english = h.state().video.tracks.find(track => track.language === 'en-US');
  h.send({ type: 'bilibili-select', trackId: english.id });
  await sleep(30);
  h.video.currentTime = phrase.endMs / 1000 + .05;
  await sleep(100);
  assert.equal(h.video.paused, false);
  assert.ok(h.video.currentTime > phrase.endMs / 1000);
});

test('Bilibili rejects a cue at or beyond media duration', async t => {
  const h = await harness(t), before = h.video.currentTime;
  h.video.duration = .5;
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: h.state().phrases[0].id, playMode: 'manual' });
  await sleep(20);
  assert.equal(h.video.currentTime, before);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /超出/);
});

test('Bilibili clamps a manual sentence end to media duration', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.video.duration = 2.5;
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20);
  h.video.currentTime = 2.51;
  await sleep(100);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 2.5);
});

test('a rejected Bilibili play clears the manual boundary and reports safely', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.video.play = async () => { throw new Error('synthetic autoplay rejection'); };
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /未完成/);
  h.video.paused = false; h.video.currentTime = phrase.endMs / 1000 + .05;
  await sleep(100);
  assert.ok(h.video.currentTime > phrase.endMs / 1000);
});

test('Bilibili does not post an asynchronous seek result after its requesting panel disconnects', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  let release;
  h.video.play = () => new Promise(resolve => { release = resolve; });
  const before = h.messages.filter(message => message.type === 'playback').length;
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20); h.disconnect(); release(); await sleep(20);
  assert.equal(h.messages.filter(message => message.type === 'playback').length, before);
});

test('Bilibili SPA navigation rejects controls from the previous video session', async t => {
  const h = await harness(t), before = h.state();
  const stale = { version: 1, videoId: before.video.videoId, session: before.video.session, trackId: before.trackId,
    type: 'seek', phraseId: before.phrases[0].id, playMode: 'manual' };
  h.location.href = 'https://www.bilibili.com/video/BV1Q541167Qg/?p=1';
  for (let i = 0; i < 120 && h.state().video?.videoId !== 'BV1Q541167Qg'; i++) await sleep(10);
  assert.equal(h.state().video.videoId, 'BV1Q541167Qg');
  assert.notEqual(h.state().video.session, before.video.session);
  h.video.currentTime = 12; h.sendRaw(stale); await sleep(30);
  assert.equal(h.video.currentTime, 12);
});

test('two Bilibili tabs keep playback and sessions isolated', async t => {
  const first = await harness(t), second = await harness(t);
  assert.notEqual(first.state().video.session, second.state().video.session);
  const phrase = first.state().phrases[0];
  second.video.currentTime = 9;
  first.send({ type: 'seek', trackId: first.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(30);
  assert.equal(first.video.currentTime, phrase.startMs / 1000);
  assert.equal(second.video.currentTime, 9);
});

test('Bilibili auto and manual modes enforce distinct playback boundaries', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .04; await sleep(100);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, phrase.endMs / 1000);
  await sleep(150); assert.equal(h.video.paused, true);

  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'auto' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .07; await sleep(100);
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, phrase.endMs / 1000 + .07);
});

test('Bilibili manual waiting switches to auto and resumes immediately', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'manual' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .02; await sleep(100);
  assert.equal(h.video.paused, true);
  h.send({ type: 'playback-mode', mode: 'auto' }); await sleep(20);
  assert.equal(h.video.paused, false);
});

test('rapid Bilibili previous/next seeks leave only the last manual target active', async t => {
  const h = await harness(t), [first, second] = h.state().phrases;
  h.send({ type: 'seek', phraseId: first.id, playMode: 'auto', intent: 'previous' });
  h.send({ type: 'seek', phraseId: second.id, playMode: 'auto', intent: 'next' });
  await sleep(40);
  assert.equal(h.video.currentTime, second.startMs / 1000);
  const playback = h.messages.filter(message => message.type === 'playback-state').at(-1);
  assert.equal(playback.playMode, 'manual'); assert.equal(playback.manualStartMs, second.startMs);
});
