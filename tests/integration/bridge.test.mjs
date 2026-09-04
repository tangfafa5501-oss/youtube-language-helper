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
  return { addListener: fn => listeners.add(fn), emit: (...values) => { for (const fn of listeners) fn(...values); } };
};
async function harness(t) {
  const timers = new Set();
  const connect = events();
  const runtimeMessage = events();
  const doc = new EventTarget();
  doc.documentElement = { dataset: {} };
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
  let plays = 0; let kernelPauses = 0; let fetched; let adShowing = false; let nativeAuthAvailable = true; let nativeFetchNeedsAuth = false; let primeClicks = 0;
  let nativeCachedEntry = null; let latestBehavior = 'normal';
  const nativeMessages = [];
  const video = Object.assign(new EventTarget(), { readyState: 4, duration: 1600, currentTime: 0, paused: true, playbackRate: 1, seeking: false });
  video.play = async () => { plays++; video.paused = false; video.dispatchEvent(new Event('play')); video.dispatchEvent(new Event('playing')); };
  video.pause = () => { video.paused = true; video.dispatchEvent(new Event('pause')); };
  const player = { pauseVideo: () => { kernelPauses++; }, getPlayerResponse: () => ({ videoDetails: { videoId, title: 'Synthetic fixture' }, playabilityStatus: { status: 'OK' },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: tracksReady ? [
      { baseUrl: `/api/timedtext?v=${videoId}&lang=en`, vssId: '.en', languageCode: 'en', name: { simpleText: 'English' } },
      { baseUrl: `/api/timedtext?v=${videoId}&lang=en&kind=asr`, vssId: 'a.en', languageCode: 'en', kind: 'asr', name: { simpleText: 'English auto' } },
    ] : [] } } }) };
  const subtitleButton = { disabled: false, pressed: false, getAttribute: name => name === 'aria-pressed' ? String(subtitleButton.pressed) : null,
    click: () => { subtitleButton.pressed = !subtitleButton.pressed; primeClicks++; if (subtitleButton.pressed) nativeAuthAvailable = true; } };
  doc.title = 'Synthetic fixture'; doc.getElementById = () => player;
  doc.querySelector = selector => selector.includes('ad-showing') ? (adShowing ? player : null)
    : selector.includes('ytp-subtitles-button') ? subtitleButton : video;
  const location = { href: `https://www.youtube.com/watch?v=${videoId}`, origin: 'https://www.youtube.com' };
  const context = createContext({ console, URL, AbortController, CustomEvent, Event, EventTarget, document: doc, location,
    TextDecoder, crypto: { randomUUID }, performance, setTimeout, clearTimeout,
    setInterval: (...args) => { const id = setInterval(...args); timers.add(id); return id; }, clearInterval,
    chrome: { runtime: { id: 'test-extension', onConnect: connect, onMessage: runtimeMessage,
      getURL: path => `chrome-extension://test-extension${path}`,
      sendMessage: async message => {
        if (message.channel !== 'ylh-youtube-native-v1') return { ok: false, error: 'unknown' };
        nativeMessages.push(structuredClone(message));
        if (message.type === 'latest') {
          if (latestBehavior === 'reject') throw new Error('synthetic background unavailable');
          if (latestBehavior === 'hang') return await new Promise(() => {});
          return nativeCachedEntry ? { ok: true, entry: nativeCachedEntry } : { ok: false, error: 'cache-miss' };
        }
        if (message.type === 'cache') return nativeCachedEntry && nativeCachedEntry.videoId === message.videoId
          && (nativeCachedEntry.language === message.language || !message.language.includes('-')
            && nativeCachedEntry.language.split('-')[0] === message.language.split('-')[0]) && nativeCachedEntry.kind === message.kind
          ? { ok: true, entry: nativeCachedEntry } : { ok: false, error: 'cache-miss' };
        if (message.type === 'auth-status') return { ok: true, available: nativeAuthAvailable };
        if (message.type === 'fetch') {
          fetched = message.baseUrl;
          if (nativeFetchNeedsAuth && !nativeAuthAvailable) return { ok: false, error: 'missing timedtext auth' };
          if (!responseBody.trim()) return { ok: false, error: 'YouTube 原生字幕返回空内容' };
          return { ok: true, entry: { videoId: message.videoId, language: message.language, kind: message.kind,
            body: responseBody, format: 'youtube-timedtext-json3', capturedAt: Date.now() } };
        }
        return { ok: false, error: 'unknown' };
      } } },
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
    var keyListeners = new Map(['keydown', 'keypress', 'keyup', 'blur'].map(type => [type, new Set()]));
    window.addEventListener = (type, listener, options) => {
      if (keyListeners.has(type)) keyListeners.get(type).add(listener); else bus.addEventListener(type, listener, options);
    };
    window.removeEventListener = (type, listener, options) => {
      if (keyListeners.has(type)) keyListeners.get(type).delete(listener); else bus.removeEventListener(type, listener, options);
    };
    var heldInfo = []; var holdInfo = false;
    window.postMessage = data => {
      if (holdInfo && data.direction === 'response' && 'video' in data) { heldInfo.push(data); return; }
      Promise.resolve().then(() => {
      const event = new Event('message'); Object.assign(event, { data, source: window, origin: location.origin }); bus.dispatchEvent(event);
    }); };`, context);
  const panels = [];
  await runInContext(mainCode, context);
  await runInContext(contentCode, context);
  t.after(() => { for (const panel of panels) panel.disconnect(); for (const timer of timers) clearInterval(timer); });
  assert.deepEqual({ ...doc.documentElement.dataset }, {
    ylhBuild: 'youtube-brake-v5', ylhYtBrakeCompensationMs: '250', ylhStatus: 'waiting', ylhPhraseCount: '0', ylhUnderTwoCount: '0',
  }, 'content script must expose its build before the side panel connects');
  const addPanel = () => {
    const messages = []; const onMessage = events(); const onDisconnect = events();
    let closed = false;
    const port = { name: 'ylh-panel-v1', sender: { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' },
      onMessage, onDisconnect, postMessage: m => { if (closed) throw Error('disconnected'); messages.push(structuredClone(m)); },
      disconnect: () => { closed = true; onDisconnect.emit(); } };
    connect.emit(port);
    const panel = { messages, onMessage, disconnect: port.disconnect,
      state: () => messages.filter(message => message.version === 1).at(-1) };
    panels.push(panel); return panel;
  };
  const { messages, onMessage, disconnect } = addPanel(); await tick();
  const state = () => messages.filter(m => m.version === 1).at(-1);
  const load = () => onMessage.emit({ version: 1, type: 'load', trackId: state().trackId, session: state().video.session });
  const seek = (cue, playMode = 'manual') => onMessage.emit({ version: 1, type: 'seek', videoId: state().video.videoId,
    session: state().video.session, trackId: state().trackId, cueId: cue.cueId, playMode });
  const keyEvent = (type, code, extra = {}) => {
    const event = { type, code, isTrusted: true, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    for (const listener of context.keyListeners.get(type)) { listener(event); if (event.stopped) break; }
    return event;
  };
  // Existing callers represent a complete physical press, not a permanently held key.
  const key = (code, extra = {}) => {
    const down = keyEvent('keydown', code, extra);
    if (!down.defaultPrevented) keyEvent('keypress', code, extra);
    keyEvent('keyup', code, { ...extra, repeat: false });
    return down;
  };
  return { state, load, seek, key, keyEvent, video, messages, nativeMessages, diagnostics: doc.documentElement.dataset, addPanel, disconnect,
    onNativeKeyup: listener => context.keyListeners.get('keyup').add(listener),
    get plays() { return plays; }, get kernelPauses() { return kernelPauses; },
    get fetched() { return fetched; }, get primeClicks() { return primeClicks; }, setNativeAuth: value => { nativeAuthAvailable = value; },
    setNativeFetchNeedsAuth: value => { nativeFetchNeedsAuth = value; },
    setNativeCache: entry => { nativeCachedEntry = entry; },
    setLatestBehavior: value => { latestBehavior = value; },
    capture: async entry => {
      nativeCachedEntry = entry;
      runtimeMessage.emit({ channel: 'ylh-youtube-native-v1', version: 1, type: 'captured', videoId: entry.videoId,
        language: entry.language, kind: entry.kind }, { id: 'test-extension' });
      await tick(); await tick();
    },
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

test('production YouTube display restores sentences across ASR events and preserves raw cues', async t => {
  const h = await harness(t);
  h.setBody(JSON.stringify({ events: [
    { tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: "It's the most famous revenge story ever" }] },
    { tStartMs: 2_000, dDurationMs: 2_000, segs: [{ utf8: 'written.' }] },
    { tStartMs: 4_000, dDurationMs: 1_000, segs: [{ utf8: 'How?' }] },
    { tStartMs: 5_000, dDurationMs: 3_000, segs: [{ utf8: 'The story continues.' }] },
  ] }));
  h.load(); await tick(); await tick();
  assert.equal(h.state().status, 'loaded');
  assert.deepEqual(h.state().phrases.map(row => [row.text, row.startMs, row.endMs]), [
    ["It's the most famous revenge story ever written.", 0, 4_000],
    ['How?', 4_000, 5_000],
    ['The story continues.', 5_000, 8_000],
  ]);
  assert.deepEqual(h.state().cues.map(cue => cue.text), [
    "It's the most famous revenge story ever", 'written.', 'How?', 'The story continues.',
  ]);
  assert.deepEqual({ ...h.diagnostics }, {
    ylhBuild: 'youtube-brake-v5', ylhYtBrakeCompensationMs: '250', ylhStatus: 'loaded', ylhPhraseCount: '3', ylhUnderTwoCount: '1',
  });
});

test('production YouTube ASR phrases clamp only the derived forward overlap', async t => {
  const h = await harness(t);
  const asr = h.state().video.tracks.find(track => track.kind === 'asr');
  assert.ok(asr);
  h.select(asr.id); await tick();
  h.setBody(JSON.stringify({ events: [
    { tStartMs: 1_000, dDurationMs: 3_500, segs: [{ utf8: 'First sentence.' }] },
    { tStartMs: 4_000, dDurationMs: 3_000, segs: [{ utf8: 'Second sentence.' }] },
  ] }));
  h.load(); await tick(); await tick();
  assert.deepEqual(h.state().phrases.map(row => [row.startMs, row.endMs]), [[1_000, 4_000], [4_000, 7_000]]);
  assert.deepEqual(h.state().cues.map(row => [row.startMs, row.endMs]), [[1_000, 4_500], [4_000, 7_000]],
    'raw JSON3 cues remain unchanged for audit and non-display consumers');
});

test('production bundle merges the exact installed-real single-one and wrong fragments', async t => {
  const h = await harness(t);
  h.setBody(JSON.stringify({ events: [
    { tStartMs: 4_000, dDurationMs: 2_000, segs: [{ utf8: 'And what if you were wrong about every' }] },
    { tStartMs: 5_990, dDurationMs: 2_010, segs: [{ utf8: '\n' }] },
    { tStartMs: 6_000, dDurationMs: 2_000, segs: [{ utf8: 'single one?' }] },
    { tStartMs: 7_990, dDurationMs: 3_010, segs: [{ utf8: '\n' }] },
    { tStartMs: 8_000, dDurationMs: 3_000, segs: [{ utf8: 'Think about that. Every match completely' }] },
    { tStartMs: 10_990, dDurationMs: 1_010, segs: [{ utf8: '\n' }] },
    { tStartMs: 11_000, dDurationMs: 1_000, segs: [{ utf8: 'wrong.' }] },
  ] }));
  h.load(); await tick(); await tick();
  assert.deepEqual(h.state().phrases.map(row => [row.text, row.startMs, row.endMs]), [
    ['And what if you were wrong about every single one?', 4_000, 8_000],
    ['Think about that. Every match completely wrong.', 8_000, 12_000],
  ]);
  assert.deepEqual(h.state().cues.map(cue => cue.text), [
    'And what if you were wrong about every', '\n', 'single one?', '\n',
    'Think about that. Every match completely', '\n', 'wrong.',
  ]);
  assert.equal(h.diagnostics.ylhUnderTwoCount, '0');
  assert.ok(h.state().phrases.every(row => row.endMs - row.startMs >= 2_000));
});

test('cold native path starts the selected track immediately instead of blocking on CC polling', async t => {
  const h = await harness(t); h.setNativeAuth(false);
  h.load(); await tick(); await tick();
  assert.equal(h.state().status, 'loaded');
  const operations = h.nativeMessages.map(message => message.type);
  assert.ok(operations.indexOf('fetch') >= 0);
  assert.ok(operations.indexOf('fetch') < operations.indexOf('auth-status'));
  assert.equal(h.primeClicks, 0);
});

test('cold native fallback retries the selected track as soon as timedtext auth appears', async t => {
  const h = await harness(t); h.setNativeAuth(false); h.setNativeFetchNeedsAuth(true);
  const startedAt = Date.now(); h.load();
  for (let attempt = 0; attempt < 20 && h.state().status !== 'loaded'; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(h.state().status, 'loaded');
  assert.ok(Date.now() - startedAt < 700, 'must not wait through the old 2.1-second body-cache loop');
  assert.equal(h.nativeMessages.filter(message => message.type === 'fetch').length, 2);
  assert.equal(h.primeClicks, 2, 'CC is enabled for auth capture and then restored');
});

test('captured webpage timedtext is pushed into the open panel and selects its real track', async t => {
  const h = await harness(t);
  const completedAt = Date.now() - 4;
  await h.capture({ videoId: h.state().video.videoId, language: 'en', kind: 'asr',
    body: JSON.stringify({ events: [{ tStartMs: 900, dDurationMs: 2_400, segs: [{ utf8: 'Captured immediately.' }] }] }),
    format: 'youtube-timedtext-json3', requestCompletedAt: completedAt, capturedAt: Date.now() - 2 });
  assert.equal(h.state().status, 'loaded');
  assert.equal(h.state().video.tracks.find(track => track.id === h.state().primaryTrackId).kind, 'asr');
  assert.equal(h.state().cues[0].text, 'Captured immediately.');
  assert.equal(h.state().nativeTimeline.source, 'captured');
  assert.equal(h.state().nativeTimeline.requestCompletedAt, completedAt);
  assert.equal(h.nativeMessages.some(message => message.type === 'fetch'), false);
});

test('panel reconnect consumes latest captured timedtext before requesting a selected track', async t => {
  const h = await harness(t); h.disconnect(); await tick();
  h.setNativeCache({ videoId: 'abcdefghijk', language: 'en', kind: 'manual',
    body: JSON.stringify({ events: [{ tStartMs: 2_000, dDurationMs: 2_100, segs: [{ utf8: 'Latest cache first.' }] }] }),
    format: 'youtube-timedtext-json3', requestCompletedAt: Date.now() - 5, capturedAt: Date.now() - 3 });
  const panel = h.addPanel(); await tick(); await tick();
  assert.equal(panel.state().status, 'loaded');
  assert.equal(panel.state().cues[0].text, 'Latest cache first.');
  assert.equal(panel.state().nativeTimeline.source, 'latest');
  assert.equal(h.nativeMessages.filter(message => message.type === 'fetch').length, 0);
  assert.ok(h.nativeMessages.some(message => message.type === 'latest'));
});

test('a rejected latest-cache query cannot strand the panel before automatic native loading', async t => {
  const h = await harness(t); h.disconnect(); await tick(); h.setLatestBehavior('reject');
  const panel = h.addPanel(); await tick(); await tick();
  assert.equal(panel.state().status, 'ready');
  panel.onMessage.emit({ version: 1, type: 'load', trackId: panel.state().trackId,
    videoId: panel.state().video.videoId, session: panel.state().video.session });
  await tick(); await tick();
  assert.equal(panel.state().status, 'loaded');
  assert.ok(panel.state().cues.length > 0);
});

test('a hung latest-cache query falls back to ready state instead of leaving the panel without subtitles', async t => {
  const h = await harness(t); h.disconnect(); await tick(); h.setLatestBehavior('hang');
  const panel = h.addPanel();
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(panel.state().status, 'ready');
  panel.onMessage.emit({ version: 1, type: 'load', trackId: panel.state().trackId,
    videoId: panel.state().video.videoId, session: panel.state().video.session });
  await tick(); await tick();
  assert.equal(panel.state().status, 'loaded');
});

test('a malformed latest cache entry is ignored and the selected track is fetched normally', async t => {
  const h = await harness(t); h.disconnect(); await tick();
  h.setNativeCache({ videoId: 'abcdefghijk', language: 'en', kind: 'manual', body: '{not-json',
    format: 'youtube-timedtext-json3', capturedAt: Date.now() });
  const panel = h.addPanel(); await tick(); await tick();
  assert.equal(panel.state().status, 'ready');
  panel.onMessage.emit({ version: 1, type: 'load', trackId: panel.state().trackId,
    videoId: panel.state().video.videoId, session: panel.state().video.session });
  await tick(); await tick();
  assert.equal(panel.state().status, 'loaded');
  assert.ok(h.nativeMessages.some(message => message.type === 'fetch'));
});

test('a unique regional cache entry satisfies a broad selected language without a false track-mismatch error', async t => {
  const h = await harness(t); h.disconnect(); await tick(); h.setLatestBehavior('reject');
  h.setNativeCache({ videoId: 'abcdefghijk', language: 'en-US', kind: 'manual',
    body: JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 2_000, segs: [{ utf8: 'Regional cache works.' }] }] }),
    format: 'youtube-timedtext-json3', capturedAt: Date.now() });
  const panel = h.addPanel(); await tick(); await tick();
  panel.onMessage.emit({ version: 1, type: 'load', trackId: panel.state().trackId,
    videoId: panel.state().video.videoId, session: panel.state().video.session });
  await tick(); await tick();
  assert.equal(panel.state().status, 'loaded');
  assert.equal(panel.state().cues[0].text, 'Regional cache works.');
  assert.equal(panel.state().language, 'en');
});

test('YouTube native primary and secondary tracks stay independent without a paid provider request', async t => {
  const h = await harness(t); h.load(); await tick();
  const primaryTrack = h.state().trackId;
  const primaryCues = structuredClone(h.state().cues);
  const secondaryTrack = h.state().video.tracks[1];
  h.setBody(JSON.stringify({ events: [{ tStartMs: 1500, dDurationMs: 600, segs: [{ utf8: 'Native secondary.' }] }] }));
  h.send({ version: 1, type: 'load-secondary', trackId: secondaryTrack.id,
    videoId: h.state().video.videoId, session: h.state().video.session });
  await tick();
  assert.equal(h.state().source, 'youtube'); assert.equal(h.state().trackId, primaryTrack);
  assert.deepEqual(h.state().cues, primaryCues);
  assert.equal(h.state().secondaryTrackId, secondaryTrack.id);
  assert.equal(h.state().secondaryCues[0].text, 'Native secondary.');
});
test('playback state follows the bound player and controls update the real video element', async t => {
  const h = await harness(t);
  h.video.currentTime = 12.24;
  h.send({ version: 1, type: 'playback-rate', rate: 1.5, videoId: h.state().video.videoId, session: h.state().video.session });
  h.send({ version: 1, type: 'playback-toggle', videoId: h.state().video.videoId, session: h.state().video.session });
  await new Promise(resolve => setTimeout(resolve, 300));
  const playback = h.messages.filter(message => message.type === 'playback-state').at(-1);
  assert.deepEqual(playback, { type: 'playback-state', videoId: h.state().video.videoId, session: h.state().video.session,
    trackId: h.state().trackId, currentTimeMs: 12240, playing: true, rate: 1.5, playMode: 'auto' });
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

test('YouTube manual and auto modes enforce distinct sentence boundaries', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 2_000, 3_000]);
  const [manual, auto] = h.state().cues;

  h.seek(manual, 'manual'); await tick(); await tick();
  // No timeupdate event is emitted: the controller-owned 12ms poller must be
  // sufficient to catch YouTube's dedicated 250ms lead threshold.
  h.video.currentTime = manual.endMs / 1000 - .251;
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(h.video.paused, false);
  h.video.currentTime = manual.endMs / 1000 - .250;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  const manualActualMs = h.video.currentTime * 1000;
  assert.ok(Math.abs(manualActualMs - manual.endMs) <= 20,
    `manual brake drift ${manualActualMs - manual.endMs}ms exceeds ±20ms`);
  assert.equal(h.diagnostics.ylhBrakeMode, 'manual');
  assert.equal(h.diagnostics.ylhBrakeTrigger, 'poller');
  assert.equal(Number(h.diagnostics.ylhBrakePollIntervalMs), 12);
  assert.equal(Number(h.diagnostics.ylhBrakeLeadMs), 250);
  assert.ok(h.kernelPauses >= 1, 'YouTube player pauseVideo() must be invoked at the boundary');
  assert.ok(Math.abs(Number(h.diagnostics.ylhBrakeDriftMs)) <= 20);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);

  h.seek(auto, 'auto'); await tick(); await tick();
  h.video.currentTime = auto.endMs / 1000 + .03;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, false);
  assert.ok(h.video.currentTime > auto.endMs / 1000);
});

test('YouTube previous navigation enters manual and play atomically returns to auto', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const [first, second] = h.state().cues;
  h.send({ version: 1, type: 'seek', cueId: first.cueId, playMode: 'auto', intent: 'previous',
    videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); await tick();
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'manual');
  h.video.currentTime = first.endMs / 1000;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(h.video.currentTime, first.endMs / 1000);
  h.send({ version: 1, type: 'playback-toggle', videoId: h.state().video.videoId, session: h.state().video.session });
  await new Promise(resolve => setTimeout(resolve, 280));
  assert.equal(h.video.currentTime, first.endMs / 1000);
  assert.equal(h.video.paused, false);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
});

for (const mode of ['auto', 'manual', 'shadowing', 'practice']) {
  test(`YouTube Space keyup cannot undo the keydown pause in ${mode}`, async t => {
    const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
    h.seek(h.state().cues[0], mode); await tick(); await tick();
    h.video.currentTime = 1.1;
    let nativeToggles = 0;
    // Explicitly simulated site release handler: the old keydown-only bridge leaks to it.
    h.onNativeKeyup(event => {
      if (event.code === 'Space' && !event.defaultPrevented) {
        nativeToggles++; if (h.video.paused) void h.video.play(); else h.video.pause();
      }
    });
    const plays = h.plays;
    assert.equal(h.keyEvent('keydown', 'Space').defaultPrevented, true);
    await tick(); assert.equal(h.video.paused, true, 'keydown pauses');
    for (let i = 0; i < 3; i++) {
      assert.equal(h.keyEvent('keydown', 'Space', { repeat: true }).defaultPrevented, true);
    }
    const up = h.keyEvent('keyup', 'Space'); await tick();
    assert.equal(h.video.paused, true, 'releasing Space must not let the site restart playback');
    assert.equal(up.defaultPrevented, true); assert.equal(up.stopped, true);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(h.video.paused, true); assert.equal(h.plays, plays); assert.equal(nativeToggles, 0);
    assert.equal(h.keyEvent('keydown', 'Space').defaultPrevented, true); await tick();
    assert.equal(h.video.paused, false, 'a new press plays, without seeking or restoring the old mode');
    assert.equal(h.keyEvent('keyup', 'Space').stopped, true); await tick();
    assert.equal(h.video.paused, false); assert.equal(h.plays, plays + 1); assert.equal(nativeToggles, 0);
    assert.equal(h.video.currentTime, 1.1);
    assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
  });
}

test('YouTube consumes only the paired Space press/release and releases ownership on blur', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const editor = { target: { closest: () => ({}) } };
  for (const extra of [editor, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { isTrusted: false }, { isComposing: true }]) {
    assert.equal(h.keyEvent('keydown', 'Space', extra).defaultPrevented, false);
    assert.equal(h.keyEvent('keypress', 'Space', extra).defaultPrevented, false);
    assert.equal(h.keyEvent('keyup', 'Space', extra).defaultPrevented, false);
  }
  assert.equal(h.keyEvent('keyup', 'Space').defaultPrevented, false, 'unowned release stays native');
  h.keyEvent('keydown', 'Space'); await tick();
  assert.equal(h.keyEvent('keypress', 'Space').stopped, true);
  assert.equal(h.keyEvent('keyup', 'KeyK').stopped, false);
  assert.equal(h.keyEvent('keyup', 'Space', { isTrusted: false }).stopped, false);
  assert.equal(h.keyEvent('keydown', 'Space', { repeat: true, ...editor }).stopped, true);
  assert.equal(h.keyEvent('keyup', 'Space', { shiftKey: true, ...editor }).stopped, true,
    'the claimed release stays suppressed even if focus or modifiers changed while held');
  assert.equal(h.keyEvent('keyup', 'Space').stopped, false);
  h.keyEvent('keydown', 'Space'); await tick();
  h.keyEvent('blur');
  assert.equal(h.keyEvent('keyup', 'Space').stopped, false, 'blur cannot leave a stuck held-key flag');
  const before = h.video.paused;
  h.keyEvent('keydown', 'Space'); await tick(); assert.equal(h.video.paused, !before);
  h.disconnect();
  assert.equal(h.keyEvent('keyup', 'Space').stopped, true, 'finish an already consumed press after disconnect');
  assert.equal(h.key('Space').defaultPrevented, false, 'future presses belong to the site after disconnect');
});

for (const mode of ['manual', 'shadowing']) {
  test(`YouTube page Space pauses ${mode} once then resumes auto; K and editors are untouched`, async t => {
    const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
    const first = h.state().cues[0];
    h.seek(first, mode); await tick(); await tick();
    h.video.currentTime = 1.1;
    for (const extra of [{ isTrusted: false }, { ctrlKey: true }, { isComposing: true },
      { target: { closest: () => ({}) } }]) assert.equal(h.key('Space', extra).defaultPrevented, false);
    assert.equal(h.key('KeyK').defaultPrevented, false);
    assert.equal(h.key('Space', { repeat: true }).defaultPrevented, true, 'consume repeats without toggling');
    assert.equal(h.video.paused, false);
    const pause = h.key('Space'); await tick();
    assert.equal(pause.defaultPrevented, true); assert.equal(pause.stopped, true);
    assert.equal(h.video.paused, true);
    const plays = h.plays;
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(h.plays, plays); assert.equal(h.video.currentTime, 1.1);
    assert.equal(h.key('Space').defaultPrevented, true);
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(h.video.paused, false); assert.equal(h.plays, plays + 1);
    assert.equal(h.video.currentTime, 1.1);
    assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
    h.video.currentTime = first.endMs / 1000 + .1;
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(h.video.paused, false);
    h.disconnect();
    assert.equal(h.key('Space').defaultPrevented, false, 'disconnected extension must leave native Space alone');
  });
}

for (const type of ['playback-toggle', 'playback-mode']) {
  test(`YouTube ${type} cancels a shadowing seek still awaiting page metadata`, async t => {
    const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
    h.video.currentTime = 1.2;
    h.holdInfo(); h.seek(h.state().cues[0], 'shadowing'); await tick();
    assert.ok(h.heldInfoCount() > 0);
    h.send({ version: 1, type, mode: 'auto', videoId: h.state().video.videoId, session: h.state().video.session });
    await tick(); h.releaseInfo(); await tick(); await tick();
    assert.equal(h.video.currentTime, 1.2, 'late seek must not rewind after a newer play or mode request');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'auto');
  });
}

test('YouTube shadowing waits the sentence duration then automatically advances', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const [first, second] = h.state().cues;
  h.seek(first, 'shadowing'); await tick(); await tick();
  h.video.currentTime = first.endMs / 1000 - .025;
  await new Promise(resolve => setTimeout(resolve, 50));
  const brakeActualMs = Number(h.diagnostics.ylhBrakeActualMs);
  assert.equal(h.diagnostics.ylhBrakeMode, 'shadowing');
  assert.equal(h.diagnostics.ylhBrakeTrigger, 'poller');
  assert.ok(Math.abs(brakeActualMs - first.endMs) <= 20,
    `shadowing brake drift ${brakeActualMs - first.endMs}ms exceeds ±20ms`);
  await new Promise(resolve => setTimeout(resolve, (first.endMs - first.startMs) / 2));
  assert.equal(h.video.currentTime, first.endMs / 1000); assert.equal(h.video.paused, true);
  await new Promise(resolve => setTimeout(resolve, (first.endMs - first.startMs) / 2 + 80));
  assert.equal(h.video.currentTime, second.startMs / 1000); assert.equal(h.video.paused, false);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).shadowingStartMs, second.startMs);
  assert.equal(h.messages.filter(message => message.type === 'playback-state').at(-1).playMode, 'shadowing');
});

test('switching YouTube subtitle track destroys the previous manual boundary', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 2_000]);
  const phrase = h.state().cues[0];
  h.seek(phrase, 'manual'); await tick(); await tick();
  h.select(h.state().video.tracks[1].id); await tick();
  h.video.currentTime = phrase.endMs / 1000 + .05;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, false);
  assert.ok(h.video.currentTime > phrase.endMs / 1000);
});

test('a rejected YouTube play clears its pending segment boundary and reports without an unhandled rejection', async t => {
  const h = await harness(t); await nativeCues(h, [1_000]);
  h.video.play = async () => { throw new Error('synthetic autoplay rejection'); };
  h.seek(h.state().cues[0], 'manual'); await tick(); await tick();
  assert.match(h.messages.filter(message => message.type === 'playback').at(-1).message, /未完成/);
  h.video.paused = false;
  h.video.currentTime = h.state().cues[0].endMs / 1000 + .05;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.ok(h.video.currentTime > h.state().cues[0].endMs / 1000);
});

test('YouTube clamps a manual sentence end to media duration', async t => {
  const h = await harness(t); await nativeCues(h, [1_000]);
  h.video.duration = 1.2;
  h.seek(h.state().cues[0], 'manual'); await tick(); await tick();
  h.video.currentTime = 1.21;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  assert.equal(h.video.currentTime, 1.2);
});

test('YouTube practice button replays its current phrase and page R/H reach the panel', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const first = h.state().cues[0]; h.seek(first, 'practice'); await tick(); await tick();
  h.video.currentTime = first.endMs / 1000; await new Promise(resolve => setTimeout(resolve, 40));
  h.send({ version: 1, type: 'practice-toggle', videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); await tick(); assert.equal(h.video.currentTime, first.startMs / 1000); assert.equal(h.video.paused, false);
  for (const [key, action] of [['KeyR', 'record'], ['KeyH', 'dictation']]) {
    assert.equal(h.key(key).defaultPrevented, true);
    assert.ok(h.messages.some(message => message.type === 'player-shortcut' && message.action === action));
  }
});

test('YouTube F toggles practice through the panel without leaking repeats or release to fullscreen', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const count = () => h.messages.filter(m => m.type === 'player-shortcut' && m.action === 'practice').length;
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

test('YouTube sentence-only mode neither forwards recording keys nor accepts audio capture', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 3_000]);
  const first = h.state().cues[0]; h.seek(first, 'shadowing'); await tick(); await tick();
  for (const key of ['KeyR', 'KeyH', 'KeyP', 'KeyG', 'BracketLeft']) assert.equal(h.key(key).defaultPrevented, false);
  const time = h.video.currentTime;
  h.send({ version: 1, type: 'practice-capture', phraseId: first.cueId, requestId: 'not-recording-mode',
    videoId: h.state().video.videoId, session: h.state().video.session }); await tick();
  assert.match(h.messages.find(message => message.requestId === 'not-recording-mode')?.error, /麦克风进入跟读模式/);
  assert.equal(h.video.currentTime, time); assert.equal(h.video.paused, false);
});

test('switching from manual waiting to auto resumes immediately', async t => {
  const h = await harness(t); await nativeCues(h, [1_000]); const cue = h.state().cues[0];
  h.seek(cue, 'manual'); await tick(); await tick(); h.video.currentTime = cue.endMs / 1000 + .01;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(h.video.paused, true);
  h.send({ version: 1, type: 'playback-mode', mode: 'auto', videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); assert.equal(h.video.paused, false);
});

test('rapid YouTube previous/next seeks leave only the last manual target active', async t => {
  const h = await harness(t); await nativeCues(h, [1_000, 2_000]);
  const [first, second] = h.state().cues;
  h.send({ version: 1, type: 'seek', cueId: first.cueId, playMode: 'auto', intent: 'previous',
    videoId: h.state().video.videoId, session: h.state().video.session });
  h.send({ version: 1, type: 'seek', cueId: second.cueId, playMode: 'auto', intent: 'next',
    videoId: h.state().video.videoId, session: h.state().video.session });
  await tick(); await tick(); await tick();
  assert.equal(h.video.currentTime, second.startMs / 1000);
  const playback = h.messages.filter(message => message.type === 'playback-state').at(-1);
  assert.equal(playback.playMode, 'manual'); assert.equal(playback.manualStartMs, second.startMs);
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
async function nativeCues(h, offsets = [1_234, 630_125, 1_250_875]) {
  h.setBody(JSON.stringify({ events: offsets.map((offset, index) => ({ tStartMs: offset, dDurationMs: 375,
    segs: [{ utf8: `synthetic position ${index}` }] })) }));
  const binding = { videoId: h.state().video.videoId, session: h.state().video.session };
  h.load(); await tick(); await tick();
  assert.equal(h.state().status, 'loaded');
  return binding;
}

test('synthetic front/middle/end clicks preserve milliseconds and reject ads or out-of-range times', async t => {
  const h = await harness(t); h.video.duration = 1261; await nativeCues(h, [1234, 630125, 1250875, 1262000]);
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
  const h = await harness(t); const binding = await nativeCues(h);
  h.holdInfo(); h.seek(h.state().cues[0]); await tick();
  await h.navigate('lmnopqrstuv'); h.releaseInfo(); await tick();
  assert.equal(h.plays, 0); assert.equal(h.state().cues.length, 0);
  await h.navigate('abcdefghijk');
  assert.notEqual(h.state().video.session, binding.session);
  assert.equal(h.state().cues.length, 0);
});

test('YouTube navigation cancels a hung page handshake and starts the new video handshake immediately', async t => {
  const h = await harness(t); h.holdInfo();
  h.send({ version: 1, type: 'refresh' }); await tick(); assert.equal(h.heldInfoCount(), 1);
  await h.navigate('lmnopqrstuv'); assert.equal(h.heldInfoCount(), 2);
  h.releaseInfo(); await tick(); assert.equal(h.state().video.videoId, 'lmnopqrstuv');
});

test('two simulated tabs on the same video reject each other\'s seek bindings', async t => {
  const a = await harness(t), b = await harness(t);
  const bindingA = await nativeCues(a); const bindingB = await nativeCues(b);
  assert.notEqual(bindingA.session, bindingB.session);
  b.send({ version: 1, type: 'seek', videoId: bindingA.videoId, session: bindingA.session,
    trackId: a.state().trackId, cueId: a.state().cues[0].cueId });
  await tick(); assert.equal(a.plays, 0); assert.equal(b.plays, 0);
  a.seek(a.state().cues[2]); await tick(); assert.equal(a.plays, 1); assert.equal(b.video.currentTime, 0);
  b.seek(b.state().cues[1]); await tick(); assert.equal(b.plays, 1); assert.equal(a.video.currentTime, 1250.875);
  assert.equal(b.state().status, 'loaded'); assert.equal(b.state().cues.length, 3);
});

test('disconnecting the requesting panel cancels its pending seek even with another panel connected', async t => {
  const h = await harness(t); await nativeCues(h); h.addPanel(); await tick();
  h.holdInfo(); h.seek(h.state().cues[0]); await tick();
  h.disconnect(); h.releaseInfo(); await tick();
  assert.equal(h.plays, 0); assert.equal(h.video.currentTime, 0);
});

test('play rejection after panel disconnect does not send to the closed port or the other panel', async t => {
  const h = await harness(t); await nativeCues(h);
  const other = h.addPanel(); await tick();
  let rejectPlay;
  h.video.play = () => new Promise((_, reject) => { rejectPlay = reject; });
  h.seek(h.state().cues[0]); await tick(); assert.equal(typeof rejectPlay, 'function');
  h.disconnect(); rejectPlay(new Error('synthetic play interrupted')); await tick();
  assert.equal(other.messages.some(m => m.type === 'playback'), false);
  assert.equal(h.messages.some(m => m.type === 'playback'), false);
});
