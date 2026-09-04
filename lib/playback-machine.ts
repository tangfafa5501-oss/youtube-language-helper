import { captureVideoAudio } from './capture-audio.ts';
import type { PlayMode } from './protocol.ts';

export type PlaybackBoundary = { startMs: number; endMs: number };
type ActivePlayMode = Exclude<PlayMode, 'auto'>;

export type PlaybackMachineState =
  | { mode: PlayMode; phase: 'idle'; generation: number }
  | { mode: 'manual' | 'practice'; phase: 'seeking' | 'playing'; generation: number;
      segment: PlaybackBoundary; queue: PlaybackBoundary[] }
  | { mode: 'shadowing'; phase: 'seeking' | 'playing'; generation: number;
      segment: PlaybackBoundary; queue: PlaybackBoundary[] }
  | { mode: 'manual' | 'practice'; phase: 'waiting'; generation: number; segment: PlaybackBoundary;
      queue: PlaybackBoundary[]; boundaryDetectedErrorMs: number; boundaryErrorMs: number }
  | { mode: 'shadowing'; phase: 'waiting'; generation: number; segment: PlaybackBoundary;
      queue: PlaybackBoundary[]; boundaryDetectedErrorMs: number; boundaryErrorMs: number;
      waitDurationMs: number; resumeAtMs: number };

type ShadowingWait = Extract<PlaybackMachineState, { mode: 'shadowing'; phase: 'waiting' }>;

export type PreciseSeekResult = { requestedMs: number; actualMs: number; errorMs: number };

export type BrakeTrigger = 'poller' | 'media-event' | 'arm';
export type BrakeReport = {
  mode: ActivePlayMode;
  segment: PlaybackBoundary;
  trigger: BrakeTrigger;
  pollIntervalMs: number;
  leadMs: number;
  pollTicks: number;
  detectedMs: number;
  pausedMs: number;
  actualMs: number;
  driftMs: number;
};

type ControllerOptions<Owner> = {
  getVideo: () => HTMLVideoElement | null;
  ownerActive: (owner: Owner) => boolean;
  brakeLeadMs?: number;
  pauseAtBoundary?: (video: HTMLVideoElement) => void;
  onState?: (state: PlaybackMachineState) => void;
  onBrake?: (owner: Owner, report: BrakeReport) => void;
};


const SEEK_TIMEOUT_MS = 3_000;
export const SEEK_TOLERANCE_MS = 80;
// Browser media events can be roughly 250ms apart. A single controller-owned
// poller is therefore the primary brake; media events remain only a secondary
// safety track. The 30ms lead absorbs normal renderer/scheduler latency, then
// the paused media clock is calibrated to the canonical phrase boundary.
export const BRAKE_POLL_INTERVAL_MS = 12;
export const BRAKE_LEAD_MS = 30;
export const BRAKE_PRECISION_MS = 20;

function validBoundary(value: PlaybackBoundary) {
  return Number.isFinite(value.startMs) && Number.isFinite(value.endMs) && value.startMs >= 0 && value.endMs > value.startMs;
}

