import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

// Synthetic page + extension-port harness. Runs the production bundles without
// launching a browser or contacting YouTube; not a substitute for live acceptance.
const mainCode = await readFile(new URL('../../.output/chrome-mv3/content-scripts/youtube-main.js', import.meta.url), 'utf8');
const contentCode = await readFile(new URL('../../.output/chrome-mv3/content-scripts/youtube.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const events = () => {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), emit: value => { for (const fn of listeners) fn(value); } };
};
async function harness(t) {
  const timers = new Set();
  const connect = events();
  const doc = new EventTarget();
  let videoId = 'abcdefghijk';
  let tracksReady = true;
  let responseBody = JSON.stringify({ events: [
    { tStartMs: 1500, dDurationMs: 600, segs: [{ utf8: 'synthetic duplicate' }] },
    { tStartMs: 1500, dDurationMs: 600, segs: [{ utf8: 'synthetic duplicate' }] },
    { tStartMs: 1_300_000, dDurationMs: 400, segs: [{ utf8: 'synthetic late cue' }] },
  ] });
  let wordBody = JSON.stringify({ events: [
    { tStartMs: 1_000, dDurationMs: 2_000, segs: [{ utf8: 'Hola', tOffsetMs: 0 }, { utf8: ' mundo', tOffsetMs: 1_000 }] },
  ] });
  let pauseResponse = false; let releaseResponse;
  let plays = 0; let fetched; let adShowing = false;
  const video = { readyState: 4, duration: 1600, currentTime: 0, paused: true, playbackRate: 1,
    play: async () => { plays++; video.paused = false; }, pause: () => { video.paused = true; } };
  const player = { getPlayerResponse: () => ({ videoDetails: { videoId, title: 'Synthetic fixture' }, playabilityStatus: { status: 'OK' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracksReady ? [
      { baseUrl: `/api/timedtext?v=${videoId}&lang=en`, vssId: '.en', languageCode: 'en', name: { simpleText: 'English' } },
      { baseUrl: `/api/timedtext?v=${videoId}&lang=en&kind=asr`, vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English auto' } },
    ] : [] } } }) };
  doc.title = 'Synthetic fixture'; doc.getElementById = () => player;
  doc.querySelector = selector => selector.includes('ad-showing') ? (adShowing ? player : null) : video;
  const location = { href: `https://www.youtube.com/watch?v=${videoId}`, origin: 'https://www.youtube.com' };
  const context = createContext({ console, URL, AbortController, CustomEvent, Event, EventTarget, document: doc, location,
    TextDecoder, crypto: { randomUUID }, setTimeout, clearTimeout,
    setInterval: (...args) => { const id = setInterval(...args); timers.add(id); return id; }, clearInterval,
    chrome: { runtime: { id: 'test-extension', onConnect: connect, getURL: path => `chrome-extension://test-extension${path}` } },
    fetch: async url => {
      fetched = url;
      if (String(url).includes('/youtubei/v1/player')) return Response.json({
        videoDetails: { videoId }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [
          { baseUrl: `/api/timedtext?v=${videoId}&lang=en&kind=asr&word=1`, languageCode: 'en', kind: 'asr' },
          { baseUrl: `/api/timedtext?v=${videoId}&lang=es&kind=asr&word=1`, languageCode: 'es', kind: 'asr' },
        ] } },
      });
      if (String(url).includes('word=1')) return new Response(wordBody);
      const body = responseBody;
      if (pauseResponse) await new Promise(resolve => { releaseResponse = resolve; });
      return new Response(body);
    },
  });
  runInContext(`var window = globalThis; var bus = new EventTarget();
    window.ytcfg = { get: key => key === 'VISITOR_DATA' ? 'synthetic-visitor-data-at-least-twenty-characters' : undefined };
    window.addEventListener = bus.addEventListener.bind(bus);
    window.removeEventListener = bus.removeEventListener.bind(bus);
    var heldInfo = []; var holdInfo = false;
    window.postMessage = data => {
      if (holdInfo && data.direction === 'response' && 'video' in data) { heldInfo.push(data); return; }
      Promise.resolve().then(() => {
      const event = new Event('message'); Object.assign(event, { data, source: window, origin: location.origin }); bus.dispatchEvent(event);
    }); };`, context);
  await runInContext(mainCode, context);
  await runInContext(contentCode, context);
  const panels = [];
  const addPanel = () => {
    const messages = []; const onMessage = events(); const onDisconnect = events();
    let closed = false;
    const port = { name: 'ylh-panel-v1', sender: { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' },
      onMessage, onDisconnect, postMessage: m => { if (closed) throw Error('disconnected'); messages.push(structuredClone(m)); },
      disconnect: () => { closed = true; onDisconnect.emit(); } };
    connect.emit(port);
    const panel = { messages, onMessage, disconnect: port.disconnect };
    panels.push(panel); return panel;
  };
  const { messages, onMessage, disconnect } = addPanel(); await tick();
  t.after(() => { for (const panel of panels) panel.disconnect(); for (const timer of timers) clearInterval(timer); });
  const state = () => messages.filter(m => m.version === 1).at(-1);
  const load = () => onMessage.emit({ version: 1, type: 'load', trackId: state().trackId, session: state().video.session });
  const seek = (cue, playMode = 'single') => onMessage.emit({ version: 1, type: 'seek', videoId: state().video.videoId,
    session: state().video.session, trackId: state().trackId, cueId: cue.cueId, playMode });
  return { state, load, seek, video, messages, addPanel, disconnect, get plays() { return plays; }, get fetched() { return fetched; },
    setAd: value => { adShowing = value; },
    holdInfo: () => { context.holdInfo = true; },
    releaseInfo: () => { runInContext('holdInfo = false; for (const response of heldInfo.splice(0)) window.postMessage(response);', context); },
    heldInfoCount: () => runInContext('heldInfo.length', context),
    send: m => onMessage.emit({ trackId: state().trackId, ...m }),
    updateTracks: async ready => { tracksReady = ready; doc.dispatchEvent(new Event('yt-navigate-finish')); await tick(); },
    setBody: body => { responseBody = body; }, setWordBody: body => { wordBody = body; }, pause: () => { pauseResponse = true; },
    release: () => { releaseResponse?.(); },
    select: trackId => onMessage.emit({ version: 1, type: 'select', trackId, session: state().video.session }),
    navigate: async id => {
      doc.dispatchEvent(new Event('yt-navigate-start')); videoId = id; location.href = `https://www.youtube.com/watch?v=${id}`;
      doc.dispatchEvent(new Event('yt-navigate-finish')); await tick();
    },
  };
}

