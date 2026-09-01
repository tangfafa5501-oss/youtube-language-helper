import { biliCues, biliMetadata, biliPhrases, biliTracks, biliVideo, chooseBiliTrack, isBiliTrack, type BiliTrack } from '../lib/bilibili';
import { PORT, emptyState, isPlaybackRate, type State, type Track } from '../lib/protocol';
import { record } from '../lib/captions';

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*', 'https://www.bilibili.com/list/*'], runAt: 'document_idle',
  main(ctx) {
    const BILI_CHANNEL = 'ylh-bilibili-page-v1';
    type Mode = 'single' | 'loop' | 'all';
    const clients = new Set<Browser.runtime.Port>();
    const urls = new Map<string, BiliTrack>();
    let state: State = emptyState(), locationKey = '', loadingKey = '', settledKey = '', refreshGeneration = 0, controller: AbortController | null = null;
    let active: { owner: Browser.runtime.Port; startMs: number; endMs: number; mode: Mode; generation: number; looping: boolean } | null = null;
    let generation = 0;
    async function pageMetadataTracks(current: { bvid: string; page: number }) {
      const requestId = crypto.randomUUID();
      return await new Promise<{ metadata: Awaited<ReturnType<typeof biliMetadata>>; tracks: BiliTrack[]; needLogin: boolean } | null>((resolve, reject) => {
        let timeout = setTimeout(() => { removeEventListener('message', receive); resolve(null); }, 1_000);
        function receive(event: MessageEvent) {
          const message = event.data;
          if (event.source !== window || event.origin !== location.origin || !record(message) || message.channel !== BILI_CHANNEL
            || message.direction !== 'response' || message.version !== 1 || message.requestId !== requestId) return;
          if (message.stage === 'accepted') {
            clearTimeout(timeout);
            timeout = setTimeout(() => { removeEventListener('message', receive); reject(new Error('B站字幕轨请求超时')); }, 16_000);
            return;
          }
          clearTimeout(timeout); removeEventListener('message', receive);
          if (typeof message.error === 'string') { reject(new Error(message.error)); return; }
          if (!record(message.metadata) || !Number.isFinite(message.metadata.aid) || !Number.isFinite(message.metadata.cid)
            || typeof message.metadata.title !== 'string' || message.metadata.title.length > 1000 || !Array.isArray(message.tracks)
            || message.tracks.length > 200 || !message.tracks.every(isBiliTrack)) { reject(new Error('B站页面字幕响应结构异常')); return; }
          resolve({ metadata: message.metadata as Awaited<ReturnType<typeof biliMetadata>>, tracks: message.tracks, needLogin: Boolean(message.needLogin) });
        }
        addEventListener('message', receive);
        window.postMessage({ channel: BILI_CHANNEL, direction: 'request', version: 1, type: 'metadata-tracks', requestId,
          bvid: current.bvid, page: current.page }, location.origin);
      });
    }
    const videoElement = () => document.querySelector<HTMLVideoElement>('.bpx-player-video-wrap video, #bilibili-player video, video');
    const publish = () => { for (const port of clients) try { port.postMessage(state); } catch { clients.delete(port); } };
    const playback = () => {
      const binding = state.video;
      const video = videoElement();
      const current = biliVideo(location.href);
      if (!binding || !current || `${current.bvid}:p${current.page}` !== settledKey || !video || video.readyState === 0
        || !Number.isFinite(video.currentTime) || video.currentTime < 0 || !Number.isFinite(video.playbackRate) || video.playbackRate <= 0) return;
      const message = { type: 'playback-state', videoId: binding.videoId, session: binding.session, trackId: state.trackId,
        currentTimeMs: Math.round(video.currentTime * 1000), playing: !video.paused, rate: video.playbackRate };
      for (const port of clients) try { port.postMessage(message); } catch { clients.delete(port); }
    };
    const reset = (message = '正在读取 B 站视频…') => {
      controller?.abort(); controller = null; active = null; generation++; urls.clear();
      state = { ...emptyState(), message }; publish();
    };
    async function loadTrack(track: BiliTrack, session: string) {
      if (state.video?.session !== session) return;
      controller?.abort(); const request = new AbortController(); controller = request;
      active = null; generation++;
      state = { ...state, status: 'loading', trackId: track.id, source: 'bilibili', language: track.language, cues: [], phrases: [], message: `正在读取 B 站 ${track.name}…` }; publish();
      try {
        const cues = await biliCues(track, request.signal), phrases = biliPhrases(cues);
        if (request.signal.aborted || state.video?.session !== session) return;
        state = { ...state, status: 'loaded', cues, phrases, eventCount: cues.length, controlEventCount: 0,
          message: `B 站字幕已就绪：${cues.length} 条原始字幕，${phrases.length} 个可定位语段`,
          timingMessage: '使用 B 站原始 from/to 时间；句界在单条字幕内时不伪造新起点。' }; publish();
      } catch (error) {
        if (!request.signal.aborted && state.video?.session === session) {
          state = { ...state, status: 'error', cues: [], phrases: [], message: error instanceof Error ? error.message : 'B 站字幕读取失败' }; publish();
        }
      } finally { if (controller === request) controller = null; }
    }
    async function refresh(force = false) {
      const current = biliVideo(location.href); const nextKey = current ? `${current.bvid}:p${current.page}` : '';
      if (!force && (nextKey === loadingKey || nextKey === settledKey)) return;
      const refreshToken = ++refreshGeneration;
      locationKey = nextKey; reset(current ? '正在读取 B 站字幕轨…' : '请打开 B 站视频');
      if (!current || !clients.size) return;
      loadingKey = nextKey;
      const session = crypto.randomUUID();
      try {
        const request = new AbortController(); controller = request;
        const pageResult = await pageMetadataTracks(current);
        const info = pageResult?.metadata ?? await biliMetadata(current.bvid, current.page, request.signal);
        const { tracks, needLogin } = pageResult ?? await biliTracks(current.bvid, info.aid, info.cid, request.signal);
        if (request.signal.aborted || locationKey !== nextKey || refreshToken !== refreshGeneration) return;
        urls.clear(); for (const track of tracks) urls.set(track.id, track);
        const publicTracks: Track[] = tracks.map(track => ({ id: track.id, name: track.name, language: track.language, kind: track.kind,
          fingerprint: JSON.stringify([track.id, track.name, track.language, track.kind]) }));
        state = { ...emptyState(), video: { videoId: current.bvid, title: info.title || document.title, session, tracks: publicTracks,
          availability: tracks.length ? '' : needLogin ? 'B 站字幕需要登录后读取' : '当前 B 站视频没有可读取的官方字幕轨', platform: 'bilibili' },
          status: tracks.length ? 'ready' : 'error', message: tracks.length ? '已发现 B 站字幕轨' : needLogin ? '请先在 B 站登录，再刷新视频读取字幕' : '当前视频没有可读取的官方字幕轨',
          trackId: chooseBiliTrack(tracks)?.id ?? null, cues: [], eventCount: 0, controlEventCount: 0 };
        settledKey = nextKey;
        publish(); const selected = chooseBiliTrack(tracks); if (selected) await loadTrack(selected, session);
      } catch (error) {
        if (locationKey === nextKey && refreshToken === refreshGeneration) {
          settledKey = nextKey;
          state = { ...emptyState(), status: 'error', message: error instanceof Error ? error.message : 'B 站视频读取失败' }; publish();
        }
      } finally { if (loadingKey === nextKey && refreshToken === refreshGeneration) loadingKey = ''; }
    }
    async function seek(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const info = state.video;
      const current = biliVideo(location.href);
      if (!info || !clients.has(port) || !current || `${current.bvid}:p${current.page}` !== settledKey
        || message.videoId !== info.videoId || message.session !== info.session || message.trackId !== state.trackId) return;
      const phrase = typeof message.phraseId === 'string' ? state.phrases?.find(item => item.id === message.phraseId) : undefined;
      const cue = typeof message.cueId === 'string' ? state.cues.find(item => item.cueId === message.cueId) : undefined;
      const startMs = phrase?.startMs ?? cue?.startMs, endMs = phrase?.endMs ?? cue?.endMs;
      const video = videoElement();
      if (startMs === null || startMs === undefined || !video || video.readyState === 0 || !Number.isFinite(video.duration)) return;
      if (startMs / 1000 >= video.duration) {
        if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '条目时间超出当前视频，未执行定位',
          videoId: info.videoId, session: info.session, trackId: state.trackId }); } catch { /* disconnected */ }
        return;
      }
      const mode: Mode = message.playMode === 'loop' || message.playMode === 'all' ? message.playMode : 'single';
      const boundedEnd = typeof endMs === 'number' ? Math.min(endMs, video.duration * 1000) : endMs;
      const token = ++generation;
      active = typeof boundedEnd === 'number' && boundedEnd > startMs ? { owner: port, startMs, endMs: boundedEnd, mode, generation: token, looping: false } : null;
      video.currentTime = startMs / 1000;
      const report = (text: string) => { if (clients.has(port)) try { port.postMessage({ type: 'playback', message: text,
        videoId: info.videoId, session: info.session, trackId: state.trackId }); } catch { /* disconnected */ } };
      try { await video.play(); report(`已定位至 ${(startMs / 1000).toFixed(3)} 秒并请求播放`); }
      catch {
        if (active?.generation === token) { active = null; generation++; }
        report('已定位，播放被浏览器拦截');
      }
    }
    async function control(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const binding = state.video;
      const video = videoElement();
      const current = biliVideo(location.href);
      if (!binding || !clients.has(port) || !video || video.readyState === 0 || !current || `${current.bvid}:p${current.page}` !== settledKey
        || message.videoId !== binding.videoId || message.session !== binding.session || message.trackId !== state.trackId) return;
      try {
        if (message.type === 'playback-toggle') { if (video.paused) await video.play(); else video.pause(); }
        if (message.type === 'playback-rate' && isPlaybackRate(message.rate)) video.playbackRate = message.rate;
        if (message.type === 'playback-mode' && (message.mode === 'single' || message.mode === 'loop' || message.mode === 'all') && active?.owner === port) {
          const previous = active;
          if (video.currentTime * 1000 >= previous.endMs) { active = null; generation++; }
          else {
            active = { ...previous, mode: message.mode, generation: ++generation, looping: false };
            if (previous.looping && message.mode === 'all' && video.paused) await video.play();
          }
        }
      } catch { if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '播放被浏览器拦截',
        videoId: binding.videoId, session: binding.session, trackId: state.trackId }); } catch { /* disconnected */ } }
    }
    browser.runtime.onConnect.addListener(port => {
      if (port.name !== PORT || port.sender?.id !== browser.runtime.id || port.sender?.url !== browser.runtime.getURL('/sidepanel.html')) return;
      clients.add(port); port.postMessage(state); void refresh();
      port.onMessage.addListener(message => {
        if (!record(message) || message.version !== 1) return;
        if (message.type === 'refresh') { settledKey = ''; void refresh(true); return; }
        if (message.type === 'seek') void seek(message, port);
        if (message.type === 'bilibili-select' && typeof message.trackId === 'string' && message.session === state.video?.session) {
          const track = urls.get(message.trackId); if (track) void loadTrack(track, state.video!.session);
        }
        if (message.type === 'playback-toggle' || message.type === 'playback-rate' || message.type === 'playback-mode') void control(message, port);
      });
      port.onDisconnect.addListener(() => { clients.delete(port); if (active?.owner === port) { active = null; generation++; } });
    });
    ctx.setInterval(() => { const current = biliVideo(location.href); const key = current ? `${current.bvid}:p${current.page}` : ''; if (key !== locationKey) void refresh(); }, 500);
    ctx.setInterval(playback, 250);
    ctx.setInterval(() => {
      const item = active, video = videoElement();
      if (!item || !video || item.mode === 'all' || item.looping || video.paused || video.currentTime * 1000 < item.endMs) return;
      video.pause(); video.currentTime = item.startMs / 1000;
      if (item.mode === 'single') { playback(); return; }
      item.looping = true; const token = item.generation;
      setTimeout(() => {
        if (active?.generation !== token || active.mode !== 'loop') return;
        void video.play().then(() => { if (active?.generation === token) active.looping = false; }, () => {
          const failed = active;
          if (!failed || failed.generation !== token) return;
          const owner = failed.owner; active = null; generation++;
          if (clients.has(owner) && state.video) try { owner.postMessage({ type: 'playback', message: '循环恢复播放被浏览器拦截，已停止循环',
            videoId: state.video.videoId, session: state.video.session, trackId: state.trackId }); } catch { /* disconnected */ }
        });
      }, 500);
    }, 50);
    ctx.onInvalidated(() => { refreshGeneration++; controller?.abort(); for (const port of clients) port.disconnect(); clients.clear(); });
  },
});
