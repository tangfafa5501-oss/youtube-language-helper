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
  onBrake?: ConstructorParameters<typeof PrecisePlaybackController<string>>[0]['onBrake']) {
  return new PrecisePlaybackController<string>({
    getVideo: () => videoRef.current as unknown as HTMLVideoElement,
    ownerActive: owner => active.has(owner),
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
  const playback = controller(videoRef, new Set(['panel']), (_owner, report) => { brake = report; });
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

for (const mode of ['auto', 'manual', 'shadowing', 'practice'] as const) {
  test(`Space pauses ${mode} playback once, then resumes in auto without seeking`, async t => {
    const videoRef = { current: new FakeVideo() };
    const playback = controller(videoRef);
    t.after(() => playback.destroy());
    await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [{ startMs: 3_000, endMs: 4_000 }], mode);
    videoRef.current.moveTo(1.3);
    const plays = videoRef.current.plays, pauses = videoRef.current.pauses;

    await playback.toggle('panel');
    assert.equal(videoRef.current.paused, true, 'one press must pause even in a bounded mode');
    assert.equal(videoRef.current.pauses, pauses + 1);
    assert.equal(videoRef.current.plays, plays);
    assert.equal(playback.brakePollerActive, false);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(videoRef.current.paused, true, 'a cancelled learning cycle must not resume playback');
    assert.equal(videoRef.current.currentTime, 1.3);

    await playback.toggle('panel');
    assert.equal(videoRef.current.paused, false);
    assert.equal(videoRef.current.plays, plays + 1);
    assert.equal(playback.mode, 'auto');
    assert.equal(videoRef.current.currentTime, 1.3, 'resume from the paused position, not a subtitle start');
    videoRef.current.moveTo(2.1);
    assert.equal(videoRef.current.paused, false, 'auto playback must pass the old sentence boundary');
    await playback.toggle('panel');
    assert.equal(videoRef.current.paused, true);
  });
}

test('Space during a shadowing wait cancels the timer and resumes continuous playback', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  const segment = { startMs: 1_000, endMs: 1_160 };
  await playback.seek('panel', segment, [{ startMs: 3_000, endMs: 4_000 }], 'shadowing');
  videoRef.current.moveTo(1.16);
  await playback.toggle('panel');
  assert.equal(playback.mode, 'auto');
  assert.equal(videoRef.current.currentTime, 1.16, 'play must not replay or skip to another sentence');
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(videoRef.current.paused, false);
  assert.equal(videoRef.current.currentTime, 1.16, 'the cancelled timer must not seek later');
});

test('native play during a shadowing wait cancels the pending automatic next sentence', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 1_160 }, [{ startMs: 2_000, endMs: 3_000 }], 'shadowing');
  videoRef.current.moveTo(1.16);
  await videoRef.current.play();
  assert.equal(videoRef.current.paused, false);
  assert.equal(playback.mode, 'auto');
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.equal(videoRef.current.currentTime, 1.16);
  assert.equal(playback.brakePollerActive, false);
});

test('shadowing waits each sentence duration then automatically plays the next, for two unequal cycles', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  const sentences = [{ startMs: 1_000, endMs: 1_160 }, { startMs: 2_000, endMs: 2_240 }, { startMs: 3_000, endMs: 3_120 }];
  videoRef.current.playbackRate = 1.5;
  await playback.seek('panel', sentences[0], sentences.slice(1), 'shadowing');
  for (const [index, duration] of [160, 240].entries()) {
    const start = performance.now(), plays = videoRef.current.plays;
    videoRef.current.moveTo(sentences[index].endMs / 1000);
    for (let repeat = 0; repeat < 4; repeat++) videoRef.current.dispatchEvent(new Event('timeupdate'));
    assert.equal(videoRef.current.paused, true);
    assert.equal(playback.state.phase, 'waiting');
    await new Promise(resolve => setTimeout(resolve, duration / 2));
    assert.equal(videoRef.current.paused, true, 'do not shorten the pause at 1.5x playback rate');
    assert.equal(videoRef.current.currentTime, sentences[index].endMs / 1000, 'keep the paused sentence on screen');
    await waitUntil(() => !videoRef.current.paused, 1_000);
    assert.ok(performance.now() - start >= duration - 2, 'pause must last the full sentence duration');
    assert.equal(videoRef.current.plays, plays + 1, 'repeated timeupdate must schedule only one next sentence');
    assert.equal(videoRef.current.currentTime, sentences[index + 1].startMs / 1000);
    assert.equal(playback.mode, 'shadowing'); assert.equal(playback.state.phase, 'playing');
  }
  videoRef.current.moveTo(3.12);
  const plays = videoRef.current.plays;
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(videoRef.current.paused, true, 'the last sentence has no next item to play');
  assert.equal(videoRef.current.plays, plays);
});