test('production bridges preserve raw entries and seek a late cue on the bound video', async t => {
  const h = await harness(t);
  assert.equal(h.state().video.platform, 'youtube');
  assert.equal(h.state().video.tracks.length, 2);
  h.load(); await tick();
  assert.equal(h.state().status, 'loaded'); assert.equal(h.state().cues.length, 3);
  assert.equal(new URL(h.fetched).searchParams.get('fmt'), 'json3');
  h.seek(h.state().cues[2]); await tick();
  assert.equal(h.video.currentTime, 1300); assert.equal(h.plays, 1);
  h.select(h.state().video.tracks[1].id); await tick();
  assert.equal(h.state().cues.length, 0); assert.equal(h.state().status, 'ready');
});
test('playback state follows the bound player and controls update the real video element', async t => {
  const h = await harness(t);
  h.video.currentTime = 12.24;
  h.send({ version: 1, type: 'playback-rate', rate: .9, videoId: h.state().video.videoId, session: h.state().video.session });
  h.send({ version: 1, type: 'playback-toggle', videoId: h.state().video.videoId, session: h.state().video.session });
  await new Promise(resolve => setTimeout(resolve, 300));
  const playback = h.messages.filter(message => message.type === 'playback-state').at(-1);
  assert.deepEqual(playback, { type: 'playback-state', videoId: h.state().video.videoId, session: h.state().video.session,
    trackId: h.state().trackId, currentTimeMs: 12240, playing: true, rate: .9 });
});

