import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { captureVideoAudio } from '../lib/capture-audio.ts';

function fixture(t: TestContext) {
  const track = { stopped: false, stop() { this.stopped = true; } };
  class Stream {
    tracks: typeof track[];
    constructor(tracks = [track]) { this.tracks = tracks; }
    getAudioTracks() { return this.tracks; }
    getTracks() { return this.tracks; }
  }
  let recorder: Recorder;
  class Recorder {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/webm';
    onstop?: () => void; ondataavailable?: (event: { data: Blob }) => void;
    constructor() { recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    flush() { this.ondataavailable?.({ data: new Blob(['captured-audio']) }); this.onstop?.(); }
  }
  for (const [name, value] of Object.entries({ MediaStream: Stream, MediaRecorder: Recorder })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  const video = { currentTime: 5, seeking: false, ended: false, mediaKeys: null, captureStream: () => new Stream(), play: async () => {} };
  return { track, video, recorder: () => recorder! };
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  assert.fail('capture did not reach the expected state');
}

test('original capture completes a nonzero segment and releases its tracks', async t => {
  const f = fixture(t), abort = new AbortController();
  const promise = captureVideoAudio(f.video as unknown as HTMLVideoElement, 8_000, abort.signal);
  f.video.currentTime = 8;
  await until(() => f.recorder().state === 'inactive'); f.recorder().flush();
  assert.ok((await promise).size > 0); assert.equal(f.track.stopped, true);
});

test('abort between completion poll and recorder stop cannot return partial audio as success', async t => {
  const f = fixture(t), abort = new AbortController();
  const promise = captureVideoAudio(f.video as unknown as HTMLVideoElement, 8_000, abort.signal);
  const rejected = assert.rejects(promise, /原声采集已取消/);
  f.video.currentTime = 8;
  await until(() => f.recorder().state === 'inactive');
  abort.abort(); f.recorder().flush(); await rejected;
  assert.equal(f.track.stopped, true);
});

test('a seek beyond the end is not mistaken for a completed recording', async t => {
  const f = fixture(t), abort = new AbortController();
  const promise = captureVideoAudio(f.video as unknown as HTMLVideoElement, 8_000, abort.signal);
  const rejected = assert.rejects(promise, /原声采集已取消/);
  f.video.seeking = true; f.video.currentTime = 12;
  await new Promise(resolve => setTimeout(resolve, 45));
  const duringSeek = f.recorder().state;
  abort.abort(); f.recorder().flush(); await rejected;
  assert.equal(duringSeek, 'recording'); assert.equal(f.track.stopped, true);
});
