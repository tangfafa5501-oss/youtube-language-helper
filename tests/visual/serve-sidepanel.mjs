import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const outputRoot = normalize(join(import.meta.dirname, '..', '..', '.output', 'chrome-mv3'));
const port = Number(process.env.YLH_VISUAL_PORT || 4179);

const mockScript = String.raw`
(() => {
  const youtubeFixture = location.search.includes('youtube=1');
  const fragmentFixture = location.search.includes('fragments=1');
  const rawSettingsFixture = location.search.includes('settings=raw');
  const biliErrorFixture = new URLSearchParams(location.search).get('bili-error');
  const event = () => {
    const listeners = new Set();
    return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener),
      emit: value => { for (const listener of listeners) listener(value); } };
  };
  const onActivated = event(), onUpdated = event(), onMessage = event(), onDisconnect = event();
  let settings = { language: 'en', theme: 'light', displayMode: rawSettingsFixture ? 'raw' : 'phrases' };
  let playing = false, rate = 1;
  const tracks = [
    { id: 'en-gb', name: 'British English', language: 'en-GB', kind: 'manual' },
    { id: 'en-auto', name: 'English (auto)', language: 'en', kind: 'asr' },
    { id: 'zh-hans', name: '中文（简体）', language: 'zh-Hans', kind: 'manual' },
  ];
  const primary = fragmentFixture ? [
    ['r0', 'And what if you were wrong about every', 4000, 6000],
    ['r1', 'single one?', 6000, 8000],
    ['r2', 'Think about that. Every match completely', 8000, 11000],
    ['r3', 'wrong.', 11000, 12000],
  ] : [
    ['p0', 'Hello, lovely students, and welcome to your pronunciation training session.', 0, 4532],
    ['p1', 'Today, I am very excited to help you pronounce 100 everyday words', 4532, 9928],
    ['p2', 'in my Modern Received Pronunciation accent.', 9928, 13740],
    ['p3', "Now, I'm not just going to read a list of words to you.", 13740, 19220],
    ['p4', 'I want to make this really fun, productive and effective for you.', 19220, 24880],
    ['p5', "I've divided the words into 10 categories.", 24880, 29240],
    ['p6', 'Each focusing on a specific feature of my accent or British everyday vocabulary.', 29240, 35640],
    ['p7', 'When I say together, I mean that I would like you to speak along with me at the same time.', 35640, 42940],
  ];
  const cues = primary.map(([cueId, text, startMs, endMs], sourceIndex) => ({ cueId, sourceIndex, text, startMs, endMs,
    timingSource: 'start+duration', timingIssue: null, raw: { visualFixture: true } }));
  const phrases = fragmentFixture ? [
    { id: 'phrase:sentence-1', text: 'And what if you were wrong about every single one?', startMs: 4000, endMs: 8000,
      timing: 'youtube-native', sourceCueIds: ['r0', 'r1'] },
    { id: 'phrase:sentence-2', text: 'Think about that. Every match completely wrong.', startMs: 8000, endMs: 12000,
      timing: 'youtube-native', sourceCueIds: ['r2', 'r3'] },
  ] : primary.map(([id, text, startMs, endMs], index) => ({ id: 'phrase:' + id, text, startMs, endMs,
    timing: 'bilibili-cue', sourceCueIds: [cues[index].cueId] }));
  const translations = [
    ['s0', '大家好，欢迎来到今天的发音训练。', 0, 4532],
    ['s1', '今天我很高兴帮助你练习一百个日常单词。', 4532, 9928],
    ['s2', '使用现代标准英音。', 9928, 13740],
    ['s3', '我不只是给你读一串单词。', 13740, 19220],
    ['s4', '我希望练习有趣、有效并且富有成果。', 19220, 24880],
    ['s5', '我把这些词分成了十类。', 24880, 29240],
    ['s6', '每类都关注英音或日常词汇的一项特点。', 29240, 35640],
    ['s7', '我说“一起”时，是请你和我同时开口。', 35640, 42940],
  ].map(([cueId, text, startMs, endMs], sourceIndex) => ({ cueId, sourceIndex, text, startMs, endMs,
    timingSource: 'start+duration', timingIssue: null, raw: { visualFixture: true } }));
  const bilibiliState = { version: 1, status: 'loaded', source: 'bilibili', message: '字幕与自然语段已就绪',
    video: { platform: 'bilibili', videoId: 'BV1GJ411x7h7', title: 'British and American Compare Accents For The First Time!',
      session: 'visual-acceptance-session', tracks },
    trackId: 'en-gb', primaryTrackId: 'en-gb', secondaryTrackId: 'zh-hans', cues, phrases,
    language: 'en-GB', eventCount: cues.length, controlEventCount: 0, secondaryCues: translations,
    secondaryLanguage: 'zh-Hans', secondaryStatus: 'loaded', secondaryMessage: '' };
  let state = youtubeFixture ? { version: 1, status: 'ready', source: 'youtube', message: '视频已连接，正在准备字幕。',
    video: { platform: 'youtube', videoId: 'X627czLUsGY', title: 'Native YouTube subtitle acceptance',
      session: 'youtube-native-acceptance-session', tracks }, trackId: 'en-gb', primaryTrackId: 'en-gb',
    secondaryTrackId: null, secondaryCues: [], secondaryStatus: 'idle', cues: [], phrases: [], eventCount: 0, controlEventCount: 0 } : bilibiliState;
  if (biliErrorFixture) state = { ...bilibiliState, status: 'error', message: 'B站后台网络请求失败',
    video: biliErrorFixture === 'metadata' ? null : bilibiliState.video, cues: [], phrases: [] };
  const metrics = { nativeLoads: 0, secondaryLoads: 0, refreshes: 0, commands: [] };
  globalThis.__visualMetrics = metrics;
  globalThis.__simulateBilibiliShortcut = (action, binding = {}) => onMessage.emit({ type: 'bilibili-shortcut', action,
    videoId: state.video?.videoId, session: state.video?.session, trackId: state.trackId, ...binding });
  const exposeMetrics = () => { document.documentElement.dataset.nativeLoads = String(metrics.nativeLoads);
    document.documentElement.dataset.secondaryLoads = String(metrics.secondaryLoads); };
  exposeMetrics();
  const publish = () => queueMicrotask(() => onMessage.emit(structuredClone(state)));
  const portObject = { onMessage, onDisconnect, disconnect: () => onDisconnect.emit(), postMessage: message => {
    metrics.commands.push(structuredClone(message));
    if (message.type === 'seek') {
      const row = phrases.find(item => item.id === message.phraseId) || cues.find(item => item.cueId === message.cueId);
      playing = true; queueMicrotask(() => onMessage.emit({ type: 'playback-state', videoId: state.video.videoId,
        session: state.video.session, trackId: state.trackId, currentTimeMs: row?.startMs ?? 0, playing, rate }));
    } else if (message.type === 'playback-toggle') {
      playing = !playing; queueMicrotask(() => onMessage.emit({ type: 'playback-state', videoId: state.video.videoId,
        session: state.video.session, trackId: state.trackId, currentTimeMs: 4532, playing, rate }));
    } else if (message.type === 'playback-rate') {
      rate = message.rate; queueMicrotask(() => onMessage.emit({ type: 'playback-state', videoId: state.video.videoId,
        session: state.video.session, trackId: state.trackId, currentTimeMs: 4532, playing, rate }));
    } else if (message.type === 'bilibili-select') {
      state = { ...state, trackId: message.trackId, primaryTrackId: message.trackId,
        secondaryTrackId: message.secondaryTrackId || null, secondaryCues: message.secondaryTrackId ? translations : [] };
      publish();
    } else if (message.type === 'load') {
      metrics.nativeLoads++; exposeMetrics();
      state = { ...state, status: 'loading', trackId: message.trackId, primaryTrackId: message.trackId,
        message: '正在读取 YouTube 原生字幕…', cues: [], phrases: [] }; publish();
      setTimeout(() => { state = { ...state, status: 'loaded', source: 'youtube', cues, phrases: phrases.map(item => ({ ...item, timing: 'youtube-native' })),
        language: tracks.find(track => track.id === message.trackId)?.language || 'en-GB', eventCount: cues.length,
        controlEventCount: 0, message: 'YouTube 原生字幕已就绪：8 行（网站事件边界）' }; publish(); }, 120);
    } else if (message.type === 'load-secondary') {
      metrics.secondaryLoads++; exposeMetrics();
      state = { ...state, secondaryTrackId: message.trackId, secondaryStatus: 'loading', secondaryCues: [] }; publish();
      setTimeout(() => { state = { ...state, secondaryStatus: 'loaded', secondaryCues: translations,
        secondaryLanguage: 'zh-Hans', secondaryMessage: '第二字幕已就绪：8 条' }; publish(); }, 120);
    } else if (message.type === 'refresh') {
      metrics.refreshes++;
      state = { ...state, status: 'loading', message: '正在重新读取网站字幕…' }; publish();
      setTimeout(() => { state = { ...bilibiliState, status: 'loaded', message: '字幕与自然语段已就绪' }; publish(); }, 120);
    }
  } };
  globalThis.chrome = {
    runtime: { id: 'visual-acceptance', lastError: undefined, sendMessage: async message => {
      if (message.type === 'settings') return { ok: true, settings };
      if (message.type === 'save-preferences') {
        settings = { ...settings, theme: message.theme, displayMode: message.displayMode }; return { ok: true, settings };
      }
      return { ok: false, error: '视觉验收夹具未实现该请求' };
    } },
    tabs: { query: async () => [{ id: 7, windowId: 1, url: youtubeFixture
      ? 'https://www.youtube.com/watch?v=X627czLUsGY' : 'https://www.bilibili.com/video/BV1GJ411x7h7' }],
      connect: () => { publish(); return portObject; }, onActivated, onUpdated },
    permissions: { request: async () => true },
  };
})();
`;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (requestPath === '/__mock.js') {
      response.writeHead(200, { 'content-type': mime['.js'], 'cache-control': 'no-store' }); response.end(mockScript); return;
    }
    if (requestPath === '/' || requestPath === '/sidepanel.html') {
      const html = (await readFile(join(outputRoot, 'sidepanel.html'), 'utf8'))
        .replace('<script type="module"', '<script src="/__mock.js"></script><script type="module"');
      response.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-store' }); response.end(html); return;
    }
    const relative = normalize(decodeURIComponent(requestPath).replace(/^\/+/, ''));
    const file = normalize(join(outputRoot, relative));
    if (!file.startsWith(outputRoot) || !(await stat(file)).isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => console.log(`YHL visual acceptance: http://127.0.0.1:${port}/sidepanel.html`));
