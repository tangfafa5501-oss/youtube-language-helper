import { handlePracticeMessage } from '../lib/practice-bridge';
import { segmentFromRows } from '../lib/practice';
import { parseJson3, record, watchVideoId } from '../lib/captions';
import { PrecisePlaybackController, type PlaybackBoundary } from '../lib/playback-machine';
import { CHANNEL, PORT, emptyState, isPlaybackRate, isVideoInfo, type PlayMode, type State } from '../lib/protocol';
import { SessionGate } from '../lib/session';
import { shortcutAction } from '../lib/shortcuts';
import { YOUTUBE_NATIVE_CHANNEL, nativeDisplayPhrases, normalizeNativeLanguage, validNativeTranscript, type NativeTrackKind,
  type NativeTranscript } from '../lib/youtube-native';

const YT_BRAKE_COMPENSATION = 250;

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], runAt: 'document_start',
  main(ctx) {
    const clients = new Set<Browser.runtime.Port>();
    const gate = new SessionGate();
    let seekGeneration = 0;
    let state: State = emptyState();
    let infoBusy = false;
    let secondaryGeneration = 0;
    let explicitPrimaryTrackId: string | null = null;
    let pendingCaptured: { entry: NativeTranscript; deliveredAt: number } | null = null;
    const pending = new Map<string, { resolve: (data: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const writeDiagnostics = () => {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.ylhBuild = 'youtube-brake-v5';
      root.dataset.ylhYtBrakeCompensationMs = String(YT_BRAKE_COMPENSATION);
      root.dataset.ylhStatus = state.status;
      const phrases = state.phrases ?? [];
      root.dataset.ylhPhraseCount = String(phrases.length);
      root.dataset.ylhUnderTwoCount = String(phrases.filter(row => row.endMs - row.startMs < 2_000).length);
    };
    const publish = () => {
      writeDiagnostics();
      for (const port of clients) {
        try { port.postMessage(state); } catch { clients.delete(port); }
      }
    };
    const publishPlayback = () => {
      const videoInfo = state.video;
      if (!videoInfo || watchVideoId(location.href) !== videoInfo.videoId) return;
      const video = videoElement();
      if (!video || video.readyState === 0 || !Number.isFinite(video.currentTime) || video.currentTime < 0
        || !Number.isFinite(video.playbackRate) || video.playbackRate <= 0) return;
      const machine = playback.state;
      const message = {
        type: 'playback-state', videoId: videoInfo.videoId, session: videoInfo.session, trackId: state.trackId,
        currentTimeMs: Math.round(video.currentTime * 1000),
        playing: !video.paused, rate: video.playbackRate, playMode: playback.mode,
        ...(machine.mode !== 'auto' && machine.phase !== 'idle'
          ? {
              playbackPhase: machine.phase,
              segmentStartMs: machine.segment.startMs,
              segmentEndMs: machine.segment.endMs,
              ...(machine.mode === 'manual'
                ? { manualStartMs: machine.segment.startMs, manualEndMs: machine.segment.endMs }
                : machine.mode === 'shadowing' ? { shadowingStartMs: machine.segment.startMs, shadowingEndMs: machine.segment.endMs }
                  : { practiceStartMs: machine.segment.startMs, practiceEndMs: machine.segment.endMs }),
            } : {}),
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
    const videoElement = () => document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video');
    const playback = new PrecisePlaybackController<Browser.runtime.Port>({
      getVideo: videoElement,
      ownerActive: owner => clients.has(owner),
      brakeLeadMs: YT_BRAKE_COMPENSATION,
      pauseAtBoundary: () => {
        const ytPlayer = document.getElementById('movie_player') as (HTMLElement & { pauseVideo?: () => void }) | null;
        if (typeof ytPlayer?.pauseVideo === 'function') ytPlayer.pauseVideo();
        const v = state.video;
        if (v) void request('pause-video', { videoId: v.videoId, session: v.session }).catch(() => undefined);
        // The controller calls video.pause() immediately after this hook. The
        // MAIN-world request above reaches YouTube's player object even when
        // its expando API is hidden from this isolated content-script world.
      },
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
    function reset(message = '正在读取当前视频…') {
      gate.next(); secondaryGeneration++; playback.clear('auto'); infoBusy = false;
      explicitPrimaryTrackId = null; pendingCaptured = null;
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('视频会话已切换')); }
      pending.clear(); state = { ...emptyState(), message }; publish();
    }
    function clearPlaybackBoundary() { playback.clear('auto'); }
    function matchingNativeTrack(video: NonNullable<State['video']>, entry: NativeTranscript) {
      const language = normalizeNativeLanguage(entry.language);
      const candidates = video.tracks.filter(track => track.kind === entry.kind);
      const exact = candidates.find(track => normalizeNativeLanguage(track.language) === language);
      if (exact) return exact;
      const base = language.split('-')[0];
      const compatible = candidates.filter(track => normalizeNativeLanguage(track.language).split('-')[0] === base);
      return compatible.length === 1 ? compatible[0]! : null;
    }
    function parsedNativeEntry(entry: NativeTranscript, trackId: string) {
      if (entry.format !== 'youtube-timedtext-json3') return null;
      try {
        const parsed = parseJson3(entry.body, trackId);
        return { parsed, phrases: nativeDisplayPhrases(parsed.cues, entry.kind) };
      } catch { return null; }
    }
    function entryMatchesSelectedTrack(entry: NativeTranscript, track: NonNullable<State['video']>['tracks'][number]) {
      if (entry.kind !== track.kind) return false;
      const expected = normalizeNativeLanguage(track.language);
      const actual = normalizeNativeLanguage(entry.language);
      return actual === expected || !expected.includes('-') && actual.split('-')[0] === expected.split('-')[0];
    }
    function applyNativeEntry(entry: NativeTranscript, source: 'captured' | 'latest' | 'cache' | 'network', deliveredAt: number) {
      const video = state.video;
      if (!video || video.videoId !== entry.videoId || watchVideoId(location.href) !== entry.videoId) return false;
      const track = matchingNativeTrack(video, entry);
      if (!track || explicitPrimaryTrackId && explicitPrimaryTrackId !== track.id) return false;
      if (state.status === 'loaded' && state.primaryTrackId !== track.id) return false;
      if (state.status === 'loaded' && state.nativeTimeline?.capturedAt === entry.capturedAt) return true;
      const payload = parsedNativeEntry(entry, track.id);
      if (!payload) return false;
      const { parsed, phrases } = payload;
      const samePrimary = state.primaryTrackId === track.id;
      gate.next(); clearPlaybackBoundary(); secondaryGeneration++;
      explicitPrimaryTrackId = null;
      state = { ...state, ...parsed, source: 'youtube', language: entry.language, trackId: track.id, primaryTrackId: track.id,
        secondaryTrackId: samePrimary ? state.secondaryTrackId : null,
        secondaryCues: samePrimary ? state.secondaryCues : [], secondaryLanguage: samePrimary ? state.secondaryLanguage : undefined,
        secondaryStatus: samePrimary ? state.secondaryStatus : 'idle', secondaryMessage: samePrimary ? state.secondaryMessage : '',
        phrases, status: 'loaded',
        message: `YouTube 网页原生字幕已即时同步：${phrases.length || parsed.cues.length} 行（${track.kind === 'asr' ? '自动轨' : '人工轨'}）`,
        nativeTimeline: { ...(entry.requestCompletedAt ? { requestCompletedAt: entry.requestCompletedAt } : {}),
          capturedAt: entry.capturedAt, deliveredAt, source } };
      publish();
      return true;
    }
    async function consumeCaptured(message: Record<string, unknown>, deliveredAt: number) {
      const videoId = typeof message.videoId === 'string' ? message.videoId : '';
      const language = typeof message.language === 'string' ? message.language : '';
      const kind = message.kind === 'manual' || message.kind === 'asr' ? message.kind : null;
      if (!/^[\w-]{11}$/.test(videoId) || !language || !kind || watchVideoId(location.href) !== videoId) return;
      const entry = await cachedNative(videoId, language, kind);
      if (!entry || watchVideoId(location.href) !== videoId) return;
      if (!state.video || state.video.videoId !== videoId) pendingCaptured = { entry, deliveredAt };
      else applyNativeEntry(entry, 'captured', deliveredAt);
    }
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
          gate.next(); explicitPrimaryTrackId = null;
          state = { ...emptyState(), video: v, trackId: v.tracks[0]?.id ?? null, primaryTrackId: v.tracks[0]?.id,
            secondaryTrackId: null, secondaryCues: [], secondaryStatus: 'idle', status: 'ready',
            message: '视频已连接，正在准备字幕。' };
          const deferred = pendingCaptured?.entry.videoId === v.videoId ? pendingCaptured : null;
          pendingCaptured = null;
          let latest = deferred;
          if (!latest) {
            const latestTask = nativeRuntime({ type: 'latest', videoId: v.videoId }).then(reply =>
              reply.ok === true && validNativeTranscript(reply.entry) ? { entry: reply.entry, deliveredAt: Date.now() } : null);
            latest = await Promise.race([latestTask,
              new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
            if (!latest) void latestTask.then(delayed => {
              if (delayed) applyNativeEntry(delayed.entry, 'latest', delayed.deliveredAt);
            });
          }
          if (state.video?.session !== v.session || watchVideoId(location.href) !== v.videoId) return;
          if (latest && applyNativeEntry(latest.entry, deferred ? 'captured' : 'latest', latest.deliveredAt)) return;
          publish();
        }
      } catch (error) {
        if (gate.current(token) && !state.video) { state = { ...emptyState(), status: 'error', message: (error as Error).message }; publish(); }
      } finally { infoBusy = false; }
    }
    async function nativeRuntime(payload: Record<string, unknown>) {
      try {
        const reply: unknown = await browser.runtime.sendMessage({ channel: YOUTUBE_NATIVE_CHANNEL, version: 1, ...payload });
        return record(reply) ? reply : { ok: false, error: '扩展后台没有返回原生字幕结果' };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : '扩展后台通信失败' };
      }
    }
    async function cachedNative(videoId: string, language: string, kind: NativeTrackKind) {
      const reply = await nativeRuntime({ type: 'cache', videoId, language, kind });
      return reply.ok === true && validNativeTranscript(reply.entry) ? reply.entry : null;
    }
    browser.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== browser.runtime.id || !record(message) || message.channel !== YOUTUBE_NATIVE_CHANNEL
        || message.version !== 1 || message.type !== 'captured') return;
      void consumeCaptured(message, Date.now());
    });
    async function nativeTranscript(video: NonNullable<State['video']>, trackId: string, force: boolean) {
      const track = video.tracks.find(item => item.id === trackId);
      if (!track) throw new Error('所选字幕轨不存在');
      if (!force) {
        const cached = await cachedNative(video.videoId, track.language, track.kind);
        if (cached && parsedNativeEntry(cached, trackId)) return { entry: cached, source: 'cache' as const };
      }
      const target = await request('native-target', { videoId: video.videoId, session: video.session, trackId });
      if (target.videoId !== video.videoId || target.session !== video.session || target.trackId !== trackId
        || typeof target.baseUrl !== 'string') throw new Error('字幕轨地址与当前视频不匹配');
      const fetchSelectedTrack = async () => {
        const reply = await nativeRuntime({ type: 'fetch', videoId: video.videoId, language: track.language, kind: track.kind,
          baseUrl: target.baseUrl, client: target.client });
        if (reply.ok !== true || !validNativeTranscript(reply.entry)) {
          throw new Error(typeof reply.error === 'string' ? reply.error.slice(0, 500) : 'YouTube 原生字幕读取失败');
        }
        return { entry: reply.entry as NativeTranscript, source: 'network' as const };
      };

      // Start the selected track immediately. Capturing a page-generated token is
      // only a parallel cold-start fallback and must never block a readable URL.
      let settled = false;
      const direct = fetchSelectedTrack().then(result => { settled = true; return result; });
      void direct.catch(() => undefined);
      const auth = await nativeRuntime({ type: 'auth-status', videoId: video.videoId, language: track.language, kind: track.kind });
      if (auth.available === true) return direct;
      // A locally readable selected track can settle in the same turn as the
      // auth check. Give it that turn before touching YouTube's CC control.
      await Promise.resolve();
      if (settled) return direct;

      const startedAt = Date.now();
      const directWon = new Error('direct-native-track-ready');
      const primed = (async () => {
        let toggled = false;
        try {
          if (settled) throw directWon;
          await request('prime-captions', { videoId: video.videoId, session: video.session }); toggled = true;
          for (let attempt = 0; attempt < 14; attempt++) {
            if (settled) throw directWon;
            await new Promise(resolve => setTimeout(resolve, 150));
            if (settled) throw directWon;
            const captured = await cachedNative(video.videoId, track.language, track.kind);
            if (captured && (!force || captured.capturedAt >= startedAt)) return { entry: captured, source: 'captured' as const };
            const capturedAuth = await nativeRuntime({ type: 'auth-status', videoId: video.videoId,
              language: track.language, kind: track.kind });
            if (capturedAuth.available === true) return await fetchSelectedTrack();
          }
          if (settled) throw directWon;
          return await fetchSelectedTrack();
        } finally {
          if (toggled) await request('restore-captions', { videoId: video.videoId, session: video.session }).catch(() => undefined);
        }
      })();
      try {
        const result = await Promise.any([direct, primed]);
        settled = true;
        return result;
      } catch (error) {
        const failures = error instanceof AggregateError ? error.errors : [error];
        const failure = failures.find(item => item !== directWon && item instanceof Error) ?? failures[0];
        throw failure instanceof Error ? failure : new Error('YouTube 原生字幕读取失败');
      }
    }
    async function load(trackId: string, lane: 'primary' | 'secondary' = 'primary', force = false, userInitiated = false) {
      const video = state.video;
      const track = video?.tracks.find(item => item.id === trackId);
      if (!video || !track || lane === 'primary' && state.status === 'loading'
        || lane === 'secondary' && (state.status !== 'loaded' || state.secondaryStatus === 'loading')) return;
      const samePrimary = state.primaryTrackId === trackId;
      const token = lane === 'primary' ? gate.next() : gate.capture();
      const secondaryToken = ++secondaryGeneration;
      if (lane === 'primary') {
        explicitPrimaryTrackId = userInitiated ? trackId : null;
        clearPlaybackBoundary();
        state = { ...state, source: 'youtube', language: track.language, trackId, primaryTrackId: trackId,
          secondaryTrackId: samePrimary ? state.secondaryTrackId : null, secondaryCues: samePrimary ? state.secondaryCues : [],
          secondaryStatus: samePrimary ? state.secondaryStatus : 'idle', status: 'loading', phrases: [],
          message: force ? '正在重新获取 YouTube 原生字幕…' : '正在读取 YouTube 原生字幕…', cues: [], eventCount: 0, controlEventCount: 0 };
      } else {
        state = { ...state, secondaryTrackId: trackId, secondaryCues: [], secondaryStatus: 'loading',
          secondaryMessage: '正在读取 YouTube 原生第二字幕…' };
      }
      publish();
      try {
        const result = await nativeTranscript(video, trackId, force);
        if ((lane === 'primary' && !gate.current(token)) || secondaryGeneration !== secondaryToken
          || watchVideoId(location.href) !== video.videoId) return;
        if (result.entry.videoId !== video.videoId || !entryMatchesSelectedTrack(result.entry, track)
          || result.entry.format !== 'youtube-timedtext-json3') throw new Error('原生字幕响应轨道不匹配');
        const parsed = parseJson3(result.entry.body, trackId);
        if (lane === 'primary') {
          const phrases = nativeDisplayPhrases(parsed.cues, result.entry.kind);
          state = { ...state, ...parsed, phrases, status: 'loaded',
            message: `YouTube 原生字幕已就绪：${phrases.length || parsed.cues.length} 行（完整句分组）`,
            nativeTimeline: { ...(result.entry.requestCompletedAt ? { requestCompletedAt: result.entry.requestCompletedAt } : {}),
              capturedAt: result.entry.capturedAt, deliveredAt: Date.now(), source: result.source } };
          explicitPrimaryTrackId = null;
        } else {
          state = { ...state, secondaryCues: parsed.cues, secondaryLanguage: result.entry.language, secondaryStatus: 'loaded',
            secondaryMessage: `第二字幕已就绪：${parsed.cues.length} 条` };
        }
        publish();
      } catch (error) {
        if ((lane === 'primary' && !gate.current(token)) || secondaryGeneration !== secondaryToken) return;
        if (lane === 'primary') { explicitPrimaryTrackId = null; state = { ...state, status: 'error', message: (error as Error).message }; }
        else state = { ...state, secondaryCues: [], secondaryStatus: 'error', secondaryMessage: (error as Error).message };
        publish();
      }
    }
    async function seek(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const v = state.video;
      if (!clients.has(port) || !v || message.videoId !== v.videoId || message.session !== v.session || message.trackId !== state.trackId
        || watchVideoId(location.href) !== v.videoId) return;
      const cue = state.cues.find(c => c.cueId === message.cueId);
      const phrase = typeof message.phraseId === 'string' ? state.phrases?.find(item => item.id === message.phraseId) : undefined;
      const targetMs = phrase?.startMs ?? cue?.startMs;
      const range = message.endPhraseId ? segmentFromRows(state.phrases ?? [], message.phraseId, message.endPhraseId) : null;
      if (message.endPhraseId && !range) return;
      const endMs = range?.endMs ?? phrase?.endMs ?? cue?.endMs;
      if (targetMs === undefined || targetMs === null) return;
      const token = gate.next();
      const seekToken = ++seekGeneration;
      // A different panel can keep this video session alive after the requester
      // disconnects. Session validity alone does not authorize its pending seek.
      const current = () => gate.current(token) && seekToken === seekGeneration && clients.has(port);
      const report = (message: string) => {
        if (!current()) return;
        try { port.postMessage({ type: 'playback', message, videoId: v.videoId, session: v.session, trackId: state.trackId }); }
        catch { /* The panel may close before Chrome delivers onDisconnect. */ }
      };
      try {
        const latest = await request('info');
        if (!current() || !isVideoInfo(latest.video) || latest.video.session !== v.session || watchVideoId(location.href) !== v.videoId) return;
        if (document.querySelector('#movie_player.ad-showing')) throw new Error('广告播放期间不定位，请等待正片');
        const video = videoElement();
        if (!video || video.readyState === 0 || !Number.isFinite(video.duration)) throw new Error('播放器尚未准备好定位');
        if (targetMs / 1000 >= video.duration) throw new Error('条目时间超出当前视频，未执行定位');
        const navigation = message.intent === 'previous' || message.intent === 'next' || message.intent === 'replay';
        const mode: PlayMode = message.playMode === 'shadowing' || message.playMode === 'practice' ? message.playMode
          : navigation || message.playMode === 'manual' ? 'manual' : 'auto';
        const boundedEnd = typeof endMs === 'number' ? Math.min(endMs, video.duration * 1000) : endMs;
        if (typeof boundedEnd !== 'number' || boundedEnd <= targetMs) throw new Error('播放语句结束时间无效');
        const rows = phrase ? state.phrases ?? [] : state.cues;
        const rowIndex = rows.findIndex(item => item === (phrase ?? cue));
        const queue: PlaybackBoundary[] = rows.slice(rowIndex + 1).flatMap(item => item.startMs !== null && item.endMs !== null && item.endMs > item.startMs
          ? [{ startMs: item.startMs, endMs: Math.min(item.endMs, video.duration * 1000) }] : []);
        const result = await playback.seek(port, { startMs: targetMs, endMs: boundedEnd }, queue, mode);
        report(`精准定位完成：目标 ${(result.requestedMs / 1000).toFixed(3)} 秒，实际 ${(result.actualMs / 1000).toFixed(3)} 秒，误差 ${result.errorMs.toFixed(1)}ms`);
      } catch (error) {
        report(`定位/播放未完成：${(error as Error).message}`);
      }
    }
    async function playbackControl(message: Record<string, unknown>, port: Browser.runtime.Port) {
      const v = state.video;
      if (!clients.has(port) || !v || message.videoId !== v.videoId || message.session !== v.session || message.trackId !== state.trackId
        || watchVideoId(location.href) !== v.videoId) return;
      const video = videoElement();
      if (!video || video.readyState === 0) return;
      try {
        if (message.type === 'playback-toggle') {
          // A queued info reply must not restore shadowing after a newer play.
          seekGeneration++;
          await playback.toggle(port);
        }
        if (message.type === 'practice-toggle') await playback.togglePractice(port);
        if (message.type === 'playback-rate' && isPlaybackRate(message.rate)) video.playbackRate = message.rate;
        if (message.type === 'playback-mode' && (message.mode === 'auto' || message.mode === 'manual' || message.mode === 'shadowing' || message.mode === 'practice')) {
          seekGeneration++;
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
      } catch {
        if (playback.owns(port)) playback.clear(playback.mode);
        if (clients.has(port)) try { port.postMessage({ type: 'playback', message: '播放被浏览器拦截',
          videoId: v.videoId, session: v.session, trackId: state.trackId }); } catch { /* disconnected */ }
      }
    }
    let ownsSpacePress = false;
    let ownsPracticePress = false;
    ctx.addEventListener(window, 'keydown', event => {
      if (event.isTrusted && event.code === 'KeyF' && ownsPracticePress) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.isTrusted && event.code === 'Space' && ownsSpacePress) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      const binding = state.video, owner = [...clients].at(-1), action = shortcutAction(event, true);
      if (!event.isTrusted || !action || state.status !== 'loaded' || !binding || !owner
        || watchVideoId(location.href) !== binding.videoId || !videoElement()?.readyState) return;
      if (['record', 'dictation', 'pitch', 'play-recording', 'cancel-recording', 'dictation-focus',
        'expand-start', 'expand-end', 'contract-start', 'contract-end'].includes(action) && playback.mode !== 'practice') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === 'Space') ownsSpacePress = true;
      if (event.code === 'KeyF') ownsPracticePress = true;
      if (event.repeat) return;
      if (action === 'play') void playbackControl({ type: 'playback-toggle', videoId: binding.videoId,
        session: binding.session, trackId: state.trackId }, owner);
      else try { owner.postMessage({ type: 'player-shortcut', action, videoId: binding.videoId,
        session: binding.session, trackId: state.trackId }); } catch { clients.delete(owner); }
    }, { capture: true });
    // YouTube can also toggle on release. Own the whole consumed Space gesture,
    // even if focus/modifiers change while held; never send a second play command.
    for (const type of ['keypress', 'keyup'] as const) ctx.addEventListener(window, type, event => {
      if (!event.isTrusted || event.code !== 'Space' || !ownsSpacePress) return;
      if (type === 'keyup') ownsSpacePress = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    ctx.addEventListener(window, 'blur', () => { ownsSpacePress = false; });
    // Consume the whole F gesture: holding/releasing must not also toggle site fullscreen.
    for (const type of ['keypress', 'keyup'] as const) ctx.addEventListener(window, type, event => {
      if (!event.isTrusted || event.code !== 'KeyF' || !ownsPracticePress) return;
      if (type === 'keyup') ownsPracticePress = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true });
    ctx.addEventListener(window, 'blur', () => { ownsPracticePress = false; });
    browser.runtime.onConnect.addListener(port => {
      if (port.name !== PORT || port.sender?.id !== browser.runtime.id || port.sender?.url !== browser.runtime.getURL('/sidepanel.html')) return;
      clients.add(port); port.postMessage(state); void refresh();
      port.onMessage.addListener(m => {
        if (!record(m) || m.version !== 1) return;
        const practiceSession = state.video?.session;
        if (handlePracticeMessage(m, port, state, playback, () => clients.has(port) && state.video?.session === practiceSession && watchVideoId(location.href) === state.video?.videoId)) return;
        if (m.type === 'refresh') { reset(); void refresh(); }
        if (m.type === 'secondary-clear' && state.video && m.session === state.video.session && m.videoId === state.video.videoId) {
          secondaryGeneration++; state = { ...state, secondaryTrackId: null, secondaryCues: [], secondaryLanguage: undefined,
            secondaryStatus: 'idle', secondaryMessage: '' }; publish();
        }
        if (m.type === 'select' && typeof m.trackId === 'string' && m.session === state.video?.session
          && state.status !== 'loading' && state.video?.tracks.some(t => t.id === m.trackId)) {
          gate.next(); clearPlaybackBoundary(); state = { ...state, source: 'youtube', trackId: m.trackId, primaryTrackId: m.trackId,
            secondaryTrackId: null, secondaryCues: [], secondaryStatus: 'idle', cues: [], eventCount: 0, controlEventCount: 0,
            status: 'ready', message: '字幕轨已切换，正在准备字幕' }; publish();
        }
        if (m.type === 'load' && typeof m.trackId === 'string' && m.session === state.video?.session) {
          void load(m.trackId, 'primary', m.force === true, m.userInitiated === true);
        }
        if (m.type === 'load-secondary' && typeof m.trackId === 'string' && m.session === state.video?.session) void load(m.trackId, 'secondary', m.force === true);
        if (m.type === 'seek') void seek(m, port);
        if (m.type === 'practice-toggle' || m.type === 'playback-toggle' || m.type === 'playback-rate' || m.type === 'playback-mode') void playbackControl(m, port);
      });
      port.onDisconnect.addListener(() => {
        clients.delete(port);
        if (playback.owns(port)) playback.clear('auto');
        if (!clients.size) reset();
      });
    });
    ctx.addEventListener(document, 'yt-navigate-start', () => reset());
    ctx.addEventListener(document, 'yt-navigate-finish', () => { void refresh(); });
    writeDiagnostics();
    ctx.setInterval(() => {
      writeDiagnostics();
      if (state.video && watchVideoId(location.href) !== state.video.videoId) reset();
      void refresh();
    }, 1000);
    ctx.setInterval(publishPlayback, 250);
    ctx.onInvalidated(() => {
      gate.next();
      playback.destroy();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('扩展已重载')); }
      pending.clear();
      for (const port of clients) port.disconnect();
      clients.clear();
    });
  },
});
