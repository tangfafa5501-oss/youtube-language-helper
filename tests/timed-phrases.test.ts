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