test('YouTube playback controls reject a stale subtitle track binding', async t => {
  const h = await harness(t); h.video.playbackRate = 1; h.video.paused = true;
  h.send({ version: 1, type: 'playback-rate', rate: 1.5, trackId: 'stale-track',
    videoId: h.state().video.videoId, session: h.state().video.session });
  h.send({ version: 1, type: 'playback-toggle', trackId: 'stale-track',
    videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); assert.equal(h.video.playbackRate, 1); assert.equal(h.video.paused, true);
});

test('YouTube does not publish invalid media clock values to the side panel', async t => {
  const h = await harness(t); await new Promise(resolve => setTimeout(resolve, 280));
  h.video.currentTime = Number.NaN;
  const count = h.messages.filter(message => message.type === 'playback-state').length;
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(h.messages.filter(message => message.type === 'playback-state').length, count);
});

test('word timing follows the actual Supadata response language rather than the requested fallback label', async t => {
  const h = await harness(t);
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'actual-language' };
  h.send({ ...binding, type: 'supadata-begin' });
  h.send({ ...binding, type: 'supadata-finish', requestedLanguage: 'en', data: {
    lang: 'es', content: [{ offset: 1_000, duration: 2_000, text: 'Hola mundo.' }],
  } });
  h.send({ ...binding, type: 'timing-load', language: 'en' });
  for (let i = 0; i < 50 && h.state().phrases?.[0]?.timing !== 'youtube-word'; i++) await tick();
  assert.equal(new URL(h.fetched).searchParams.get('lang'), 'es');
  assert.equal(h.state().phrases[0].text, 'Hola mundo.');
  assert.equal(h.state().phrases[0].startMs, 1_000);
});
test('production timing keeps the period boundary, folds sub-2s forward, and caps rows at six seconds', async t => {
  const h = await harness(t);
  const first = 'Hello, lovely students, and welcome to your pronunciation training session.';
  const second = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  const text = `${first} ${second}`, words = text.match(/[A-Za-z]+|100/g);
  const firstWords = first.match(/[A-Za-z]+/g).length;
  const offsets = words.map((_, index) => index < firstWords ? index * 350
    : firstWords * 350 + (index - firstWords) * 450);
  h.setWordBody(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: offsets.at(-1) + 450,
    segs: words.map((word, index) => ({ utf8: `${index ? ' ' : ''}${word}`, tOffsetMs: offsets[index] })) }] }));
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'sbd-two-five' };
  h.send({ ...binding, type: 'supadata-begin' });
  h.send({ ...binding, type: 'supadata-finish', requestedLanguage: 'en', data: { lang: 'en', content: [
    { offset: 0, duration: 5_000, text: `${first} Today, I am` },
    { offset: 5_000, duration: offsets.at(-1) + 450 - 5_000, text: second.replace(/^Today, I am\s*/, '') },
  ] } });
  h.send({ ...binding, type: 'timing-load', language: 'en' });
  for (let i = 0; i < 50 && /正在尝试/.test(h.state().timingMessage ?? ''); i++) await tick();
  assert.equal(h.state().phrases[0].text, first);
  assert.equal(h.state().phrases[1].text.startsWith('Today, I am'), true);
  assert.ok(h.state().phrases.every(phrase => phrase.endMs - phrase.startMs >= 2_000
    && phrase.endMs - phrase.startMs <= 6_000));
  assert.equal(h.state().phrases.map(phrase => phrase.text).join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
});
test('failed YouTube word alignment still publishes hard 2-6 second SBD phrases from Supadata timing', async t => {
  const h = await harness(t);
  const first = 'Hello, lovely students, and welcome to your pronunciation training session.';
  const second = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  h.setWordBody(JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2_000, segs: [
    { utf8: 'completely', tOffsetMs: 0 }, { utf8: ' unrelated', tOffsetMs: 1_000 },
  ] }] }));
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'estimated-two-five' };
  h.send({ ...binding, type: 'supadata-begin' });
  h.send({ ...binding, type: 'supadata-finish', requestedLanguage: 'en', data: { lang: 'en', content: [
    { offset: 0, duration: 5_000, text: `${first} Today, I am` },
    { offset: 5_000, duration: 6_600, text: second.replace(/^Today, I am\s*/, '') },
  ] } });
  h.send({ ...binding, type: 'timing-load', language: 'en' });
  for (let i = 0; i < 50 && /正在尝试/.test(h.state().timingMessage ?? ''); i++) await tick();
  assert.equal(h.state().phrases[0].text, first);
  assert.equal(h.state().phrases[1].text, 'Today, I am very excited to help you pronounce 100 everyday words');
  assert.equal(h.state().phrases[2].text, 'in my Modern Received Pronunciation accent.');
  assert.ok(h.state().phrases[1].endMs - h.state().phrases[1].startMs > 5_000);
  assert.ok(h.state().phrases.every(phrase => phrase.timing === 'youtube-estimated'));
  assert.ok(h.state().phrases.every(phrase => {
    const duration = phrase.endMs - phrase.startMs;
    return duration >= 2_000 && duration <= 6_000;
  }));
  assert.doesNotMatch(h.state().timingMessage, /词级时间读取失败|保留原字幕/);
  assert.match(h.state().timingMessage, /词级时间不可用.*估算/);
  assert.equal(h.state().phrases.map(phrase => phrase.text).join(' ').replace(/\s/g, ''), `${first} ${second}`.replace(/\s/g, ''));
  const target = h.state().phrases[1];
  h.send({ version: 1, type: 'seek', phraseId: target.id, playMode: 'single',
    videoId: h.state().video.videoId, session: h.state().video.session });
  await tick();
  assert.equal(h.video.currentTime, target.startMs / 1_000);
  assert.equal(h.plays, 1);
});
test('single, loop, and all playback modes enforce Enjoy-compatible segment boundaries', async t => {
  const h = await harness(t); providerCues(h, [1_000, 2_000, 3_000]);
  const [single, loop, all] = h.state().cues;

  h.seek(single, 'single'); await tick();
  h.video.currentTime = single.endMs / 1000 + .03;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, single.startMs / 1000);

  const playsBeforeLoop = h.plays;
  h.seek(loop, 'loop'); await tick();
  h.video.currentTime = loop.endMs / 1000 + .03;
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.equal(h.video.currentTime, loop.startMs / 1000);
  assert.equal(h.video.paused, false);
  assert.equal(h.plays, playsBeforeLoop + 2);

  h.seek(all, 'all'); await tick();
  h.video.currentTime = all.endMs / 1000 + .03;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, false);
  assert.ok(h.video.currentTime > all.endMs / 1000);
});

