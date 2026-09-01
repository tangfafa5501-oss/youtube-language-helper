import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const code = await readFile(new URL('../../.output/chrome-mv3/content-scripts/bilibili.js', import.meta.url), 'utf8');
const mainCode = await readFile(new URL('../../.output/chrome-mv3/content-scripts/bilibili-main.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const events = () => { const listeners = new Set(); return { addListener: fn => listeners.add(fn), emit: value => { for (const fn of listeners) fn(value); } }; };

async function harness(t, { withMain = false, separateTracks = false, delayEnglish = false, metadataDelayMs = 0,
  metadataDelays = [], pageCid = '2', failPlayerCount = 0 } = {}) {
  const timers = new Set(), connect = events(), document = new EventTarget();
  const requests = [];
  let remainingPlayerFailures = failPlayerCount;
  const video = { readyState: 4, duration: 300, currentTime: 0, paused: true, playbackRate: 1,
    play: async () => { video.paused = false; }, pause: () => { video.paused = true; } };
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
      return Response.json({ code: 0, data: { subtitle: { subtitles: separateTracks ? [
      { id: 1, lan: 'en-US', lan_doc: 'English', subtitle_url: '//i0.hdslb.com/en.json' },
      { id: 2, lan: 'zh-CN', lan_doc: '中文（中国）', subtitle_url: '//i0.hdslb.com/zh-mixed.json' },
      { id: 3, lan: 'zh-Hans', lan_doc: '中文（简体）', subtitle_url: '//i0.hdslb.com/zh.json' },
    ] : [
      { id: 1, lan: 'en-US', lan_doc: 'English', subtitle_url: '//i0.hdslb.com/en.json' },
      { id: 2, lan: 'zh-CN', lan_doc: '中英双语', subtitle_url: '//i0.hdslb.com/bilingual.json' },
    ] } } });
    }
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
  const context = createContext({ console, URL, AbortController, CustomEvent, Event, EventTarget, document, location, fetch, Response, TextEncoder, TextDecoder, DataView,
    crypto: { randomUUID }, setTimeout, clearTimeout, queueMicrotask,
    setInterval: (...args) => { const timer = setInterval(...args); timers.add(timer); return timer; }, clearInterval,
    chrome: { runtime: { id: 'test-extension', onConnect: connect, getURL: path => `chrome-extension://test-extension${path}` } },
  });
  runInContext(`var window=globalThis; var messageListeners=new Set();
    window.addEventListener=(type, fn)=>{ if(type==='message') messageListeners.add(fn); };
    window.removeEventListener=(type, fn)=>{ if(type==='message') messageListeners.delete(fn); };
    window.postMessage=data=>queueMicrotask(()=>{ for(const fn of messageListeners) fn({data,source:window,origin:location.origin}); });`, context);
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
  return { state, send, sendRaw, video, messages, requests, location, disconnect: port.disconnect };
}

test('production Bilibili page bridge reuses the website session and combines its existing primary/secondary tracks', async t => {
  const h = await harness(t, { withMain: true, separateTracks: true });
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.state().language, 'en-US+zh-Hans');
  assert.equal(h.state().cues[0].text, 'Hello students. Second line.\n同学们好。第二句。');
  assert.deepEqual([h.state().cues[0].startMs, h.state().cues[0].endMs], [1000, 7000]);
  assert.equal(h.requests.filter(url => url.includes('/x/web-interface/view')).length, 0);
  assert.equal(h.requests.filter(url => url.includes('/x/player/wbi/v2')).length, 1);
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
    trackId: before.trackId, phraseId: phrase.id, playMode: 'single' });
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

test('production Bilibili bridge seeks and enforces single segment playback', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'single' });
  await sleep(20); assert.equal(h.video.currentTime, phrase.startMs / 1000); assert.equal(h.video.paused, false);
  h.video.currentTime = phrase.endMs / 1000 + .03; await sleep(100);
  assert.equal(h.video.paused, true); assert.equal(h.video.currentTime, phrase.startMs / 1000);
});

