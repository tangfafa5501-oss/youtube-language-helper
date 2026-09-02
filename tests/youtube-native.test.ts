import test from 'node:test';
import assert from 'node:assert/strict';
import { applyNativeAuth, boundedNativeCache, chooseNativeTranscript, nativeDisplayPhrases, observedTimedText, timedTextFormat } from '../lib/youtube-native.ts';

test('only exact YouTube timedtext requests expose bounded video, track and auth metadata', () => {
  const found = observedTimedText('https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en-GB&kind=asr&pot=token&potc=7&fmt=json3');
  assert.deepEqual(found && { ...found, url: undefined }, {
    videoId: 'X627czLUsGY', language: 'en-GB', kind: 'asr', pot: 'token', potc: '7', url: undefined,
  });
  assert.equal(observedTimedText('https://evil.test/api/timedtext?v=X627czLUsGY&lang=en'), null);
  assert.equal(observedTimedText('https://www.youtube.com/api/timedtext?v=wrong&lang=en'), null);
  assert.equal(observedTimedText('https://www.youtube.com/youtubei/v1/player?v=X627czLUsGY&lang=en'), null);
});

test('native track requests retain their signed base URL and add only bounded known client and captured auth fields', () => {
  const url = applyNativeAuth('https://www.youtube.com/api/timedtext?v=X627czLUsGY&lang=en&sig=track-signature', 'X627czLUsGY',
    { pot: 'proof-token', potc: '3', capturedAt: Date.now() }, { c: 'WEB', cver: '2.2026', evil: 'ignored' });
  assert.ok(url);
  const parsed = new URL(url!);
  assert.equal(parsed.searchParams.get('sig'), 'track-signature');
  assert.equal(parsed.searchParams.get('fmt'), 'json3');
  assert.equal(parsed.searchParams.get('pot'), 'proof-token');
  assert.equal(parsed.searchParams.get('c'), 'WEB');
  assert.equal(parsed.searchParams.has('evil'), false);
  assert.equal(applyNativeAuth('https://evil.test/api/timedtext?v=X627czLUsGY', 'X627czLUsGY', null, {}), null);
});

test('native transcript cache chooses the matching language and source without leaking across videos', () => {
  const entries = [
    { videoId: 'X627czLUsGY', language: 'en', kind: 'asr' as const, body: '{"events":[]}', format: 'youtube-timedtext-json3' as const, capturedAt: 1 },
    { videoId: 'X627czLUsGY', language: 'en-GB', kind: 'manual' as const, body: '<transcript/>', format: 'youtube-timedtext-xml' as const, capturedAt: 2 },
    { videoId: 'abcdefghijk', language: 'en-GB', kind: 'manual' as const, body: 'other', format: 'youtube-timedtext-xml' as const, capturedAt: 3 },
  ];
  assert.equal(chooseNativeTranscript(entries, 'X627czLUsGY', 'en-GB', 'manual')?.body, '<transcript/>');
  assert.equal(chooseNativeTranscript(entries, 'X627czLUsGY', 'en', 'manual')?.body, '<transcript/>');
  assert.equal(chooseNativeTranscript(entries, 'X627czLUsGY', 'zh', 'manual'), null);
  assert.equal(timedTextFormat('  {"events":[]}'), 'youtube-timedtext-json3');
  assert.equal(timedTextFormat('<?xml version="1.0"?>'), 'youtube-timedtext-xml');
});

test('broad language cache fallback accepts one regional variant but rejects ambiguous variants', () => {
  const make = (language: string, capturedAt: number) => ({ videoId: 'X627czLUsGY', language, kind: 'manual' as const,
    body: JSON.stringify({ events: [] }), format: 'youtube-timedtext-json3' as const, capturedAt });
  assert.equal(chooseNativeTranscript([make('en-US', 1)], 'X627czLUsGY', 'en', 'manual')?.language, 'en-US');
  assert.equal(chooseNativeTranscript([make('en-US', 2), make('en-GB', 1)], 'X627czLUsGY', 'en', 'manual'), null);
  assert.equal(chooseNativeTranscript([make('en-US', 2), make('en-GB', 1), make('en', 3)],
    'X627czLUsGY', 'en', 'manual')?.language, 'en');
});