test('switching YouTube subtitle track cancels the previous loop boundary', async t => {
  const h = await harness(t); providerCues(h, [1_000, 2_000]);
  const phrase = h.state().cues[0];
  h.seek(phrase, 'loop'); await tick();
  h.select(h.state().video.tracks[1].id); await tick();
  h.video.currentTime = phrase.endMs / 1000 + .05;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, false);
  assert.ok(h.video.currentTime > phrase.endMs / 1000);
});

test('a rejected YouTube play clears its pending segment boundary and reports without an unhandled rejection', async t => {
  const h = await harness(t); providerCues(h, [1_000]);
  h.video.play = async () => { throw new Error('synthetic autoplay rejection'); };
  h.seek(h.state().cues[0], 'loop'); await tick();
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /未完成/);
  h.video.paused = false;
  h.video.currentTime = h.state().cues[0].endMs / 1000 + .05;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(h.video.currentTime > h.state().cues[0].endMs / 1000);
});

test('YouTube clamps a segment end to media duration before enforcing single playback', async t => {
  const h = await harness(t); providerCues(h, [1_000]);
  h.video.duration = 1.2;
  h.seek(h.state().cues[0], 'single'); await tick();
  h.video.currentTime = 1.21;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 1);
});

test('switching from a loop pause to continuous mode resumes immediately instead of remaining stuck', async t => {
  const h = await harness(t); providerCues(h, [1_000]); const cue = h.state().cues[0];
  h.seek(cue, 'loop'); await tick(); h.video.currentTime = cue.endMs / 1000 + .01;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  h.send({ version: 1, type: 'playback-mode', mode: 'all', videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); assert.equal(h.video.paused, false);
});

test('a rejected YouTube loop resume stops cleanly without an unhandled promise rejection', async t => {
  const h = await harness(t); providerCues(h, [1_000]); const cue = h.state().cues[0];
  let calls = 0;
  h.video.play = async () => { calls++; if (calls > 1) throw new Error('synthetic loop resume rejection'); h.video.paused = false; };
  h.seek(cue, 'loop'); await tick(); h.video.currentTime = cue.endMs / 1000 + .01;
  await new Promise(resolve => setTimeout(resolve, 680));
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /已停止循环/);
  h.video.paused = false; h.video.currentTime = cue.endMs / 1000 + .1;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(h.video.currentTime > cue.endMs / 1000);
});
test('HTTP success with zero-byte content produces an explicit error', async t => {
  const h = await harness(t); h.setBody(''); h.load(); await tick();
  assert.equal(h.state().status, 'error'); assert.match(h.state().message, /空内容/); assert.equal(h.state().cues.length, 0);
});
test('a late previous-video response cannot overwrite a new video', async t => {
  const h = await harness(t); h.pause(); h.load(); await tick();
  await h.navigate('lmnopqrstuv'); h.release(); await tick();
  assert.equal(h.state().video.videoId, 'lmnopqrstuv'); assert.equal(h.state().cues.length, 0); assert.equal(h.state().status, 'ready');
});
test('Supadata provider data is explicitly labeled and supports bound-video seek', async t => {
  const h = await harness(t);
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'request-1' };
  h.send({ ...binding, type: 'supadata-begin' });
  const bilingualText = 'Hello, students.\n同学们，你们好。';
  h.send({ ...binding, type: 'supadata-finish', requestedLanguage: 'en-GB', data: { lang: 'en', content: [{ offset: 1234, duration: 500, text: bilingualText }] } });
  assert.equal(h.state().source, 'supadata'); assert.equal(h.state().cues[0].startMs, 1234);
  assert.equal(h.state().requestedLanguage, 'en-GB'); assert.equal(h.state().language, 'en');
  assert.equal(h.state().cues[0].text, bilingualText);
  h.seek(h.state().cues[0]); await tick(); assert.equal(h.video.currentTime, 1.234);
});
test('Supadata result for an old session is discarded after navigation', async t => {
  const h = await harness(t);
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'request-2' };
  h.send({ ...binding, type: 'supadata-begin' }); await h.navigate('lmnopqrstuv');
  h.send({ ...binding, type: 'supadata-finish', data: { lang: 'en', content: [{ offset: 100, duration: 10, text: 'old' }] } });
  assert.equal(h.state().video.videoId, 'lmnopqrstuv'); assert.equal(h.state().cues.length, 0);
});
test('Supadata can start without webpage tracks and survives their later arrival', async t => {
  const h = await harness(t); await h.updateTracks(false);
  assert.equal(h.state().video.tracks.length, 0);
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: 'request-late-tracks' };
  h.send({ ...binding, type: 'supadata-begin' });
  await h.updateTracks(true);
  assert.equal(h.state().status, 'loading'); assert.equal(h.state().trackId, 'supadata:request-late-tracks');
  h.send({ ...binding, type: 'supadata-finish', data: { lang: 'en', content: [{ offset: 1_200_125, duration: 375, text: '>> unchanged' }] } });
  assert.equal(h.state().status, 'loaded');
  await h.updateTracks(false); assert.equal(h.state().cues.length, 1);
  h.seek(h.state().cues[0]); await tick(); assert.equal(h.video.currentTime, 1200.125);
});