for (const action of ['mode', 'seek', 'recording', 'disconnect', 'destroy', 'replace-video'] as const) {
  test(`shadowing waiting is cancelled safely by ${action}`, async t => {
    const active = new Set(['panel']), videoRef = { current: new FakeVideo() }, playback = controller(videoRef, active);
    t.after(() => playback.destroy());
    const original = videoRef.current;
    await playback.seek('panel', { startMs: 1_000, endMs: 1_160 }, [{ startMs: 2_000, endMs: 3_000 }], 'shadowing');
    original.moveTo(1.16);
    if (action === 'mode') await playback.setMode('auto', 'panel');
    if (action === 'seek') await playback.seek('panel', { startMs: 5_000, endMs: 6_000 }, [], 'manual');
    if (action === 'recording') playback.pause('panel');
    if (action === 'disconnect') active.clear();
    if (action === 'destroy') playback.destroy();
    if (action === 'replace-video') videoRef.current = new FakeVideo();
    const plays = original.plays, time = original.currentTime;
    await new Promise(resolve => setTimeout(resolve, 230));
    assert.equal(original.plays, plays, 'a stale wait must never restart video');
    assert.equal(original.currentTime, time, 'a stale wait must never overwrite a seek');
  });
}

test('recording practice preserves its boundary and resumes in place independently of shadowing', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 2_000 }, [], 'practice');
  videoRef.current.moveTo(1.3); playback.pause('panel');
  assert.equal(videoRef.current.paused, true); assert.equal(playback.mode, 'practice');
  await playback.togglePractice('panel');
  assert.equal(videoRef.current.currentTime, 1.3); assert.equal(videoRef.current.paused, false);
  videoRef.current.moveTo(2.02); assert.equal(videoRef.current.paused, true);
});

test('recording practice has no timed next-sentence cycle and cancels a previous shadowing wait', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 1_160 }, [{ startMs: 3_000, endMs: 4_000 }], 'shadowing');
  videoRef.current.moveTo(1.16);
  await playback.seek('panel', { startMs: 2_000, endMs: 2_160 }, [{ startMs: 3_000, endMs: 4_000 }], 'practice');
  videoRef.current.moveTo(2.16);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(videoRef.current.paused, true); assert.equal(videoRef.current.currentTime, 2.16);
  assert.equal(playback.mode, 'practice'); assert.equal(playback.state.phase, 'waiting');
  await playback.togglePractice('panel');
  assert.equal(videoRef.current.currentTime, 2); assert.equal(videoRef.current.paused, false);
});

test('practice replay cannot take over sentence-only shadowing', async t => {
  const videoRef = { current: new FakeVideo() }, playback = controller(videoRef);
  t.after(() => playback.destroy());
  await playback.seek('panel', { startMs: 1_000, endMs: 1_160 }, [{ startMs: 2_000, endMs: 3_000 }], 'shadowing');
  videoRef.current.moveTo(1.16);
  await playback.togglePractice('panel');
  assert.equal(videoRef.current.currentTime, 1.16); assert.equal(videoRef.current.paused, true);
  await waitUntil(() => !videoRef.current.paused, 500);
  assert.equal(videoRef.current.currentTime, 2); assert.equal(playback.mode, 'shadowing');
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