test('native session cache is newest-first, deduplicated and bounded', () => {
  const make = (capturedAt: number, body: string) => ({ videoId: 'X627czLUsGY', language: 'en', kind: 'manual' as const,
    body, format: 'youtube-timedtext-json3' as const, capturedAt });
  const cache = boundedNativeCache([make(1, 'old'), make(2, 'new')]);
  assert.equal(cache.length, 1); assert.equal(cache[0]?.body, 'new');
  assert.deepEqual(boundedNativeCache([{ ...make(3, 'x'), videoId: 'bad' }]), []);
});

test('native display repairs usable event timing without mutating raw cue text or order', () => {
  const cues = [
    { cueId: 't:1', sourceIndex: 1, text: '  second\nline ', startMs: 2_000, endMs: 0, timingSource: 'start+duration' as const, timingIssue: 'bad', raw: {} },
    { cueId: 't:0', sourceIndex: 0, text: ' First   line. ', startMs: 0, endMs: 1_500, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 't:2', sourceIndex: 2, text: 'Third line.', startMs: 4_000, endMs: 5_000, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  assert.deepEqual(nativeDisplayPhrases(cues).map(row => [row.text, row.startMs, row.endMs]), [
    ['First line.', 0, 2_000], ['second line', 2_000, 4_000], ['Third line.', 4_000, 6_000],
  ]);
  assert.equal(cues[0]!.text, '  second\nline '); assert.equal(cues[0]!.endMs, 0);
});

test('native display restores complete sentences across real YouTube ASR event boundaries', () => {
  const cues = [
    { cueId: 'hamlet:0', sourceIndex: 0, text: "It's the most famous revenge story ever", startMs: 0, endMs: 2_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'hamlet:1', sourceIndex: 1, text: 'written.', startMs: 2_000, endMs: 4_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'hamlet:2', sourceIndex: 2, text: "But the hero, he doesn't want revenge.", startMs: 4_000, endMs: 8_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'hamlet:3', sourceIndex: 3, text: 'How?', startMs: 8_000, endMs: 9_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'hamlet:4', sourceIndex: 4, text: 'The story continues.', startMs: 9_000, endMs: 12_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  assert.deepEqual(nativeDisplayPhrases(cues).map(row => [row.text, row.startMs, row.endMs]), [
    ["It's the most famous revenge story ever written.", 0, 4_000],
    ["But the hero, he doesn't want revenge.", 4_000, 8_000],
    ['How? The story continues.', 8_000, 12_000],
  ]);
});

test('installed-real screenshot fragments join the sentence before short-row handling', () => {
  const cues = [
    { cueId: 'screen:0', sourceIndex: 0, text: 'And what if you were wrong about every', startMs: 4_000, endMs: 6_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:newline:0', sourceIndex: 1, text: '\n', startMs: 5_990, endMs: 8_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:1', sourceIndex: 2, text: 'single one?', startMs: 6_000, endMs: 8_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:newline:1', sourceIndex: 3, text: '\n', startMs: 7_990, endMs: 11_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:2', sourceIndex: 4, text: 'Think about that. Every match completely', startMs: 8_000, endMs: 11_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:newline:2', sourceIndex: 5, text: '\n', startMs: 10_990, endMs: 12_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'screen:3', sourceIndex: 6, text: 'wrong.', startMs: 11_000, endMs: 12_000,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  assert.deepEqual(nativeDisplayPhrases(cues).map(row => [row.text, row.startMs, row.endMs]), [
    ['And what if you were wrong about every single one?', 4_000, 8_000],
    ['Think about that. Every match completely wrong.', 8_000, 12_000],
  ]);
});

test('real YouTube rolling newline events do not split the Dr Jekyll sentence', () => {
  const cues = [
    { cueId: 'jekyll:0', sourceIndex: 0, text: 'A doctor, right before he lost', startMs: 10_560, endMs: 14_160,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:newline:0', sourceIndex: 1, text: '\n', startMs: 12_670, endMs: 14_160,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:1', sourceIndex: 2, text: 'everything.', startMs: 12_680, endMs: 17_080,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:newline:1', sourceIndex: 3, text: '\n', startMs: 14_150, endMs: 17_080,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:2', sourceIndex: 4, text: 'His name was Dr. Jekyll, and this is his', startMs: 14_160, endMs: 18_560,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:newline:2', sourceIndex: 5, text: '\n', startMs: 17_070, endMs: 18_560,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'jekyll:3', sourceIndex: 6, text: 'story.', startMs: 17_080, endMs: 20_600,
      timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  const before = structuredClone(cues);
  assert.deepEqual(nativeDisplayPhrases(cues).map(row => [row.text, row.startMs, row.endMs]), [
    ['A doctor, right before he lost everything.', 10_560, 17_080],
    ['His name was Dr. Jekyll, and this is his story.', 14_160, 20_600],
  ]);
  assert.deepEqual(cues, before);
});

test('native display merges only sub-two-second rows and never splits at five seconds', () => {
  const cues = [
    { cueId: 'long', sourceIndex: 0, text: 'A complete natural line.', startMs: 0, endMs: 5_500, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'short', sourceIndex: 1, text: 'Short.', startMs: 5_500, endMs: 6_500, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'next', sourceIndex: 2, text: 'Next line.', startMs: 6_500, endMs: 9_000, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  assert.deepEqual(nativeDisplayPhrases(cues).map(row => [row.text, row.startMs, row.endMs]), [
    ['A complete natural line.', 0, 5_500], ['Short. Next line.', 5_500, 9_000],
  ]);
});

test('native display guarantees every row is at least two seconds, including the final tail', () => {
  const cues = [
    { cueId: 'brief', sourceIndex: 0, text: 'Brief.', startMs: 0, endMs: 1_000, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'later', sourceIndex: 1, text: 'Continue later.', startMs: 5_000, endMs: 8_000, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
    { cueId: 'tail', sourceIndex: 2, text: 'Tail.', startMs: 9_000, endMs: 9_400, timingSource: 'start+duration' as const, timingIssue: null, raw: {} },
  ];
  const rows = nativeDisplayPhrases(cues);
  assert.deepEqual(rows.map(row => [row.text, row.startMs, row.endMs, row.timing]), [
    ['Brief.', 0, 2_000, 'youtube-estimated'],
    ['Continue later.', 5_000, 8_000, 'youtube-native'],
    ['Tail.', 9_000, 11_000, 'youtube-estimated'],
  ]);
  assert.ok(rows.every(row => row.endMs - row.startMs >= 2_000));
  assert.deepEqual(cues.map(cue => [cue.startMs, cue.endMs]), [[0, 1_000], [5_000, 8_000], [9_000, 9_400]]);
});

test('native display enforces the two-second invariant across gaps, overlaps and invalid boundaries', () => {
  for (let seed = 1; seed <= 100; seed++) {
    let value = seed;
    const random = () => (value = value * 16_807 % 2_147_483_647) / 2_147_483_647;
    let startMs = 0;
    const cues = Array.from({ length: 40 }, (_, sourceIndex) => {
      startMs += Math.floor(random() * 2_500);
      const duration = 100 + Math.floor(random() * 4_900);
      const invalid = sourceIndex % 17 === 0;
      const cue = { cueId: `fuzz:${seed}:${sourceIndex}`, sourceIndex,
        text: sourceIndex % 4 === 3 ? `fragment ${sourceIndex}.` : `fragment ${sourceIndex}`,
        startMs, endMs: invalid ? startMs - 1 : startMs + duration,
        timingSource: 'start+duration' as const, timingIssue: invalid ? 'bad' : null, raw: {} };
      startMs += Math.floor(random() * 1_000) - 500;
      return cue;
    });
    const before = structuredClone(cues);
    const rows = nativeDisplayPhrases(cues);
    assert.ok(rows.every(row => row.endMs - row.startMs >= 2_000), `seed ${seed} emitted a short row`);
    assert.deepEqual(cues, before, `seed ${seed} mutated raw cues`);
  }
});
