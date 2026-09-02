import assert from 'node:assert/strict';
import test from 'node:test';
import { BRAKE_LEAD_MS, BRAKE_POLL_INTERVAL_MS, BRAKE_PRECISION_MS, PrecisePlaybackController,
  type BrakeReport } from '../lib/playback-machine.ts';

class FakeVideo extends EventTarget {
  readyState = 4;
  duration = 60;
  paused = true;
  playbackRate = 1;
  seeking = false;
  plays = 0;
  pauses = 0;
  seekOffsetSeconds = 0;
  private time = 0;

  get currentTime() { return this.time; }
  set currentTime(value: number) {
    this.seeking = true;
    this.time = value + this.seekOffsetSeconds;
    queueMicrotask(() => { this.seeking = false; this.dispatchEvent(new Event('seeked')); });
  }

  async play() { this.plays++; this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
  pause() { this.pauses++; this.paused = true; this.dispatchEvent(new Event('pause')); }
  setClock(seconds: number) { this.time = seconds; }
  moveTo(seconds: number) { this.time = seconds; this.dispatchEvent(new Event('timeupdate')); }
}

function controller(videoRef: { current: FakeVideo }, active = new Set(['panel']),
  onShadowingCycle?: ConstructorParameters<typeof PrecisePlaybackController<string>>[0]['onShadowingCycle'],
  onBrake?: ConstructorParameters<typeof PrecisePlaybackController<string>>[0]['onBrake']) {
  return new PrecisePlaybackController<string>({
    getVideo: () => videoRef.current as unknown as HTMLVideoElement,
    ownerActive: owner => active.has(owner),
    onShadowingCycle,
    onBrake,
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`condition was not met within ${timeoutMs}ms`);
}

test('manual uses one fixed 12ms poller, pre-brakes at 30ms, and calibrates within 20ms without a media event', async t => {
  const videoRef = { current: new FakeVideo() };
  let brake: BrakeReport | undefined;
  const playback = controller(videoRef, new Set(['panel']), undefined, (_owner, report) => { brake = report; });
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual');
  assert.equal(playback.brakePollerActive, true);
  assert.ok(BRAKE_POLL_INTERVAL_MS >= 10 && BRAKE_POLL_INTERVAL_MS <= 15);
  assert.equal(BRAKE_LEAD_MS, 30);

  videoRef.current.setClock(1.969);
  await new Promise(resolve => setTimeout(resolve, BRAKE_POLL_INTERVAL_MS * 2 + 5));
  assert.equal(videoRef.current.paused, false, 'must not brake before the 30ms lead threshold');
  videoRef.current.setClock(1.970);
  await waitUntil(() => videoRef.current.paused);

  assert.ok(brake);
  assert.equal(brake.trigger, 'poller');
  assert.equal(brake.pollIntervalMs, 12);
  assert.equal(brake.leadMs, 30);
  assert.ok(brake.pollTicks > 0);
  assert.ok(Math.abs(videoRef.current.currentTime * 1000 - 2_000) <= BRAKE_PRECISION_MS);
  assert.ok(Math.abs(brake.driftMs) <= BRAKE_PRECISION_MS);
  assert.equal(playback.brakePollerActive, false);
});

test('a platform-specific lead brakes at 250ms and invokes its native pause hook before the element fallback', async t => {
  const videoRef = { current: new FakeVideo() };
  let nativePauses = 0;
  let brake: BrakeReport | undefined;
  const playback = new PrecisePlaybackController<string>({
    getVideo: () => videoRef.current as unknown as HTMLVideoElement,
    ownerActive: owner => owner === 'panel',
    brakeLeadMs: 250,
    pauseAtBoundary: () => { nativePauses++; },
    onBrake: (_owner, report) => { brake = report; },
  });
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual');

  videoRef.current.setClock(1.749);
  await new Promise(resolve => setTimeout(resolve, BRAKE_POLL_INTERVAL_MS * 2 + 5));
  assert.equal(videoRef.current.paused, false, 'must not brake before the configured 250ms threshold');
  videoRef.current.setClock(1.750);
  await waitUntil(() => videoRef.current.paused);

  assert.equal(nativePauses, 1);
  assert.equal(videoRef.current.pauses, 2, 'seek pause plus boundary element pause');
  assert.ok(brake); assert.equal(brake.leadMs, 250);
  assert.equal(videoRef.current.currentTime, 2);
  assert.equal(playback.brakePollerActive, false);
});

test('manual seek waits for seek completion, pauses exactly at the end, and never auto-advances', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  const result = await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [{ startMs: 3_000, endMs: 4_000 }], 'manual');
  assert.deepEqual(result, { requestedMs: 1_000, actualMs: 1_000, errorMs: 0 });
  assert.equal(playback.state.mode, 'manual'); assert.equal(playback.state.phase, 'playing');
  videoRef.current.moveTo(2.031);
  assert.equal(videoRef.current.paused, true); assert.equal(videoRef.current.currentTime, 2);
  assert.equal(playback.state.phase, 'waiting');
  const plays = videoRef.current.plays;
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(videoRef.current.plays, plays); assert.equal(videoRef.current.currentTime, 2);
  playback.destroy();
});

