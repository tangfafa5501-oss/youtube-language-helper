import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawCue, WordTiming } from '../lib/captions.ts';
import { buildEstimatedTimedPhrases, buildTimedPhrases } from '../lib/timed-phrases.ts';

const cue = (text: string): RawCue => ({ cueId: 'manual:0', sourceIndex: 0, text,
  startMs: 0, endMs: 6000, timingSource: 'offset+duration', timingIssue: null, raw: {} });
const word = (text: string, startMs: number, endMs: number): WordTiming => ({ text, startMs, endMs });

test('punctuated manual phrases receive independent YouTube word starts', () => {
  const phrases = buildTimedPhrases([cue('Hello world. Start now.')], [
    word('hello', 100, 600), word(' world', 600, 2500), word(' start', 2500, 3100), word(' now', 3100, 5000),
  ]);
  assert.deepEqual(phrases.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })), [
    { text: 'Hello world.', startMs: 100, endMs: 2500 },
    { text: 'Start now.', startMs: 2500, endMs: 5000 },
  ]);
});

test('a sub-2 second phrase merges forward and spelling substitutions still align', () => {
  const phrases = buildTimedPhrases([cue('Practise. Start now.')], [
    word('practice', 100, 700), word(' start', 900, 1600), word(' now', 1600, 3500),
  ]);
  assert.equal(phrases.length, 1);
  assert.equal(phrases[0]!.text, 'Practise.\nStart now.');
  assert.equal(phrases[0]!.startMs, 100);
  assert.equal(phrases[0]!.endMs, 3500);
});

test('a long sentence tail receives its own word-level timestamp', () => {
  const text = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  const words = text.match(/[A-Za-z]+|100/g)!;
  const timings = words.map((value, index) => word(value, index * 500, index * 500 + 500));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.deepEqual(phrases.map(({ text: phrase, startMs, endMs }) => ({ phrase, startMs, endMs })), [
    { phrase: 'Today, I am very excited to help you pronounce 100 everyday words', startMs: 0, endMs: 6000 },
    { phrase: 'in my Modern Received Pronunciation accent.', startMs: 6000, endMs: 9000 },
  ]);
});

