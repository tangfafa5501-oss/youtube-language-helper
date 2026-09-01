import assert from 'node:assert/strict';
import test from 'node:test';
import { captionUrl, parseJson3, parseJson3WordTimings, watchVideoId } from '../lib/captions.ts';
import { SessionGate } from '../lib/session.ts';

test('preserves duplicate, overlapping, unsorted, newline and empty text events', () => {
  const events = [
    { tStartMs: 10_000, dDurationMs: 5000, segs: [{ utf8: ' half' }, { utf8: '\nline &amp;' }] },
    { tStartMs: 9000, dDurationMs: 2000, segs: [{ utf8: ' half' }] },
    { tStartMs: 9000, dDurationMs: 2000, segs: [{ utf8: ' half' }] },
    { tStartMs: 11_000, wWinId: 1 },
    { tStartMs: 12_000, dDurationMs: 1, segs: [{ utf8: '' }] },
  ];
  const parsed = parseJson3(JSON.stringify({ events }), 'a.en');
  assert.deepEqual(parsed.cues.map(c => c.sourceIndex), [0, 1, 2, 4]);
  assert.deepEqual(parsed.cues.map(c => c.raw), [events[0], events[1], events[2], events[4]]);
  assert.equal(parsed.cues[0].text, ' half\nline &amp;');
  assert.equal(parsed.cues[0].endMs, 15_000);
  assert.equal(parsed.controlEventCount, 1);
  assert.equal(new Set(parsed.cues.map(c => c.cueId)).size, 4);
});
test('bad timing is retained and flagged, never inferred from adjacent cues', () => {
  const { cues } = parseJson3(JSON.stringify({ events: [
    { segs: [{ utf8: 'missing' }] },
    { tStartMs: -1, dDurationMs: 20, segs: [{ utf8: 'negative' }] },
    { tStartMs: 10, dDurationMs: 0, segs: [{ utf8: 'zero' }] },
    { tStartMs: '100', dDurationMs: 20, segs: [{ utf8: 'string' }] },
  ] }), 'track');
  assert.equal(cues.length, 4);
  assert.ok(cues.every(c => c.timingIssue));
  assert.equal(cues[0].endMs, null);
  assert.equal(cues[2].startMs, 10);
});
test('empty, unsupported and malformed responses are errors, not false success', () => {
  for (const body of ['', '<html>error</html>', '{}', '{"events":[]}', '{"events":[{"segs":[{}]}]}']) {
    assert.throws(() => parseJson3(body, 'track'));
  }
});
test('only exact YouTube watch pages and same-video timedtext URLs are allowed', () => {
  const id = '0BU_u8_blss';
  assert.equal(watchVideoId(`https://www.youtube.com/watch?v=${id}`), id);
  assert.equal(watchVideoId(`https://www.youtube.com.evil.test/watch?v=${id}`), null);
  assert.equal(watchVideoId('https://www.youtube.com/shorts/0BU_u8_blss'), null);
  assert.equal(captionUrl(`/api/timedtext?v=${id}&lang=en`, id), `https://www.youtube.com/api/timedtext?v=${id}&lang=en&fmt=json3`);
  for (const url of ['https://evil.test/api/timedtext?v='+id, '/api/timedtext?v=wrong', '/youtubei/v1/player?v='+id]) assert.equal(captionUrl(url, id), null);
});

test('JSON3 ASR segment offsets become absolute word timings without text interpolation', () => {
  const words = parseJson3WordTimings(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000,
    segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 650 }] }] }));
  assert.deepEqual(words, [
    { text: 'hello', startMs: 1000, endMs: 1650 },
    { text: ' world', startMs: 1650, endMs: 3000 },
  ]);
});

test('word timings reject missing, duplicate, decreasing and out-of-event offsets', () => {
  const parse = (segs: unknown[]) => parseJson3WordTimings(JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs }] }));
  for (const segments of [
    [{ utf8: 'one' }, { utf8: ' two' }],
    [{ utf8: 'one', tOffsetMs: 0 }, { utf8: ' two', tOffsetMs: 0 }],
    [{ utf8: 'one', tOffsetMs: 1000 }, { utf8: ' two', tOffsetMs: 500 }],
    [{ utf8: 'one', tOffsetMs: 0 }, { utf8: ' two', tOffsetMs: 2000 }],
  ]) assert.throws(() => parse(segments), /分词时间/);
});

test('word timing input is bounded before producing an oversized alignment workload', () => {
  const tooManyEvents = { events: Array.from({ length: 40_001 }, () => ({})) };
  assert.throws(() => parseJson3WordTimings(JSON.stringify(tooManyEvents)), /事件过多/);
  const tooManySegments = { events: [{ tStartMs: 0, dDurationMs: 30_000,
    segs: Array.from({ length: 20_001 }, (_, index) => ({ utf8: 'x', tOffsetMs: index })) }] };
  assert.throws(() => parseJson3WordTimings(JSON.stringify(tooManySegments)), /分词条目过多/);
});
test('navigation and track changes reject late replies including A -> B -> A', () => {
  const session = new SessionGate(); const a = session.next();
  const b = session.next(); const aAgain = session.next();
  assert.equal(session.current(a), false); assert.equal(session.current(b), false); assert.equal(session.current(aAgain), true);
});
test('in-flight metadata cannot resurrect state after reset or seek', () => {
  const session = new SessionGate(); const metadata = session.capture();
  session.next(); assert.equal(session.current(metadata), false);
  const latest = session.capture(); assert.equal(session.current(latest), true);
});
