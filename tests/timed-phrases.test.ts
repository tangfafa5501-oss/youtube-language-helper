import test from 'node:test';
import assert from 'node:assert/strict';
import type { RawCue, WordTiming } from '../lib/captions.ts';
import { buildTimedPhrases } from '../lib/timed-phrases.ts';

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

test('a <=2 second phrase merges forward and spelling substitutions still align', () => {
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

test('phrase ends keep the last spoken word boundary instead of stretching across silence', () => {
  const phrases = buildTimedPhrases([cue('First phrase. Second phrase.')], [
    word('first', 0, 400), word('phrase', 400, 1_000), word('second', 5_000, 5_400), word('phrase', 5_400, 6_000),
  ]);
  assert.deepEqual(phrases.map(item => [item.startMs, item.endMs]), [[0, 1_000], [5_000, 6_000]]);
});

test('a short phrase does not merge across a long silent gap', () => {
  const phrases = buildTimedPhrases([cue('Go! Continue now.')], [
    word('go', 0, 800), word('continue', 5_000, 6_000), word('now', 6_000, 7_000),
  ]);
  assert.deepEqual(phrases.map(item => item.text), ['Go!', 'Continue now.']);
});