test('play from a manual boundary atomically switches to auto without consuming the queue', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [{ startMs: 3_000, endMs: 4_000 }], 'manual');
  videoRef.current.moveTo(2);
  await playback.toggle('panel');
  assert.equal(videoRef.current.currentTime, 2); assert.equal(videoRef.current.paused, false);
  assert.equal(playback.state.mode, 'auto'); assert.equal(playback.state.phase, 'idle');
  playback.destroy();
});

test('play while a manual sentence is already playing switches to auto and does not pause it', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual');
  const plays = videoRef.current.plays;
  await playback.toggle('panel');
  assert.equal(playback.mode, 'auto'); assert.equal(videoRef.current.paused, false);
  assert.equal(videoRef.current.plays, plays);
  playback.destroy();
});

test('shadowing pauses at the exact boundary, waits one phrase duration, then plays the next phrase', async t => {
  const videoRef = { current: new FakeVideo() };
  let cycle: Parameters<NonNullable<ConstructorParameters<typeof PrecisePlaybackController<string>>[0]['onShadowingCycle']>>[1] | undefined;
  let brake: BrakeReport | undefined;
  const playback = controller(videoRef, new Set(['panel']), (_owner, report) => { cycle = report; },
    (_owner, report) => { brake = report; });
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 1_060 }, [{ startMs: 2_000, endMs: 2_080 }], 'shadowing');
  videoRef.current.setClock(1.031);
  await waitUntil(() => videoRef.current.paused);
  assert.equal(videoRef.current.paused, true);
  assert.ok(brake); assert.equal(brake.actualMs, 1_060);
  assert.equal(playback.state.mode, 'shadowing'); assert.equal(playback.state.phase, 'waiting');
  assert.equal(playback.state.waitDurationMs, 60);
  assert.equal(playback.brakePollerActive, false, 'the brake poller must be destroyed before the silence timer starts');
  assert.equal(brake.trigger, 'poller'); assert.ok(Math.abs(brake.driftMs) <= BRAKE_PRECISION_MS);
  for (let attempt = 0; attempt < 30 && !cycle; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(cycle); assert.equal(cycle.expectedWaitMs, 60);
  assert.ok(Math.abs(cycle.actualWaitMs - 60) <= 30, `actual wait ${cycle.actualWaitMs}ms`);
  assert.equal(cycle.boundaryErrorMs, 0);
  assert.equal(videoRef.current.currentTime, 2); assert.equal(videoRef.current.paused, false);
  assert.equal(playback.state.mode, 'shadowing'); assert.equal(playback.state.phase, 'playing');
  assert.equal(playback.brakePollerActive, true, 'the next phrase owns one fresh brake poller');
});

test('play during shadowing silence cancels the old resume timer and switches to auto', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  await playback.seek('panel', { startMs: 1_000, endMs: 1_080 }, [{ startMs: 2_000, endMs: 2_080 }], 'shadowing');
  videoRef.current.moveTo(1.08);
  await playback.toggle('panel');
  assert.equal(playback.mode, 'auto'); assert.equal(videoRef.current.paused, false);
  const plays = videoRef.current.plays;
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(videoRef.current.currentTime, 2, 'the next phrase was prepared during the silence window');
  assert.equal(videoRef.current.plays, plays, 'stale shadowing timer must not play again');
  playback.destroy();
});

test('auto mode ignores sentence ends while manual navigation owns the boundary', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'auto');
  videoRef.current.moveTo(2.5);
  assert.equal(videoRef.current.paused, false); assert.equal(playback.mode, 'auto');
  playback.destroy();
});

test('replacing the media element destroys old listeners before binding the new player', async () => {
  const first = new FakeVideo();
  const videoRef = { current: first };
  const playback = controller(videoRef);
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual');
  const second = new FakeVideo(); videoRef.current = second;
  await playback.seek('panel', { startMs: 5_000, endMs: 6_000 }, [], 'manual');
  first.moveTo(2.5);
  assert.equal(second.paused, false); assert.equal(second.currentTime, 5);
  assert.equal(playback.state.phase, 'playing');
  playback.destroy();
});

test('a seek outside the precision tolerance is retried once and rejected without playback', async () => {
  const video = new FakeVideo(); video.seekOffsetSeconds = .2;
  const videoRef = { current: video };
  const playback = controller(videoRef);
  await assert.rejects(playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual'), /偏差过大/);
  assert.equal(video.plays, 0);
  playback.destroy();
});

test('a replacement seek aborts the old seek listener immediately', async () => {
  const videoRef = { current: new FakeVideo() };
  const playback = controller(videoRef);
  const first = playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'manual');
  const second = playback.seek('panel', { startMs: 3_000, endMs: 4_000 }, [], 'manual');
  await assert.rejects(first, /失效/);
  assert.deepEqual(await second, { requestedMs: 3_000, actualMs: 3_000, errorMs: 0 });
  playback.destroy();
});