test('Bilibili playback controls reject a stale subtitle track binding', async t => {
  const h = await harness(t); h.video.playbackRate = 1; h.video.paused = true;
  h.send({ type: 'playback-rate', rate: 1.5, trackId: 'stale-track' });
  h.send({ type: 'playback-toggle', trackId: 'stale-track' });
  await sleep(30); assert.equal(h.video.playbackRate, 1); assert.equal(h.video.paused, true);
});

test('Bilibili does not publish invalid media clock values to the side panel', async t => {
  const h = await harness(t); await sleep(280); h.video.currentTime = Number.NaN;
  const count = h.messages.filter(message => message.type === 'playback-state').length;
  await sleep(300); assert.equal(h.messages.filter(message => message.type === 'playback-state').length, count);
});

test('Bilibili single playback does not stop twenty milliseconds before the real cue end', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', phraseId: phrase.id, playMode: 'single' }); await sleep(20);
  h.video.currentTime = phrase.endMs / 1000 - .01; await sleep(100);
  assert.equal(h.video.paused, false); assert.equal(h.video.currentTime, phrase.endMs / 1000 - .01);
  h.video.currentTime = phrase.endMs / 1000; await sleep(100); assert.equal(h.video.paused, true);
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

test('changing Bilibili subtitle track cancels the old loop boundary', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'loop' });
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
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: h.state().phrases[0].id, playMode: 'single' });
  await sleep(20);
  assert.equal(h.video.currentTime, before);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /超出/);
});

test('Bilibili clamps a segment end to media duration before enforcing single playback', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.video.duration = 2.5;
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'single' });
  await sleep(20);
  h.video.currentTime = 2.51;
  await sleep(100);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, phrase.startMs / 1000);
});

test('a rejected Bilibili play clears the loop boundary and reports safely', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.video.play = async () => { throw new Error('synthetic autoplay rejection'); };
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'loop' });
  await sleep(20);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /拦截/);
  h.video.paused = false; h.video.currentTime = phrase.endMs / 1000 + .05;
  await sleep(100);
  assert.ok(h.video.currentTime > phrase.endMs / 1000);
});

test('Bilibili does not post an asynchronous seek result after its requesting panel disconnects', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  let release;
  h.video.play = () => new Promise(resolve => { release = resolve; });
  const before = h.messages.filter(message => message.type === 'playback').length;
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'single' });
  await sleep(20); h.disconnect(); release(); await sleep(20);
  assert.equal(h.messages.filter(message => message.type === 'playback').length, before);
});

test('Bilibili SPA navigation rejects controls from the previous video session', async t => {
  const h = await harness(t), before = h.state();
  const stale = { version: 1, videoId: before.video.videoId, session: before.video.session, trackId: before.trackId,
    type: 'seek', phraseId: before.phrases[0].id, playMode: 'single' };
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
  first.send({ type: 'seek', trackId: first.state().trackId, phraseId: phrase.id, playMode: 'single' });
  await sleep(30);
  assert.equal(first.video.currentTime, phrase.startMs / 1000);
  assert.equal(second.video.currentTime, 9);
});

test('Bilibili loop and continuous modes enforce their own playback boundaries', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'loop' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .04; await sleep(100);
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, phrase.startMs / 1000);
  await sleep(520); assert.equal(h.video.paused, false);

  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'all' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .07; await sleep(100);
  assert.equal(h.video.paused, false);
  assert.equal(h.video.currentTime, phrase.endMs / 1000 + .07);
});

test('Bilibili loop pause switches to continuous mode without waiting for the old timer', async t => {
  const h = await harness(t), phrase = h.state().phrases[0];
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'loop' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .02; await sleep(100);
  assert.equal(h.video.paused, true);
  h.send({ type: 'playback-mode', mode: 'all' }); await sleep(20);
  assert.equal(h.video.paused, false);
});

test('a rejected Bilibili loop resume stops cleanly', async t => {
  const h = await harness(t), phrase = h.state().phrases[0]; let calls = 0;
  h.video.play = async () => { calls++; if (calls > 1) throw new Error('synthetic loop resume rejection'); h.video.paused = false; };
  h.send({ type: 'seek', trackId: h.state().trackId, phraseId: phrase.id, playMode: 'loop' });
  await sleep(20); h.video.currentTime = phrase.endMs / 1000 + .02; await sleep(650);
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /已停止循环/);
});
