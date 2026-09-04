import { handlePracticeMessage } from '../lib/practice-bridge';
import { segmentFromRows } from '../lib/practice';
import { biliPhrases, biliVideo, chooseBiliPair, isBiliTrack, type BiliTrack } from '../lib/bilibili';
import { requestBilibili, type BiliMetadataTracks } from '../lib/bilibili-network';
import { shortcutAction } from '../lib/shortcuts';
import type { RawCue } from '../lib/captions';
import { PrecisePlaybackController, type PlaybackBoundary } from '../lib/playback-machine';
import { PORT, emptyState, isPlaybackRate, type PlayMode, type State, type Track } from '../lib/protocol';
import { record } from '../lib/captions';

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*', 'https://www.bilibili.com/list/*'], runAt: 'document_idle',
  main(ctx) {
    const BILI_CHANNEL = 'ylh-bilibili-page-v1';
    const clients = new Set<Browser.runtime.Port>();
    const urls = new Map<string, BiliTrack>();
    let state: State = { ...emptyState(), source: 'bilibili' }, locationKey = '', loadingKey = '', settledKey = '', refreshGeneration = 0, controller: AbortController | null = null;
    async function pageMetadataTracks(current: { bvid: string; page: number }) {
      const requestId = crypto.randomUUID();
      return await new Promise<BiliMetadataTracks | null>((resolve, reject) => {
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
            || message.tracks.length > 200 || !message.tracks.every(isBiliTrack) || typeof message.usedAiFallback !== 'boolean') {
            reject(new Error('B站页面字幕响应结构异常')); return;
          }
          resolve({ metadata: message.metadata as BiliMetadataTracks['metadata'], tracks: message.tracks,
            needLogin: Boolean(message.needLogin), usedAiFallback: message.usedAiFallback });
        }
        addEventListener('message', receive);
        window.postMessage({ channel: BILI_CHANNEL, direction: 'request', version: 1, type: 'metadata-tracks', requestId,
          bvid: current.bvid, page: current.page }, location.origin);
      });
    }
    const videoElement = () => document.querySelector<HTMLVideoElement>('.bpx-player-video-wrap video, #bilibili-player video, video');
    const publish = () => { for (const port of clients) try { port.postMessage(state); } catch { clients.delete(port); } };
    const publishPlayback = () => {
      const binding = state.video;
      const video = videoElement();
      const current = biliVideo(location.href);
      if (!binding || !current || `${current.bvid}:p${current.page}` !== settledKey || !video || video.readyState === 0
        || !Number.isFinite(video.currentTime) || video.currentTime < 0 || !Number.isFinite(video.playbackRate) || video.playbackRate <= 0) return;
      const machine = playback.state;
      const message = { type: 'playback-state', videoId: binding.videoId, session: binding.session, trackId: state.trackId,
        currentTimeMs: Math.round(video.currentTime * 1000), playing: !video.paused, rate: video.playbackRate, playMode: playback.mode,
        ...(machine.mode !== 'auto' && machine.phase !== 'idle'
          ? {
              playbackPhase: machine.phase,
              segmentStartMs: machine.segment.startMs,
              segmentEndMs: machine.segment.endMs,
              ...(machine.mode === 'manual'
                ? { manualStartMs: machine.segment.startMs, manualEndMs: machine.segment.endMs }
                : machine.mode === 'shadowing' ? { shadowingStartMs: machine.segment.startMs, shadowingEndMs: machine.segment.endMs }
                  : { practiceStartMs: machine.segment.startMs, practiceEndMs: machine.segment.endMs }),
            } : {}) };
      for (const port of clients) try { port.postMessage(message); } catch { clients.delete(port); }
    };
    const playback = new PrecisePlaybackController<Browser.runtime.Port>({
      getVideo: videoElement,
      ownerActive: owner => clients.has(owner),
      onState: () => publishPlayback(),
      onBrake: (_owner, report) => {
        const root = document.documentElement;
        if (!root) return;
        root.dataset.ylhBrakeMode = report.mode;
        root.dataset.ylhBrakeTrigger = report.trigger;
        root.dataset.ylhBrakePollIntervalMs = String(report.pollIntervalMs);
        root.dataset.ylhBrakeLeadMs = String(report.leadMs);
        root.dataset.ylhBrakePollTicks = String(report.pollTicks);
        root.dataset.ylhBrakeTargetMs = report.segment.endMs.toFixed(3);
        root.dataset.ylhBrakeDetectedMs = report.detectedMs.toFixed(3);
        root.dataset.ylhBrakePausedMs = report.pausedMs.toFixed(3);
        root.dataset.ylhBrakeActualMs = report.actualMs.toFixed(3);
        root.dataset.ylhBrakeDriftMs = report.driftMs.toFixed(3);
      },
    });
    const reset = (message = '正在读取 B 站视频…') => {
      controller?.abort(); controller = null; playback.clear('auto'); urls.clear();
      state = { ...emptyState(), source: 'bilibili', message }; publish();
    };
    async function loadTracks(primary: BiliTrack, secondary: BiliTrack | undefined, session: string) {
      if (state.video?.session !== session) return;
      const route = biliVideo(location.href); if (!route) return;
      controller?.abort(); const request = new AbortController(); controller = request;
      playback.clear('auto');
      state = { ...state, status: 'loading', trackId: primary.id, primaryTrackId: primary.id, secondaryTrackId: secondary?.id ?? null,
        secondaryStatus: secondary ? 'loading' : 'idle', secondaryMessage: secondary ? `正在读取 ${secondary.name}` : '',
        source: 'bilibili', language: primary.language, secondaryLanguage: secondary?.language,
        cues: [], secondaryCues: [], phrases: [], message: `正在读取 B 站 ${primary.name}…` }; publish();
      try {
        const [cues, secondaryCues] = await Promise.all([
          requestBilibili<RawCue[]>({ type: 'cues', ...route, track: primary }, request.signal),
          secondary ? requestBilibili<RawCue[]>({ type: 'cues', ...route, track: secondary }, request.signal) : Promise.resolve([]),
        ]);
        const phrases = biliPhrases(cues);
        if (request.signal.aborted || state.video?.session !== session) return;
        state = { ...state, status: 'loaded', cues, secondaryCues, phrases, eventCount: cues.length, controlEventCount: 0,
          secondaryStatus: secondary ? 'loaded' : 'idle', secondaryMessage: secondary ? `${secondary.name} 已就绪` : '',
          message: `B 站字幕已就绪：${cues.length} 条原始字幕，${phrases.length} 个可定位语段`,
          timingMessage: primary.kind === 'asr'
            ? `未发现人工字幕，当前使用 B站 ${primary.name} 作为保底；保留原始 from/to 时间。`
            : '使用 B站人工字幕原始 from/to 时间；句界在单条字幕内时不伪造新起点。' }; publish();
      } catch (error) {
        if (!request.signal.aborted && state.video?.session === session) {
          state = { ...state, status: 'error', cues: [], secondaryCues: [], phrases: [], secondaryStatus: 'error',
            message: error instanceof Error ? error.message : 'B 站字幕读取失败' }; publish();
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
        const pageResult = await pageMetadataTracks(current).catch(error => {
          if (error instanceof Error && /Failed to fetch|NetworkError|Load failed/i.test(error.message)) return null;
          throw error;
        });
        const result = pageResult ?? await requestBilibili<BiliMetadataTracks>({ type: 'metadata-tracks', ...current }, request.signal);
        const { metadata: info, tracks, needLogin, usedAiFallback } = result;
        if (request.signal.aborted || locationKey !== nextKey || refreshToken !== refreshGeneration) return;
        const selectableTracks = tracks.filter(track => !track.secondary);
        urls.clear(); for (const track of selectableTracks) urls.set(track.id, track);
        const publicTracks: Track[] = selectableTracks.map(track => ({ id: track.id, name: track.name, language: track.language, kind: track.kind,
          fingerprint: JSON.stringify([track.id, track.name, track.language, track.kind]) }));
        const selected = chooseBiliPair(selectableTracks);
        state = { ...emptyState(), source: 'bilibili', video: { videoId: current.bvid, title: info.title || document.title, session, tracks: publicTracks,
          availability: selectableTracks.length
            ? usedAiFallback ? '未发现人工字幕，已自动使用 B站 AI 字幕' : ''
            : needLogin ? 'B站字幕需要登录后读取' : '当前 B站视频没有可读取的字幕轨', platform: 'bilibili' },
          status: selectableTracks.length ? 'ready' : 'error', message: selectableTracks.length
            ? usedAiFallback ? `未发现人工字幕，已自动使用 B站 ${selected.primary?.name ?? 'AI 字幕'}` : '已发现 B站人工字幕轨'
            : needLogin ? '请先在 B站登录，再刷新视频读取字幕' : '当前视频没有可读取的字幕轨',
          trackId: selected.primary?.id ?? null, primaryTrackId: selected.primary?.id, secondaryTrackId: selected.secondary?.id ?? null,
          secondaryStatus: selected.secondary ? 'loading' : 'idle', cues: [], secondaryCues: [], eventCount: 0, controlEventCount: 0 };
        settledKey = nextKey;
        publish(); if (selected.primary) await loadTracks(selected.primary, selected.secondary, session);
      } catch (error) {
        if (locationKey === nextKey && refreshToken === refreshGeneration) {
          settledKey = nextKey;
          state = { ...emptyState(), source: 'bilibili', status: 'error', message: error instanceof Error ? error.message : 'B 站视频读取失败' }; publish();
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
      const range = message.endPhraseId ? segmentFromRows(state.phrases ?? [], message.phraseId, message.endPhraseId) : null;
      if (message.endPhraseId && !range) return;
      const startMs = phrase?.startMs ?? cue?.startMs, endMs = range?.endMs ?? phrase?.endMs ?? cue?.endMs;
      const video = videoElement();
      if (startMs === null || startMs === undefined || !video || video.readyState === 0 || !Number.isFinite(video.duration)) return;
      if (startMs / 1000 >= video.duration) {
        if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '条目时间超出当前视频，未执行定位',
          videoId: info.videoId, session: info.session, trackId: state.trackId }); } catch { /* disconnected */ }
        return;
      }
      const navigation = message.intent === 'previous' || message.intent === 'next' || message.intent === 'replay';
      const mode: PlayMode = message.playMode === 'shadowing' || message.playMode === 'practice' ? message.playMode
        : navigation || message.playMode === 'manual' ? 'manual' : 'auto';
      const boundedEnd = typeof endMs === 'number' ? Math.min(endMs, video.duration * 1000) : endMs;
      if (typeof boundedEnd !== 'number' || boundedEnd <= startMs) return;
      const rows = phrase ? state.phrases ?? [] : state.cues;
      const rowIndex = rows.findIndex(item => item === (phrase ?? cue));
      const queue: PlaybackBoundary[] = rows.slice(rowIndex + 1).flatMap(item => item.startMs !== null && item.endMs !== null && item.endMs > item.startMs
        ? [{ startMs: item.startMs, endMs: Math.min(item.endMs, video.duration * 1000) }] : []);
      const report = (text: string) => { if (clients.has(port)) try { port.postMessage({ type: 'playback', message: text,
        videoId: info.videoId, session: info.session, trackId: state.trackId }); } catch { /* disconnected */ } };
      try {
        const result = await playback.seek(port, { startMs, endMs: boundedEnd }, queue, mode);
        report(`精准定位完成：目标 ${(result.requestedMs / 1000).toFixed(3)} 秒，实际 ${(result.actualMs / 1000).toFixed(3)} 秒，误差 ${result.errorMs.toFixed(1)}ms`);
      } catch (error) {
        report(`定位/播放未完成：${error instanceof Error ? error.message : '播放被浏览器拦截'}`);
      }
    }
    async function control(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const binding = state.video;
      const video = videoElement();
      const current = biliVideo(location.href);
      if (!binding || !clients.has(port) || !video || video.readyState === 0 || !current || `${current.bvid}:p${current.page}` !== settledKey
        || message.videoId !== binding.videoId || message.session !== binding.session || message.trackId !== state.trackId) return;
      try {
        if (message.type === 'playback-toggle') {
          await playback.toggle(port);
        }
        if (message.type === 'practice-toggle') await playback.togglePractice(port);
        if (message.type === 'playback-rate' && isPlaybackRate(message.rate)) video.playbackRate = message.rate;
        if (message.type === 'playback-mode' && (message.mode === 'auto' || message.mode === 'manual' || message.mode === 'shadowing' || message.mode === 'practice')) {
          if (message.mode === 'auto') await playback.setMode('auto', port);
          else {
            const rows = state.phrases ?? [];
            let rowIndex = -1;
            for (let index = 0; index < rows.length; index++) {
              const row = rows[index]!;
              if (video.currentTime * 1000 >= row.startMs && video.currentTime * 1000 < row.endMs
                && (rowIndex < 0 || row.startMs >= rows[rowIndex]!.startMs)) rowIndex = index;
            }
            const row = rows[rowIndex];
            const queue = rows.slice(rowIndex + 1).map(item => ({ startMs: item.startMs, endMs: item.endMs }));
            if (!row || !await playback.arm(port, row, queue, message.mode)) await playback.setMode(message.mode, port);
          }
        }
      } catch { if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '播放被浏览器拦截',
        videoId: binding.videoId, session: binding.session, trackId: state.trackId }); } catch { /* disconnected */ } }
    }
    ctx.addEventListener(window, 'keydown', event => {
      const current = biliVideo(location.href), binding = state.video;
      if (!event.isTrusted || state.status !== 'loaded' || !binding || !current || `${current.bvid}:p${current.page}` !== settledKey) return;
      const action = shortcutAction(event, true), owner = [...clients].at(-1);
      if (!action || !owner) return;
      if (['record', 'dictation', 'pitch', 'play-recording', 'cancel-recording', 'dictation-focus',
        'expand-start', 'expand-end', 'contract-start', 'contract-end'].includes(action) && playback.mode !== 'practice') return;
      if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      // One key goes to one panel, then reuses its existing seek/playback state machine.
      try { owner.postMessage({ type: 'bilibili-shortcut', action, videoId: binding.videoId,
        session: binding.session, trackId: state.trackId }); } catch { clients.delete(owner); return; }
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    browser.runtime.onConnect.addListener(port => {
      if (port.name !== PORT || port.sender?.id !== browser.runtime.id || port.sender?.url !== browser.runtime.getURL('/sidepanel.html')) return;
      clients.add(port); port.postMessage(state); void refresh();
      port.onMessage.addListener(message => {
        if (!record(message) || message.version !== 1) return;
        const practiceSession = state.video?.session;
        if (handlePracticeMessage(message, port, state, playback, () => clients.has(port) && state.video?.session === practiceSession && (() => { const route = biliVideo(location.href); return !!route && `${route.bvid}:p${route.page}` === settledKey; })())) return;
        if (message.type === 'refresh') { settledKey = ''; void refresh(true); return; }
        if (message.type === 'seek') void seek(message, port);
        if (message.type === 'bilibili-select' && typeof message.trackId === 'string' && message.session === state.video?.session) {
          const primary = urls.get(message.trackId);
          const secondary = typeof message.secondaryTrackId === 'string' && message.secondaryTrackId !== message.trackId
            ? urls.get(message.secondaryTrackId) : undefined;
          if (primary) void loadTracks(primary, secondary, state.video!.session);
        }
        if (message.type === 'practice-toggle' || message.type === 'playback-toggle' || message.type === 'playback-rate' || message.type === 'playback-mode') void control(message, port);
      });
      port.onDisconnect.addListener(() => { clients.delete(port); if (playback.owns(port)) playback.clear('auto'); });
    });
    ctx.setInterval(() => { const current = biliVideo(location.href); const key = current ? `${current.bvid}:p${current.page}` : ''; if (key !== locationKey) void refresh(); }, 500);
    ctx.setInterval(publishPlayback, 250);
    ctx.onInvalidated(() => { refreshGeneration++; controller?.abort(); playback.destroy(); for (const port of clients) port.disconnect(); clients.clear(); });
  },
});