export class PrecisePlaybackController<Owner> {
  private readonly options: ControllerOptions<Owner>;
  private generation = 0;
  private stateValue: PlaybackMachineState = { mode: 'auto', phase: 'idle', generation: 0 };
  private owner: Owner | null = null;
  private video: HTMLVideoElement | null = null;
  private videoListeners: AbortController | null = null;
  private seekListener: AbortController | null = null;
  private brakePoller: ReturnType<typeof setInterval> | null = null;
  private brakePollTicks = 0;
  private captureAbort: AbortController | null = null;
  private shadowingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ControllerOptions<Owner>) { this.options = options; }

  get state() { return this.stateValue; }
  get mode(): PlayMode { return this.stateValue.mode; }
  get brakePollerActive() { return this.brakePoller !== null; }
  owns(owner: Owner) { return this.owner === owner; }


  private brakeLeadMs() {
    const configured = this.options.brakeLeadMs;
    return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
      ? configured : BRAKE_LEAD_MS;
  }

  private emit(next: PlaybackMachineState) {
    this.stateValue = next;
    this.options.onState?.(next);
  }

  private clearBrakePoller() {
    if (this.brakePoller !== null) clearInterval(this.brakePoller);
    this.brakePoller = null;
  }

  private clearShadowingTimer() {
    if (this.shadowingTimer !== null) clearTimeout(this.shadowingTimer);
    this.shadowingTimer = null;
  }

  private invalidate(mode: PlayMode = this.mode) {
    this.generation++;
    this.seekListener?.abort();
    this.seekListener = null;
    this.clearBrakePoller();
    this.clearShadowingTimer();
    this.captureAbort?.abort(); this.captureAbort = null;
    this.owner = null;
    this.emit({ mode, phase: 'idle', generation: this.generation });
    return this.generation;
  }

  private bindVideo(video: HTMLVideoElement) {
    if (this.video === video) return;
    this.videoListeners?.abort();
    this.videoListeners = null;
    this.invalidate();
    this.video = video;
    const listeners = new AbortController();
    this.videoListeners = listeners;
    const signal = listeners.signal;
    video.addEventListener('timeupdate', () => this.enforceBoundary('media-event'), { signal });
    video.addEventListener('play', () => {
      // An explicit native play cancels the wait. Automatic next-sentence play
      // has already entered `playing` before firing this event.
      if (this.stateValue.mode === 'shadowing' && this.stateValue.phase === 'waiting') this.invalidate('auto');
      this.startBrakePoller();
    }, { signal });
    video.addEventListener('playing', () => this.startBrakePoller(), { signal });
    video.addEventListener('pause', () => this.clearBrakePoller(), { signal });
    video.addEventListener('seeking', () => this.clearBrakePoller(), { signal });
    video.addEventListener('seeked', () => this.startBrakePoller(), { signal });
    video.addEventListener('ratechange', () => this.startBrakePoller(), { signal });
    video.addEventListener('emptied', () => this.invalidate(), { signal });
    video.addEventListener('ended', () => this.enforceBoundary('media-event'), { signal });
  }

  private currentVideo() {
    const video = this.options.getVideo();
    if (!video) return null;
    this.bindVideo(video);
    return video;
  }

  private operationCurrent(token: number, owner: Owner, video: HTMLVideoElement) {
    return token === this.generation && this.owner === owner && this.video === video && this.options.ownerActive(owner);
  }

  private waitForSeek(video: HTMLVideoElement, token: number, owner: Owner) {
    this.seekListener?.abort();
    const listener = new AbortController();
    this.seekListener = listener;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!listener.signal.aborted) listener.abort();
        if (this.seekListener === listener) this.seekListener = null;
        if (error) reject(error); else resolve();
      };
      const timeout = setTimeout(() => finish(new Error('播放器精准定位超时')), SEEK_TIMEOUT_MS);
      listener.signal.addEventListener('abort', () => finish(new Error('定位请求已失效')), { once: true });
      video.addEventListener('seeked', () => finish(), { once: true, signal: listener.signal });
      video.addEventListener('error', () => finish(new Error('播放器定位期间发生媒体错误')), { once: true, signal: listener.signal });
      Promise.resolve().then(() => {
        if (!this.operationCurrent(token, owner, video)) finish(new Error('定位请求已失效'));
        else if (!video.seeking) finish();
      });
    });
  }

  private async preciseSeek(video: HTMLVideoElement, targetMs: number, token: number, owner: Owner): Promise<PreciseSeekResult> {
    let actualMs = video.currentTime * 1000;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.operationCurrent(token, owner, video)) throw new Error('定位请求已失效');
      const completion = this.waitForSeek(video, token, owner);
      video.currentTime = targetMs / 1000;
      await completion;
      if (!this.operationCurrent(token, owner, video)) throw new Error('定位请求已失效');
      actualMs = video.currentTime * 1000;
      if (Number.isFinite(actualMs) && Math.abs(actualMs - targetMs) <= SEEK_TOLERANCE_MS) {
        return { requestedMs: targetMs, actualMs, errorMs: actualMs - targetMs };
      }
    }
    throw new Error(`播放器实际落点偏差过大：目标 ${(targetMs / 1000).toFixed(3)} 秒，实际 ${(actualMs / 1000).toFixed(3)} 秒`);
  }

  async seek(owner: Owner, segment: PlaybackBoundary, queue: PlaybackBoundary[], mode: PlayMode): Promise<PreciseSeekResult> {
    if (!validBoundary(segment)) throw new Error('播放语句时间无效');
    const video = this.currentVideo();
    if (!video || video.readyState === 0 || !Number.isFinite(video.duration)) throw new Error('播放器尚未准备好定位');
    const bounded = { startMs: segment.startMs, endMs: Math.min(segment.endMs, video.duration * 1000) };
    if (!validBoundary(bounded) || bounded.startMs >= video.duration * 1000) throw new Error('条目时间超出当前视频，未执行定位');
    const boundedQueue = queue.filter(validBoundary).map(item => ({ startMs: item.startMs, endMs: Math.min(item.endMs, video.duration * 1000) }))
      .filter(item => validBoundary(item) && item.endMs > bounded.endMs);
    const token = this.invalidate(mode);
    this.owner = owner;
    if (mode !== 'auto') this.emit({ mode, phase: 'seeking', generation: token, segment: bounded, queue: boundedQueue });
    video.pause();
    const result = await this.preciseSeek(video, bounded.startMs, token, owner);
    if (!this.operationCurrent(token, owner, video)) throw new Error('定位请求已失效');
    if (mode !== 'auto') this.emit({ mode, phase: 'playing', generation: token, segment: bounded, queue: boundedQueue });
    try { await video.play(); }
    catch (error) { if (this.operationCurrent(token, owner, video)) this.invalidate(mode); throw error; }
    if (this.operationCurrent(token, owner, video)) this.startBrakePoller();
    return result;
  }

  async arm(owner: Owner, segment: PlaybackBoundary, queue: PlaybackBoundary[], mode: ActivePlayMode) {
    if (!validBoundary(segment)) return false;
    const video = this.currentVideo();
    if (!video || video.readyState === 0 || !Number.isFinite(video.duration)) return false;
    const bounded = { startMs: segment.startMs, endMs: Math.min(segment.endMs, video.duration * 1000) };
    if (!validBoundary(bounded)) return false;
    const boundedQueue = queue.filter(validBoundary).map(item => ({ startMs: item.startMs, endMs: Math.min(item.endMs, video.duration * 1000) }))
      .filter(item => validBoundary(item) && item.endMs > bounded.endMs);
    const token = this.invalidate(mode);
    this.owner = owner;
    this.emit({ mode, phase: 'playing', generation: token, segment: bounded, queue: boundedQueue });
    if (video.currentTime * 1000 >= bounded.endMs - this.brakeLeadMs()) {
      this.enforceBoundary('arm');
      return true;
    }
    if (video.paused) {
      try { await video.play(); }
      catch (error) { if (this.operationCurrent(token, owner, video)) this.invalidate(mode); throw error; }
    }
    if (this.operationCurrent(token, owner, video)) this.startBrakePoller();
    return true;
  }

  async setMode(mode: PlayMode, _owner: Owner) {
    const video = this.currentVideo();
    const resume = mode === 'auto' && this.stateValue.mode !== 'auto' && !!video?.paused;
    this.invalidate(mode);
    if (resume && video) await video.play();
  }

  async toggle(_owner: Owner) {
    const video = this.currentVideo();
    if (!video || video.readyState === 0) return;
    if (video.paused) {
      // Resume from the actual media position in continuous mode. Invalidate
      // old sentence boundaries before calling play().
      this.invalidate('auto');
      await video.play();
    } else {
      video.pause();
      // A pause must work on the first press in every mode, and stay paused.
      this.invalidate();
    }
  }

  async togglePractice(_owner: Owner) {
    const video = this.currentVideo();
    if (!video || video.readyState === 0) return;
    const current = this.stateValue;
    if (current.mode === 'practice' && current.phase !== 'idle') {
      if (!video.paused) { this.pause(_owner); return; }
      if (video.currentTime * 1000 >= current.segment.endMs - this.brakeLeadMs()
        || video.currentTime * 1000 < current.segment.startMs) {
        await this.seek(_owner, current.segment, current.queue, 'practice');
      } else {
        this.emit({ ...current, phase: 'playing' }); await video.play(); this.startBrakePoller();
      }
      return;
    }
    // Recording controls never take over the independent sentence-pause mode.
  }

  pause(owner: Owner) {
    const video = this.currentVideo();
    if (!video || (this.owner !== null && this.owner !== owner)) return;
    // Preserve the active practice range when recording or pausing midway.
    const current = this.stateValue;
    if ((current.mode === 'shadowing' || current.mode === 'practice') && current.phase !== 'idle') {
      const generation = this.invalidate(current.mode);
      this.owner = owner;
      this.emit({ ...current, generation });
    }
    video.pause(); this.clearBrakePoller();
  }

  cancelCapture(owner: Owner) {
    if (this.owner === owner) this.captureAbort?.abort();
  }

  async capture(owner: Owner, segment: PlaybackBoundary) {
    const video = this.currentVideo();
    if (!video || !validBoundary(segment) || segment.endMs - segment.startMs > 60_000
      || segment.endMs > video.duration * 1000) throw new Error('原声片段无效或超过 60 秒');
    const previous = this.stateValue, oldTime = video.currentTime, oldRate = video.playbackRate, wasPlaying = !video.paused;
    const token = this.invalidate(previous.mode); this.owner = owner;
    const abort = new AbortController(); this.captureAbort = abort;
    let capturing = false;
    const userSeek = () => { if (capturing && this.operationCurrent(token, owner, video)) this.invalidate(previous.mode); };
    abort.signal.addEventListener('abort', () => { video.pause(); video.playbackRate = oldRate; }, { once: true });
    video.pause(); video.playbackRate = 1;
    try {
      await this.preciseSeek(video, segment.startMs, token, owner);
      if (abort.signal.aborted) throw new Error('原声采集已取消');
      capturing = true; video.addEventListener('seeking', userSeek);
      return await captureVideoAudio(video, segment.endMs, abort.signal);
    } finally {
      capturing = false; video.removeEventListener('seeking', userSeek);
      // A new seek, video session or disconnected panel owns the player now.
      // Never let this old capture restore its position over that operation.
      if (this.operationCurrent(token, owner, video)) {
        this.captureAbort = null; video.pause(); video.playbackRate = oldRate;
        await this.preciseSeek(video, oldTime * 1000, token, owner);
        if (this.operationCurrent(token, owner, video)) {
          this.emit({ ...previous, generation: token });
          if (wasPlaying) { await video.play(); this.startBrakePoller(); }
        }
      }
    }
  }

  private startBrakePoller() {
    this.clearBrakePoller();
    const current = this.stateValue;
    const video = this.video;
    if (!video || video.paused || !this.owner
      || !this.options.ownerActive(this.owner)) return;
    if (current.mode === 'auto' || current.phase !== 'playing' || video.paused) return;
    const token = current.generation;
    this.brakePollTicks = 0;
    this.brakePoller = setInterval(() => {
      if (this.stateValue.generation !== token || this.stateValue.phase !== 'playing') {
        this.clearBrakePoller();
        return;
      }
      this.brakePollTicks++;
      this.enforceBoundary('poller');
    }, BRAKE_POLL_INTERVAL_MS);
  }

  private scheduleShadowing(waiting: ShadowingWait, owner: Owner) {
    this.clearShadowingTimer();
    if (!waiting.queue.length || this.stateValue !== waiting) return;
    // Use the subtitle's media duration, independent of playback speed. Keep
    // the end frame visible while the learner speaks; seek only when due.
    this.shadowingTimer = setTimeout(() => {
      this.shadowingTimer = null;
      if (this.stateValue !== waiting) return;
      if (performance.now() < waiting.resumeAtMs) { this.scheduleShadowing(waiting, owner); return; }
      void this.resumeShadowing(waiting, owner);
    }, Math.max(1, waiting.resumeAtMs - performance.now()));
  }

  private async resumeShadowing(waiting: ShadowingWait, owner: Owner) {
    const video = this.video, next = waiting.queue[0];
    if (!video || !next || this.stateValue !== waiting || this.options.getVideo() !== video
      || !this.operationCurrent(waiting.generation, owner, video)) return;
    const state = { mode: 'shadowing' as const, generation: waiting.generation, segment: next, queue: waiting.queue.slice(1) };
    this.emit({ ...state, phase: 'seeking' });
    try {
      await this.preciseSeek(video, next.startMs, waiting.generation, owner);
      if (this.options.getVideo() !== video || !this.operationCurrent(waiting.generation, owner, video)) return;
      this.emit({ ...state, phase: 'playing' });
      await video.play();
      if (this.operationCurrent(waiting.generation, owner, video)) this.startBrakePoller();
    } catch {
      if (this.operationCurrent(waiting.generation, owner, video)) this.invalidate('shadowing');
    }
  }

  enforceBoundary(trigger: BrakeTrigger = 'media-event') {
    const current = this.stateValue;
    const video = this.video;
    const owner = this.owner;
    if (!video || !owner || current.mode === 'auto' || current.phase !== 'playing' || !this.options.ownerActive(owner)) return;
    const detectedMs = video.currentTime * 1000;
    // === 逐句暂停拦截 START ===
    const isShadowingMode = current.mode === 'shadowing';
    const leadMs = isShadowingMode && trigger !== 'arm' ? 50 : this.brakeLeadMs();
    if (detectedMs < current.segment.endMs - leadMs) return;
    const errors = { boundaryDetectedErrorMs: detectedMs - current.segment.endMs, boundaryErrorMs: detectedMs - current.segment.endMs };
    const waitDurationMs = current.segment.endMs - current.segment.startMs;
    const waiting: PlaybackMachineState = current.mode === 'shadowing'
      ? { ...current, ...errors, phase: 'waiting', waitDurationMs, resumeAtMs: performance.now() + waitDurationMs }
      : { ...current, ...errors, phase: 'waiting' };
    // Change phase before pause() can emit another timeupdate, so one sentence
    // owns exactly one pause and one timer without mutating the subtitle data.
    this.stateValue = waiting;
    const pollTicks = this.brakePollTicks;
    // Destroy the high-frequency poller before pause() can synchronously emit
    // events can attempt a second boundary check. This keeps one owner and
    // one interval per bounded playback generation.
    this.clearBrakePoller();
    try { this.options.pauseAtBoundary?.(video); } catch { /* Element-level pause below remains authoritative. */ }
    video.pause();
    const pausedMs = video.currentTime * 1000;
    // The lead brake intentionally stops up to 30ms early. Calibrate the static
    // frame to endMs in both directions; this also forcibly rolls back every
    // overshoot above the requested 10ms threshold.
    if (Math.abs(pausedMs - current.segment.endMs) > .5) video.currentTime = current.segment.endMs / 1000;
    const actualMs = video.currentTime * 1000;
    const boundaryErrorMs = actualMs - current.segment.endMs;
    const boundaryDetectedErrorMs = detectedMs - current.segment.endMs;
    this.options.onBrake?.(owner, {
      mode: current.mode,
      segment: current.segment,
      trigger,
      pollIntervalMs: BRAKE_POLL_INTERVAL_MS,
      leadMs,
      pollTicks,
      detectedMs,
      pausedMs,
      actualMs,
      driftMs: boundaryErrorMs,
    });
    if (this.stateValue !== waiting || !this.operationCurrent(current.generation, owner, video)) return;
    const paused = { ...waiting, boundaryDetectedErrorMs, boundaryErrorMs };
    this.emit(paused);
    if (paused.mode === 'shadowing') this.scheduleShadowing(paused, owner);
    if (isShadowingMode) console.log('[SHADOWING_PAUSE_SUCCESS]', {
      start: current.segment.startMs / 1000, time: video.currentTime, end: current.segment.endMs / 1000,
    });
    // === 逐句暂停拦截 END ===
  }

  clear(mode: PlayMode = this.mode) { this.invalidate(mode); }

  destroy() {
    this.invalidate();
    this.videoListeners?.abort();
    this.videoListeners = null;
    this.video = null;
  }
}
