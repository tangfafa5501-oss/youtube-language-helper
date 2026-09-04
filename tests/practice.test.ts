import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDictation, livePracticeKey, practiceKey, segmentFromRows } from '../lib/practice.ts';
import { extractPitch, pitchChartData } from '../lib/pitch.ts';
import { createPracticeClient } from '../lib/practice-client.ts';

const segment = { videoId: 'abcdefghijk', session: 'session-a', trackId: 'en', startMs: 1000, endMs: 2000, text: 'I like apples.' };
test('dictation uses word edits, penalizes insertions and never passes empty input', () => {
  assert.equal(checkDictation(segment.text, 'I LIKE apples!').passed, true);
  assert.deepEqual([checkDictation(segment.text, 'I like').accuracy, checkDictation(segment.text, 'I really like apples').accuracy], [67, 75]);
  const changed = checkDictation(segment.text, 'I like pears');
  assert.equal(changed.missed, 1); assert.equal(changed.extra, 1); assert.equal(changed.accuracy, 50);
  assert.equal(checkDictation('', '').passed, false); assert.equal(checkDictation(segment.text, '').passed, false);
  assert.equal(checkDictation("She didn't know.", 'she did not know').passed, false);
});
test('practice history is video/track/text/range isolated while live captures also isolate sessions', () => {
  assert.equal(practiceKey(segment), practiceKey({ ...segment, session: 'new-session' }));
  for (const change of [{ videoId: 'secondvideo' }, { trackId: 'fr' }, { text: 'different text' }, { endMs: 3000 }])
    assert.notEqual(practiceKey(segment), practiceKey({ ...segment, ...change }));
  assert.notEqual(livePracticeKey(segment), livePracticeKey({ ...segment, session: 'new-session' }));
});
test('practice ranges use canonical endpoints, reject reversed/missing/oversized ranges', () => {
  const rows = [{ id: 'a', startMs: 100, endMs: 900, text: 'first' }, { id: 'b', startMs: 850, endMs: 2500, text: 'second' }, { id: 'c', startMs: 80_000, endMs: 90_000, text: 'late' }];
  assert.deepEqual(segmentFromRows(rows, 'a', 'b'), { startMs: 100, endMs: 2500, text: 'first second' });
  assert.equal(segmentFromRows(rows, 'b', 'a'), null); assert.equal(segmentFromRows(rows, 'missing'), null);
  assert.equal(segmentFromRows(rows, 'a', 'c'), null);
});
test('YIN recovers a known sine frequency and leaves silence unvoiced', () => {
  const rate = 16_000, tone = Float32Array.from({ length: rate }, (_, index) => .3 * Math.sin(2 * Math.PI * 220 * index / rate));
  const contour = extractPitch(tone, rate), voiced = contour.points.filter(point => point.hz !== null);
  assert.ok(voiced.length > 20); assert.ok(voiced.every(point => Math.abs(point.hz! - 220) < 2));
  assert.equal(extractPitch(new Float32Array(rate), rate).points.every(point => point.hz === null), true);
  assert.equal(pitchChartData(contour, null).length, 100);
  assert.equal(pitchChartData(null, null).every(point => point.reference === null), true);
});
test('practice RPC rejects stale binding replies and cancels an in-flight capture', async () => {
  const sent: Record<string, unknown>[] = [], client = createPracticeClient(message => sent.push(message as Record<string, unknown>));
  const abort = new AbortController();
  const result = client.request('practice-capture', segment, 'a', 'a', abort.signal);
  const request = sent[0]!;
  assert.equal(client.receive({ ...request, type: 'practice-response', videoId: 'different', data: 'wrong' }), true);
  abort.abort(); await assert.rejects(result, /取消/);
  assert.equal(sent.at(-1)?.type, 'practice-cancel');
  const pause = client.request('practice-pause', segment, 'a', 'a');
  client.receive({ ...sent.at(-1), type: 'practice-response' }); await pause;
  const resetting = client.request('practice-pause', segment, 'a', 'a'); client.reset(); await assert.rejects(resetting, /切换/);
});

test('pitch display shares the reference range, retains speech gaps and handles constant tones', () => {
  const reference = { duration: 1, min: 100, max: 300, points: [
    { time: 0, hz: 100, amplitude: .2 }, { time: .5, hz: null, amplitude: .05 }, { time: 1, hz: 300, amplitude: 1 },
  ] };
  const recording = { duration: 1, min: 200, max: 400, points: [
    { time: 0, hz: 200, amplitude: .5 }, { time: .5, hz: 400, amplitude: 1 }, { time: 1, hz: 250, amplitude: .7 },
  ] };
  const data = pitchChartData(reference, recording);
  assert.equal(data[0]!.reference, 0); assert.equal(data[0]!.recording, 50);
  assert.equal(data[50]!.reference, null); assert.equal(data[50]!.recording, 100);
  assert.equal(data[99]!.reference, 100); assert.equal(data[99]!.recording, 75);
  assert.equal(data[0]!.referenceAmplitude, 20); assert.equal(data[0]!.recordingHz, 200);
  const tone = { duration: 1, min: 220, max: 220, points: [{ time: 0, hz: 220, amplitude: 1 }] };
  assert.equal(pitchChartData(tone, null)[0]!.reference, 50);
});