function providerCues(h, offsets = [1_234, 630_125, 1_250_875]) {
  const binding = { version: 1, videoId: h.state().video.videoId, session: h.state().video.session, requestId: randomUUID() };
  h.send({ ...binding, type: 'supadata-begin' });
  h.send({ ...binding, type: 'supadata-finish', data: { lang: 'en', content: offsets.map((offset, i) =>
    ({ offset, duration: 375, text: `synthetic position ${i}` })) } });
  return binding;
}

test('synthetic front/middle/end clicks preserve milliseconds and reject ads or out-of-range times', async t => {
  const h = await harness(t); h.video.duration = 1261; providerCues(h, [1234, 630125, 1250875, 1262000]);
  for (const cue of h.state().cues.slice(0, 3)) {
    h.seek(cue); await tick(); assert.equal(h.video.currentTime, cue.startMs / 1000);
  }
  assert.equal(h.plays, 3);
  h.seek(h.state().cues[3]); await tick(); assert.equal(h.plays, 3);
  assert.match(h.messages.at(-1).message, /超出/);
  h.setAd(true); h.seek(h.state().cues[0]); await tick(); assert.equal(h.plays, 3);
  assert.match(h.messages.at(-1).message, /广告/);
});

test('SPA navigation during pending seek drops the old operation, including A-B-A navigation', async t => {
  const h = await harness(t); const binding = providerCues(h);
  h.holdInfo(); h.seek(h.state().cues[0]); await tick();
  await h.navigate('lmnopqrstuv'); h.releaseInfo(); await tick();
  assert.equal(h.plays, 0); assert.equal(h.state().cues.length, 0);
  await h.navigate('abcdefghijk');
  assert.notEqual(h.state().video.session, binding.session);
  h.send({ ...binding, type: 'supadata-finish', data: { lang: 'en', content: [{ offset: 0, duration: 100, text: 'stale' }] } });
  assert.equal(h.state().cues.length, 0);
});