test('sentence punctuation wins before six seconds and never absorbs the next sentence opening', () => {
  const first = 'Hello, lovely students, and welcome to your pronunciation training session.';
  const second = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  const text = `${first} ${second}`;
  const words = text.match(/[A-Za-z]+|100/g)!;
  const firstWords = first.match(/[A-Za-z]+/g)!.length;
  const timings = words.map((value, index) => index < firstWords
    ? word(value, index * 350, index * 350 + 350)
    : word(value, firstWords * 350 + (index - firstWords) * 450, firstWords * 350 + (index - firstWords + 1) * 450));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.equal(phrases[0]!.text, first);
  assert.equal(phrases[1]!.text.startsWith('Today, I am'), true);
  assert.ok(phrases.every(phrase => phrase.endMs - phrase.startMs <= 6_000));
  assert.equal(phrases.map(phrase => phrase.text).join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('one unmatched semantic split word does not discard every SBD phrase', () => {
  const text = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  const words = text.match(/[A-Za-z]+|100/g)!;
  const timings = words.map((value, index) => word(value === 'words' ? 'terms' : value, index * 500, index * 500 + 500));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.ok(phrases.length >= 2);
  assert.ok(phrases.every(phrase => phrase.endMs - phrase.startMs <= 6_000));
  assert.equal(phrases.map(phrase => phrase.text).join(' ').replace(/\s/g, ''), text.replace(/\s/g, ''));
});

test('unrelated same-length transcripts are rejected instead of receiving invented word times', () => {
  assert.throws(() => buildTimedPhrases([cue('Alpha beta. Gamma delta.')], [
    word('orange', 0, 500), word('purple', 500, 1_000), word('silver', 1_000, 1_500), word('yellow', 1_500, 2_000),
  ]), /未能对齐/);
});

test('a phrase must match both its first and last spoken word before it gets an independent timestamp', () => {
  assert.throws(() => buildTimedPhrases([cue('Missing start words here.')], [
    word('start', 500, 1_000), word('words', 1_000, 1_500), word('here', 1_500, 2_000),
  ]), /未能对齐/);
  assert.throws(() => buildTimedPhrases([cue('Words end missing.')], [
    word('words', 0, 500), word('end', 500, 1_000), word('different', 1_000, 1_500),
  ]), /未能对齐/);
});

test('a final one-letter ASR vocalization keeps earlier exact phrases and marks only itself estimated', () => {
  const cues = [{ ...cue('First sentence. See you next time. Muah!'), endMs: 8_000 }];
  const phrases = buildTimedPhrases(cues, [
    word('first', 0, 700), word('sentence', 700, 2_500),
    word('see', 2_500, 3_000), word('you', 3_000, 3_500), word('next', 3_500, 4_000), word('time', 4_000, 5_000),
    word('music', 5_000, 6_000), word('m', 6_000, 8_000),
  ]);
  assert.equal(phrases[0]!.text, 'First sentence.');
  assert.equal(phrases[0]!.timing, 'youtube-word');
  assert.equal(phrases.at(-1)!.text, 'Muah!');
  assert.equal(phrases.at(-1)!.endMs, 8_000);
  assert.equal(phrases.at(-1)!.timing, 'youtube-estimated');
});

test('high-coverage tracks estimate only local repeated words that the ASR omitted', () => {
  const text = 'We practise carefully. Cuppa cuppa. Then continue together.';
  const phrases = buildTimedPhrases([{ ...cue(text), endMs: 9_000 }], [
    word('we', 0, 500), word('practise', 500, 1_200), word('carefully', 1_200, 2_500),
    word('cuppa', 2_500, 4_000),
    word('then', 5_000, 5_500), word('continue', 5_500, 6_500), word('together', 6_500, 8_000),
  ]);
  assert.equal(phrases[0]!.timing, 'youtube-word');
  assert.equal(phrases.some(phrase => phrase.text.includes('Cuppa cuppa.') && phrase.timing === 'youtube-estimated'), true);
  assert.equal(phrases.at(-1)!.timing, 'youtube-word');
});

test('matching only the first and last word is insufficient for a mostly unrelated phrase', () => {
  const cues = [cue('Hello alpha beta gamma world.')];
  const timings = ['Hello', 'xray', 'yankee', 'zulu', 'world'].map((text, index) => word(text, index * 600, index * 600 + 500));
  assert.throws(() => buildTimedPhrases(cues, timings), /未能对齐/);
});

test('very long unequal tokens are rejected without expensive fuzzy comparison', () => {
  const left = `start ${'a'.repeat(200)} alpha beta end.`;
  const right = ['start', 'b'.repeat(200), 'xray', 'yankee', 'end'];
  const timings = right.map((text, index) => word(text, index * 800, index * 800 + 700));
  assert.throws(() => buildTimedPhrases([cue(left)], timings), /未能对齐/);
});

test('word timing order is validated instead of silently reordered', () => {
  assert.throws(() => buildTimedPhrases([cue('One two.')], [word('one', 1_000, 1_500), word('two', 500, 900)]), /顺序异常/);
  assert.throws(() => buildTimedPhrases([cue('One two.')], [word('one', 0, 0), word('two', 1, 2)]), /顺序异常/);
});

test('pathological alignment size is rejected before allocating an unbounded edit matrix', () => {
  const timings = Array.from({ length: 12_001 }, (_, index) => word('word', index * 2, index * 2 + 1));
  assert.throws(() => buildTimedPhrases([cue('Word.')], timings), /规模过大/);
});

test('isolated short phrases extend into silence to satisfy the hard two-second minimum', () => {
  const phrases = buildTimedPhrases([cue('First phrase. Second phrase.')], [
    word('first', 0, 400), word('phrase', 400, 1_000), word('second', 5_000, 5_400), word('phrase', 5_400, 6_000),
  ]);
  assert.deepEqual(phrases.map(item => [item.startMs, item.endMs]), [[0, 2_000], [5_000, 7_000]]);
});

test('a short phrase does not merge across a long silent gap', () => {
  const phrases = buildTimedPhrases([cue('Go! Continue now.')], [
    word('go', 0, 800), word('continue', 5_000, 6_000), word('now', 6_000, 7_000),
  ]);
  assert.deepEqual(phrases.map(item => item.text), ['Go!', 'Continue now.']);
  assert.ok(phrases.every(item => item.endMs - item.startMs >= 2_000 && item.endMs - item.startMs <= 6_000));
});

test('estimated Supadata fallback fixes the reported cross-sentence source chunks', () => {
  const first = 'Hello, lovely students, and welcome to your pronunciation training session.';
  const second = 'Today, I am very excited to help you pronounce 100 everyday words in my Modern Received Pronunciation accent.';
  const cues: RawCue[] = [
    { ...cue(`${first} Today, I am`), cueId: 'reported:0', startMs: 0, endMs: 5_000 },
    { ...cue(second.replace(/^Today, I am\s*/, '')), cueId: 'reported:1', sourceIndex: 1, startMs: 5_000, endMs: 11_600 },
  ];
  const phrases = buildEstimatedTimedPhrases(cues);
  assert.deepEqual(phrases.map(item => item.text), [
    first,
    'Today, I am very excited to help you pronounce 100 everyday words',
    'in my Modern Received Pronunciation accent.',
  ]);
  assert.ok(phrases[1]!.endMs - phrases[1]!.startMs > 5_000);
  assert.ok(phrases.every(item => item.timing === 'youtube-estimated'));
  assert.ok(phrases.every(item => item.endMs - item.startMs >= 2_000 && item.endMs - item.startMs <= 6_000));
  assert.equal(phrases.map(item => item.text).join(' ').replace(/\s/g, ''), `${first} ${second}`.replace(/\s/g, ''));
});

test('estimated fallback pads a final short sentence instead of violating the two-second minimum', () => {
  const phrases = buildEstimatedTimedPhrases([{
    ...cue('Done.'), startMs: 1_000, endMs: 1_600,
  }]);
  assert.deepEqual(phrases.map(item => [item.startMs, item.endMs]), [[1_000, 3_000]]);
});

test('a sub-six-second unfinished sentence combines adjacent reading lines', () => {
  const text = 'Here is the plan: practise every word carefully';
  const timings = text.match(/[A-Za-z]+/g)!.map((value, index, words) =>
    word(value, index * (5_800 / words.length), (index + 1) * (5_800 / words.length)));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.deepEqual(phrases.map(item => item.text), [text]);
  assert.equal(phrases[0]!.endMs - phrases[0]!.startMs, 5_800);
});

test('six seconds is a target and a complete semantic boundary may exceed it slightly', () => {
  const text = 'Here is the plan: practise every word carefully now.';
  const build = (duration: number) => {
    const values = text.match(/[A-Za-z]+/g)!;
    return buildTimedPhrases([cue(text)], values.map((value, index) =>
      word(value, index * (duration / values.length), (index + 1) * (duration / values.length))));
  };
  assert.deepEqual(build(6_000).map(item => item.text), [text]);
  assert.deepEqual(build(6_001).map(item => item.text), [text]);
});

test('a natural reading phrase may exceed the suggested six seconds', () => {
  const first = 'Today, I am very excited to help you pronounce 100 everyday words';
  const second = 'in my Modern Received Pronunciation accent.';
  const firstWords = first.match(/[A-Za-z0-9]+/g)!;
  const secondWords = second.match(/[A-Za-z]+/g)!;
  const timings = [
    ...firstWords.map((value, index) => word(value, index * 625, (index + 1) * 625)),
    ...secondWords.map((value, index) => word(value, 7_500 + index * 500, 7_500 + (index + 1) * 500)),
  ];
  const phrases = buildTimedPhrases([cue(`${first} ${second}`)], timings);
  assert.deepEqual(phrases.map(item => item.text), [first, second]);
  assert.deepEqual(phrases.map(item => item.endMs - item.startMs), [7_500, 3_000]);
});

test('a short period tail stays with its sentence instead of joining the next sentence', () => {
  const first = 'Each focusing on a specific feature of my accent or British everyday vocabulary.';
  const second = 'I promise you that this works.';
  const firstWords = first.match(/[A-Za-z]+/g)!;
  const secondWords = second.match(/[A-Za-z]+/g)!;
  const firstDuration = firstWords.length * 550;
  const timings = [
    ...firstWords.map((value, index) => word(value, index * 550, (index + 1) * 550)),
    ...secondWords.map((value, index) => word(value, firstDuration + index * 500, firstDuration + (index + 1) * 500)),
  ];
  const phrases = buildTimedPhrases([cue(`${first} ${second}`)], timings);
  assert.deepEqual(phrases.map(item => item.text), [first, second]);
  assert.deepEqual(phrases.map(item => item.endMs - item.startMs), [7_150, 3_000]);
});

test('word timing silence alone does not split a semantic sentence', () => {
  const text = 'We practise these words together.';
  const timings = [
    word('We', 0, 400), word('practise', 400, 1_000), word('these', 1_000, 1_400),
    word('words', 5_400, 5_900), word('together', 5_900, 6_500),
  ];
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.deepEqual(phrases.map(item => item.text), [text]);
  assert.equal(phrases[0]!.endMs - phrases[0]!.startMs, 6_500);
});

test('a semantic comma keeps will help you to build fluency together', () => {
  const first = 'Well, this technique, often called shadowing, will help you to build fluency,';
  const second = 'practise your English rhythm and gain confidence.';
  const firstWords = first.match(/[A-Za-z]+/g)!;
  const secondWords = second.match(/[A-Za-z]+/g)!;
  const timings = [
    ...firstWords.map((value, index) => word(value, index * (6_100 / firstWords.length), (index + 1) * (6_100 / firstWords.length))),
    ...secondWords.map((value, index) => word(value, 6_100 + index * 450, 6_100 + (index + 1) * 450)),
  ];
  const phrases = buildTimedPhrases([cue(`${first} ${second}`)], timings);
  assert.equal(phrases[0]!.text, first);
  assert.equal(phrases[0]!.endMs - phrases[0]!.startMs, 6_100);
});

test('a short prepositional sentence tail stays with the preceding clause', () => {
  const text = "When I say together, I mean that I'd like you to speak along with me at the same time.";
  const values = text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*/g)!;
  const timings = values.map((value, index) => word(value, index * 360, (index + 1) * 360));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.deepEqual(phrases.map(item => item.text), [text]);
  assert.equal(phrases[0]!.endMs - phrases[0]!.startMs, 6_840);
});

test('a comma keeps first with the following action when a long timed sentence must split', () => {
  const text = "Step 1: I'll model each word for you, first slowly and then faster.";
  const values = text.match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g)!;
  const timings = values.map((value, index) => word(value, index * 700, (index + 1) * 700));
  const phrases = buildTimedPhrases([cue(text)], timings);
  assert.deepEqual(phrases.map(item => item.text), [
    "Step 1: I'll model each word for you,",
    'first slowly and then faster.',
  ]);
  assert.ok(phrases.every(item => item.endMs - item.startMs >= 2_000 && item.endMs - item.startMs <= 6_000));
});
