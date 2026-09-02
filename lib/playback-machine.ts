import type { PlayMode } from './protocol.ts';

export type PlaybackBoundary = { startMs: number; endMs: number };
type ActivePlayMode = Exclude<PlayMode, 'auto'>;

export type PlaybackMachineState =
  | { mode: PlayMode; phase: 'idle'; generation: number }
  | { mode: 'manual'; phase: 'seeking' | 'playing'; generation: number;
      segment: PlaybackBoundary; queue: PlaybackBoundary[] }
  | { mode: 'shadowing'; phase: 'seeking' | 'playing'; generation: number;
      segment: PlaybackBoundary; queue: PlaybackBoundary[] }
  | { mode: 'manual'; phase: 'waiting'; generation: number; segment: PlaybackBoundary;
      queue: PlaybackBoundary[]; boundaryDetectedErrorMs: number; boundaryErrorMs: number }
  | { mode: 'shadowing'; phase: 'waiting'; generation: number; segment: PlaybackBoundary;
      queue: PlaybackBoundary[]; boundaryDetectedErrorMs: number; boundaryErrorMs: number;
      waitDurationMs: number; waitingStartedAtMs: number; resumeAtMs: number };

export type PreciseSeekResult = { requestedMs: number; actualMs: number; errorMs: number };
export type ShadowingCycleReport = {
  segment: PlaybackBoundary;
  next: PlaybackBoundary;
  expectedWaitMs: number;
  actualWaitMs: number;
  waitErrorMs: number;
  boundaryDetectedErrorMs: number;
  boundaryErrorMs: number;
};

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
  onShadowingCycle?: (owner: Owner, report: ShadowingCycleReport) => void;
  now?: () => number;
};

type ShadowingPreparation = Promise<{ result: PreciseSeekResult } | { error: unknown }>;

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
  private shadowingTimer: ReturnType<typeof setTimeout> | null = null;
  private shadowingPreparation: ShadowingPreparation | null = null;

  constructor(options: ControllerOptions<Owner>) { this.options = options; }

  get state() { return this.stateValue; }
  get mode(): PlayMode { return this.stateValue.mode; }
  get brakePollerActive() { return this.brakePoller !== null; }
  owns(owner: Owner) { return this.owner === owner; }

  private now() {
    return this.options.now?.() ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

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
    this.shadowingPreparation = null;
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
    video.addEventListener('play', () => this.startBrakePoller(), { signal });
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
      .filter(validBoundary);
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
      .filter(validBoundary);
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
    if (this.stateValue.mode !== 'auto') {
      // The play control is the single, atomic escape hatch from every bounded
      // mode. It must never consume a queued phrase or pause an already-playing
      // manual/shadowing segment.
      this.invalidate('auto');
      if (video.paused) await video.play();
      return;
    }
    if (video.paused) await video.play();
    else video.pause();
  }

  private startBrakePoller() {
    this.clearBrakePoller();
    const current = this.stateValue;
    const video = this.video;
    if (!video || current.mode === 'auto' || current.phase !== 'playing' || video.paused || !this.owner
      || !this.options.ownerActive(this.owner)) return;
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

  private async resumeShadowing(owner: Owner, waiting: Extract<PlaybackMachineState, { mode: 'shadowing'; phase: 'waiting' }>) {
    if (this.stateValue !== waiting || this.owner !== owner || !this.options.ownerActive(owner)) return;
    const next = waiting.queue[0];
    const video = this.video;
    const preparation = this.shadowingPreparation;
    if (!next || !video || !preparation) return;
    try {
      const prepared = await preparation;
      if (this.stateValue !== waiting || this.owner !== owner || this.video !== video || !this.options.ownerActive(owner)) return;
      if ('error' in prepared) throw prepared.error;
      this.shadowingPreparation = null;
      const actualWaitMs = this.now() - waiting.waitingStartedAtMs;
      const playPromise = video.play();
      this.emit({ mode: 'shadowing', phase: 'playing', generation: waiting.generation,
        segment: next, queue: waiting.queue.slice(1) });
      await playPromise;
      this.options.onShadowingCycle?.(owner, {
        segment: waiting.segment,
        next,
        expectedWaitMs: waiting.waitDurationMs,
        actualWaitMs,
        waitErrorMs: actualWaitMs - waiting.waitDurationMs,
        boundaryDetectedErrorMs: waiting.boundaryDetectedErrorMs,
        boundaryErrorMs: waiting.boundaryErrorMs,
      });
      if (this.operationCurrent(waiting.generation, owner, video)) this.startBrakePoller();
    } catch (error) {
      // A new user action, SPA navigation, or detached port deliberately
      // invalidates the pending cycle. A genuine media failure leaves the
      // controller idle instead of retaining a stale sentence boundary.
      if (this.owner === owner && this.stateValue.generation === waiting.generation) this.invalidate('shadowing');
    }
  }

  enforceBoundary(trigger: BrakeTrigger = 'media-event') {
    const current = this.stateValue;
    const video = this.video;
    const owner = this.owner;
    if (!video || !owner || current.mode === 'auto' || current.phase !== 'playing' || !this.options.ownerActive(owner)) return;
    const detectedMs = video.currentTime * 1000;
    const leadMs = this.brakeLeadMs();
    if (detectedMs < current.segment.endMs - leadMs) return;
    const pollTicks = this.brakePollTicks;
    // Destroy the high-frequency poller before pause() can synchronously emit
    // events or Shadowing starts its silence timer. This keeps one owner and
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
    if (current.mode === 'manual') {
      this.emit({ ...current, phase: 'waiting', boundaryDetectedErrorMs, boundaryErrorMs });
      return;
    }
    const waitDurationMs = current.segment.endMs - current.segment.startMs;
    const waitingStartedAtMs = this.now();
    const waiting: Extract<PlaybackMachineState, { mode: 'shadowing'; phase: 'waiting' }> = {
      ...current,
      phase: 'waiting',
      boundaryDetectedErrorMs,
      boundaryErrorMs,
      waitDurationMs,
      waitingStartedAtMs,
      resumeAtMs: waitingStartedAtMs + waitDurationMs,
    };
    this.emit(waiting);
    const next = waiting.queue[0];
    if (!next) return;
    // Seek while the learner is speaking so that buffering cannot lengthen the
    // requested silent interval. The media remains paused; play() is called by
    // the deadline timer below.
    this.shadowingPreparation = Promise.resolve()
      .then(() => this.preciseSeek(video, next.startMs, current.generation, owner))
      .then(result => ({ result }), error => ({ error }));
    this.shadowingTimer = setTimeout(() => {
      this.shadowingTimer = null;
      void this.resumeShadowing(owner, waiting);
    }, waitDurationMs);
  }

  clear(mode: PlayMode = this.mode) { this.invalidate(mode); }

  destroy() {
    this.invalidate();
    this.videoListeners?.abort();
    this.videoListeners = null;
    this.video = null;
  }
}
