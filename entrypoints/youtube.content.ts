import { parseJson3, parseJson3WordTimings, record, watchVideoId } from '../lib/captions';
import { CHANNEL, PORT, emptyState, isPlaybackRate, isVideoInfo, type State } from '../lib/protocol';
import { SessionGate } from '../lib/session';
import { parseSupadata, validLanguage } from '../lib/supadata';
import { buildTimedPhrases } from '../lib/timed-phrases';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], runAt: 'document_start',
  main(ctx) {
    type PlayMode = 'single' | 'loop' | 'all';
    type ActivePlayback = { owner: Browser.runtime.Port; startMs: number; endMs: number; mode: PlayMode; generation: number; looping: boolean };
    const clients = new Set<Browser.runtime.Port>();
    const gate = new SessionGate();
    let state: State = emptyState();
    let infoBusy = false;
    let activePlayback: ActivePlayback | null = null;
    let playbackGeneration = 0;
    const pending = new Map<string, { resolve: (data: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const publish = () => {
      for (const port of clients) {
        try { port.postMessage(state); } catch { clients.delete(port); }
      }
    };
    const publishPlayback = () => {
      const videoInfo = state.video;
      if (!videoInfo || watchVideoId(location.href) !== videoInfo.videoId) return;
      const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
      if (!video || video.readyState === 0 || !Number.isFinite(video.currentTime) || video.currentTime < 0
        || !Number.isFinite(video.playbackRate) || video.playbackRate <= 0) return;
      const message = {
        type: 'playback-state', videoId: videoInfo.videoId, session: videoInfo.session, trackId: state.trackId,
        currentTimeMs: Math.round(video.currentTime * 1000),
        playing: !video.paused, rate: video.playbackRate,
      };
      for (const port of clients) {
        try { port.postMessage(message); } catch { clients.delete(port); }
      }
    };
    function request(type: string, payload: object = {}): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('页面桥接超时，请刷新 YouTube 页面')); }, 17_000);
        pending.set(requestId, { resolve, reject, timer });
        window.postMessage({ channel: CHANNEL, direction: 'request', version: 1, requestId, type, ...payload }, location.origin);
      });
    }
    ctx.addEventListener(window, 'message', event => {
      const m = event.data;
      if (event.source !== window || event.origin !== location.origin || !record(m) || m.channel !== CHANNEL || m.direction !== 'response'
        || m.version !== 1 || typeof m.requestId !== 'string') return;
      const task = pending.get(m.requestId);
      if (!task) return;
      clearTimeout(task.timer); pending.delete(m.requestId);
      if (typeof m.error === 'string') task.reject(new Error(m.error.slice(0, 500)));
      else task.resolve(m);
    });
    function reset(message = '正在读取当前视频…') {
      gate.next(); activePlayback = null; playbackGeneration++; infoBusy = false;
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('视频会话已切换')); }
      pending.clear(); state = { ...emptyState(), message }; publish();
    }
    function clearPlaybackBoundary() { activePlayback = null; playbackGeneration++; }
    async function refresh() {
      if (infoBusy || !clients.size) return;
      infoBusy = true;
      const token = gate.capture();
      const expectedId = watchVideoId(location.href);
      try {
        const r = await request('info');
        if (!gate.current(token) || expectedId !== watchVideoId(location.href)) return;
        if (!r.video) { if (state.video) reset('请打开 YouTube /watch 视频页面'); return; }
        if (!isVideoInfo(r.video) || r.video.videoId !== expectedId) throw new Error('页面视频信息不匹配或结构异常');
        const v = r.video;
        if (state.video?.session !== v.session || JSON.stringify(state.video.tracks) !== JSON.stringify(v.tracks)
          || state.video.availability !== v.availability) {
          // The cloud result belongs to this video/session, not the webpage's
          // changing track list. Late player metadata must not cancel its job.
          if (state.video?.session === v.session && state.source === 'supadata') {
            state = { ...state, video: v }; publish(); return;
          }
          gate.next();
          state = { ...emptyState(), video: v, trackId: v.tracks[0]?.id ?? null, status: 'ready',
            message: '已连接视频。点击“读取字幕 · Supadata”；无需等待网页字幕轨或开启 CC。' };
          publish();
        }
      } catch (error) {
        if (gate.current(token) && !state.video) { state = { ...emptyState(), status: 'error', message: (error as Error).message }; publish(); }
      } finally { infoBusy = false; }
    }
    async function load(trackId: string) {
      const video = state.video;
      if (!video || !video.tracks.some(t => t.id === trackId) || state.status === 'loading') return;
      const token = gate.next();
      clearPlaybackBoundary();
      state = { ...state, source: 'youtube', language: video.tracks.find(t => t.id === trackId)?.language, trackId, status: 'loading', message: '正在请求网站原始字幕…', cues: [], eventCount: 0, controlEventCount: 0 }; publish();
      try {
        const r = await request('load', { videoId: video.videoId, session: video.session, trackId });
        if (!gate.current(token) || watchVideoId(location.href) !== video.videoId) return;
        if (r.videoId !== video.videoId || r.session !== video.session || r.trackId !== trackId || typeof r.body !== 'string') throw new Error('字幕响应会话不匹配');
        const parsed = parseJson3(r.body, trackId);
        state = { ...state, ...parsed, status: 'loaded', message: '原始条目已读取；未合并、排序、去重或自然断句' }; publish();
      } catch (error) {
        if (!gate.current(token)) return;
        state = { ...state, status: 'error', message: (error as Error).message }; publish();
      }
    }
    async function seek(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const v = state.video;
      if (!clients.has(port) || !v || message.videoId !== v.videoId || message.session !== v.session || message.trackId !== state.trackId
        || watchVideoId(location.href) !== v.videoId) return;
      const cue = state.cues.find(c => c.cueId === message.cueId);
      const phrase = typeof message.phraseId === 'string' ? state.phrases?.find(item => item.id === message.phraseId) : undefined;
      const targetMs = phrase?.startMs ?? cue?.startMs;
      const endMs = phrase?.endMs ?? cue?.endMs;
      if (targetMs === undefined || targetMs === null) return;
      const token = gate.next();
      // A different panel can keep this video session alive after the requester
      // disconnects. Session validity alone does not authorize its pending seek.
      const current = () => gate.current(token) && clients.has(port);
      const report = (message: string) => {
        if (!current()) return;
        try { port.postMessage({ type: 'playback', message, videoId: v.videoId, session: v.session, trackId: state.trackId }); }
        catch { /* The panel may close before Chrome delivers onDisconnect. */ }
      };
      try {
        const latest = await request('info');
        if (!current() || !isVideoInfo(latest.video) || latest.video.session !== v.session || watchVideoId(location.href) !== v.videoId) return;
        if (document.querySelector('#movie_player.ad-showing')) throw new Error('广告播放期间不定位，请等待正片');
        const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
        if (!video || video.readyState === 0 || !Number.isFinite(video.duration)) throw new Error('播放器尚未准备好定位');
        if (targetMs / 1000 >= video.duration) throw new Error('条目时间超出当前视频，未执行定位');
        const mode: PlayMode = message.playMode === 'loop' || message.playMode === 'all' ? message.playMode : 'single';
        const boundedEnd = typeof endMs === 'number' ? Math.min(endMs, video.duration * 1000) : endMs;
        const playbackToken = ++playbackGeneration;
        if (typeof boundedEnd === 'number' && boundedEnd > targetMs) {
          activePlayback = { owner: port, startMs: targetMs, endMs: boundedEnd, mode, generation: playbackToken, looping: false };
        } else {
          activePlayback = null;
        }
        video.currentTime = targetMs / 1000;
        try { await video.play(); }
        catch (error) {
          if (activePlayback?.generation === playbackToken) clearPlaybackBoundary();
          throw error;
        }
        report(`已定位至 ${(targetMs / 1000).toFixed(3)} 秒并请求播放`);
      } catch (error) {
        report(`定位/播放未完成：${(error as Error).message}`);
      }
    }
    async function loadWordTiming(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const v = state.video;
      const timingLanguage = validLanguage(state.language) ? state.language : validLanguage(message.language) ? message.language : null;
      if (!clients.has(port) || !v || state.status !== 'loaded' || state.source !== 'supadata'
        || message.videoId !== v.videoId || message.session !== v.session || state.trackId !== `supadata:${message.requestId}`
        || !timingLanguage || watchVideoId(location.href) !== v.videoId) return;
      const token = gate.capture(); state = { ...state, phrases: [], timingMessage: '正在读取 YouTube 自动轨词级时间…' }; publish();
      try {
        const r = await request('word-timing', { videoId: v.videoId, session: v.session, language: timingLanguage });
        if (!gate.current(token) || !clients.has(port) || state.video?.session !== v.session || state.trackId !== `supadata:${message.requestId}`) return;
        if (r.videoId !== v.videoId || r.session !== v.session || typeof r.body !== 'string') throw new Error('词级时间响应会话不匹配');
        const phrases = buildTimedPhrases(state.cues, parseJson3WordTimings(r.body));
        state = { ...state, phrases, message: '字幕与独立语段时间已就绪',
          timingMessage: `已用 YouTube 自动轨词级时间生成 ${phrases.length} 个独立时间语段；≤2秒语段已向后合并` };
      } catch (error) {
        if (!gate.current(token)) return;
        state = { ...state, phrases: [], message: '字幕已读取；独立语段时间不可用',
          timingMessage: `词级时间读取失败：${(error as Error).message}` };
      }
      publish();
    }
    async function playbackControl(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const v = state.video;
      if (!clients.has(port) || !v || message.videoId !== v.videoId || message.session !== v.session || message.trackId !== state.trackId
        || watchVideoId(location.href) !== v.videoId) return;
      const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
      if (!video || video.readyState === 0) return;
      try {
        if (message.type === 'playback-toggle') {
          if (video.paused) await video.play(); else video.pause();
        }
        if (message.type === 'playback-rate' && isPlaybackRate(message.rate)) video.playbackRate = message.rate;
        if (message.type === 'playback-mode' && (message.mode === 'single' || message.mode === 'loop' || message.mode === 'all')) {
          if (activePlayback?.owner === port) {
            const previous = activePlayback;
            if (video.currentTime * 1000 >= previous.endMs) clearPlaybackBoundary();
            else {
              activePlayback = { ...previous, mode: message.mode, looping: false, generation: ++playbackGeneration };
              if (previous.looping && message.mode === 'all' && video.paused) await video.play();
            }
          }
        }
      } catch {
        if (activePlayback?.owner === port) clearPlaybackBoundary();
        if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '播放被浏览器拦截',
          videoId: v.videoId, session: v.session, trackId: state.trackId }); } catch { /* disconnected */ }
      }
    }
    browser.runtime.onConnect.addListener(port => {
      if (port.name !== PORT || port.sender?.id !== browser.runtime.id || port.sender?.url !== browser.runtime.getURL('/sidepanel.html')) return;
      clients.add(port); port.postMessage(state); void refresh();
      port.onMessage.addListener(m => {
        if (!record(m) || m.version !== 1) return;
        if (m.type === 'refresh') { reset(); void refresh(); }
        if (m.type === 'supadata-begin' && state.status !== 'loading' && state.video && m.session === state.video.session
          && m.videoId === state.video.videoId && typeof m.requestId === 'string' && /^[\w-]{1,100}$/.test(m.requestId)) {
          gate.next(); clearPlaybackBoundary(); state = { ...state, source: 'supadata', trackId: `supadata:${m.requestId}`, status: 'loading', cues: [],
            eventCount: 0, controlEventCount: 0, message: '正在通过 Supadata 获取已有字幕（会使用服务额度）…' }; publish();
        }
        if (m.type === 'supadata-finish' && state.video && m.session === state.video.session && m.videoId === state.video.videoId
          && watchVideoId(location.href) === state.video.videoId && state.status === 'loading' && state.trackId === `supadata:${m.requestId}`) {
          gate.next();
          try {
            if (typeof m.error === 'string') throw new Error(m.error.slice(0, 500));
            const parsed = parseSupadata(m.data);
            state = { ...state, status: 'loaded', cues: parsed.cues, language: parsed.language, phrases: [],
              requestedLanguage: validLanguage(m.requestedLanguage) ? m.requestedLanguage : undefined,
              eventCount: parsed.cues.length, controlEventCount: 0,
              message: `Supadata 已返回 ${parsed.cues.length} 条，实际语言 ${parsed.language}。正在读取网站自动轨的词级时间…` };
          } catch (error) { state = { ...state, status: 'error', message: (error as Error).message }; }
          publish();
        }
        if (m.type === 'timing-load') void loadWordTiming(m, port);
        if (m.type === 'select' && typeof m.trackId === 'string' && m.session === state.video?.session
          && state.status !== 'loading' && state.video?.tracks.some(t => t.id === m.trackId)) {
          gate.next(); clearPlaybackBoundary(); state = { ...state, source: 'youtube', trackId: m.trackId, cues: [], eventCount: 0, controlEventCount: 0,
            status: 'ready', message: '字幕轨已切换，请读取原始条目' }; publish();
        }
        if (m.type === 'load' && typeof m.trackId === 'string' && m.session === state.video?.session) void load(m.trackId);
        if (m.type === 'seek') void seek(m, port);
        if (m.type === 'playback-toggle' || m.type === 'playback-rate' || m.type === 'playback-mode') void playbackControl(m, port);
      });
      port.onDisconnect.addListener(() => {
        clients.delete(port);
        if (activePlayback?.owner === port) { activePlayback = null; playbackGeneration++; }
        if (!clients.size) reset();
      });
    });
    ctx.addEventListener(document, 'yt-navigate-start', () => reset());
    ctx.addEventListener(document, 'yt-navigate-finish', () => { void refresh(); });
    ctx.setInterval(() => {
      if (state.video && watchVideoId(location.href) !== state.video.videoId) reset();
      void refresh();
    }, 1000);
    ctx.setInterval(publishPlayback, 250);
    ctx.setInterval(() => {
      const active = activePlayback;
      if (!active || active.mode === 'all' || active.looping || !clients.has(active.owner)) return;
      const video = document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
      if (!video || video.readyState === 0 || video.paused || video.currentTime * 1000 < active.endMs) return;
      video.pause();
      video.currentTime = active.startMs / 1000;
      if (active.mode === 'single') { publishPlayback(); return; }
      active.looping = true;
      const generation = active.generation;
      setTimeout(() => {
        const latest = activePlayback;
        if (!latest || latest.generation !== generation || latest.mode !== 'loop' || !clients.has(latest.owner)) return;
        void video.play().then(() => {
          if (activePlayback?.generation === generation) activePlayback.looping = false;
        }, () => {
          const failed = activePlayback;
          if (!failed || failed.generation !== generation) return;
          const owner = failed.owner; clearPlaybackBoundary();
          if (clients.has(owner) && state.video) try { owner.postMessage({ type: 'playback', message: '循环恢复播放被浏览器拦截，已停止循环',
            videoId: state.video.videoId, session: state.video.session, trackId: state.trackId }); } catch { /* disconnected */ }
        });
      }, 500);
    }, 50);
    ctx.onInvalidated(() => {
      gate.next();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('扩展已重载')); }
      pending.clear();
      for (const port of clients) port.disconnect();
      clients.clear();
    });
  },
});