test('YouTube navigation cancels a hung page handshake and starts the new video handshake immediately', async t => {
  const h = await harness(t); h.holdInfo();
  h.send({ version: 1, type: 'refresh' }); await tick(); assert.equal(h.heldInfoCount(), 1);
  await h.navigate('lmnopqrstuv'); assert.equal(h.heldInfoCount(), 2);
  h.releaseInfo(); await tick(); assert.equal(h.state().video.videoId, 'lmnopqrstuv');
});

test('two simulated tabs on the same video reject each other\'s seek and provider results', async t => {
  const a = await harness(t), b = await harness(t);
  const bindingA = providerCues(a); const bindingB = providerCues(b);
  assert.notEqual(bindingA.session, bindingB.session);
  b.send({ version: 1, type: 'seek', videoId: bindingA.videoId, session: bindingA.session,
    trackId: a.state().trackId, cueId: a.state().cues[0].cueId });
  await tick(); assert.equal(a.plays, 0); assert.equal(b.plays, 0);
  a.seek(a.state().cues[2]); await tick(); assert.equal(a.plays, 1); assert.equal(b.video.currentTime, 0);
  b.seek(b.state().cues[1]); await tick(); assert.equal(b.plays, 1); assert.equal(a.video.currentTime, 1250.875);
  b.send({ ...bindingA, type: 'supadata-finish', data: { lang: 'en', content: [] } });
  assert.equal(b.state().status, 'loaded'); assert.equal(b.state().cues.length, 3);
});

test('disconnecting the requesting panel cancels its pending seek even with another panel connected', async t => {
  const h = await harness(t); providerCues(h); h.addPanel(); await tick();
  h.holdInfo(); h.seek(h.state().cues[0]); await tick();
  h.disconnect(); h.releaseInfo(); await tick();
  assert.equal(h.plays, 0); assert.equal(h.video.currentTime, 0);
});

test('play rejection after panel disconnect does not send to the closed port or the other panel', async t => {
  const h = await harness(t); providerCues(h);
  const other = h.addPanel(); await tick();
  let rejectPlay;
  h.video.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  h.seek(h.state().cues[0]); await tick(); assert.equal(typeof rejectPlay, 'function');
  h.disconnect(); rejectPlay(new Error('synthetic play interrupted')); await tick();
  assert.equal(other.messages.some(m => m.type === 'playback'), false);
  assert.equal(h.messages.some(m => m.type === 'playback'), false);
});
