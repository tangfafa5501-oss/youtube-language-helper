import type { RawCue, WordTiming } from './captions.ts';
import { readingLines } from './reading-lines.ts';
import { groupSentences } from './sentence-groups.ts';

export type TimedPhrase = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  timing: 'youtube-word' | 'bilibili-cue';
};

type Token = { value: string; phrase: number; startMs?: number; endMs?: number; automaticIndex?: number };
const tokenPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const normalize = (value: string) => value.toLocaleLowerCase('en-US').replace(/’/g, "'");
const MAX_ALIGNMENT_CELLS = 50_000_000;
const MAX_ALIGNMENT_TOKENS = 12_000;
const MAX_SHORT_MERGE_GAP_MS = 1_500;

function tokens(text: string, phrase: number): Token[] {
  return [...text.matchAll(tokenPattern)].map(match => ({ value: normalize(match[0]), phrase }));
}

function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Uint16Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint16Array(b.length + 1); current[0] = i;
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(
      previous[j]! + 1,
      current[j - 1]! + 1,
      previous[j - 1]! + Number(a[i - 1] !== b[j - 1]),
    );
    previous = current;
  }
  return previous[b.length]!;
}

function compatibleToken(a: string, b: string) {
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < 4 || longest > 128 || Math.abs(a.length - b.length) > 2) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(longest * .2));
}

// Global edit alignment maps spelling and recognition substitutions as well as
// exact words. Directions use one byte per cell; typical 20-minute lessons stay
// well below the extension's existing subtitle response limit.
function matches(a: Token[], b: Token[]): Array<[number, number]> {
  if (a.length > MAX_ALIGNMENT_TOKENS || b.length > MAX_ALIGNMENT_TOKENS
    || (a.length + 1) * (b.length + 1) > MAX_ALIGNMENT_CELLS) {
    throw new Error('字幕词级对齐规模过大，已保留原字幕而未占用过多内存');
  }
  const width = b.length + 1;
  const directions = new Uint8Array((a.length + 1) * width); // 1 diag, 2 up, 3 left
  let previous = new Uint16Array(width);
  for (let j = 1; j < width; j++) { previous[j] = j; directions[j] = 3; }
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint16Array(width); current[0] = i; directions[i * width] = 2;
    for (let j = 1; j < width; j++) {
      const diagonal = previous[j - 1]! + (a[i - 1]!.value === b[j - 1]!.value ? 0 : 1);
      const up = previous[j]! + 1, left = current[j - 1]! + 1;
      if (diagonal <= up && diagonal <= left) { current[j] = diagonal; directions[i * width + j] = 1; }
      else if (up <= left) { current[j] = up; directions[i * width + j] = 2; }
      else { current[j] = left; directions[i * width + j] = 3; }
    }
    previous = current;
  }
  const result: Array<[number, number]> = [];
  let i = a.length, j = b.length;
  while (i && j) {
    const direction = directions[i * width + j];
    if (direction === 1) {
      --i; --j;
      if (compatibleToken(a[i]!.value, b[j]!.value)) result.push([i, j]);
    }
    else if (direction === 2) i--;
    else j--;
  }
  return result.reverse();
}

export function buildTimedPhrases(cues: RawCue[], timings: WordTiming[]): TimedPhrase[] {
  for (let index = 0; index < timings.length; index++) {
    const timing = timings[index]!;
    if (!Number.isFinite(timing.startMs) || !Number.isFinite(timing.endMs) || timing.startMs < 0 || timing.endMs <= timing.startMs
      || index && timing.startMs < timings[index - 1]!.startMs) {
      throw new Error('词级时间顺序异常，已保留原字幕而未猜测重排');
    }
  }
  const phraseTexts = phraseTextsFromCues(cues);
  const byPhrase = phraseTexts.map((text, index) => tokens(text, index));
  const manual = byPhrase.flat();
  const automatic: Token[] = [];
  for (const timing of timings) {
    for (const token of tokens(timing.text, -1)) automatic.push({ ...token, startMs: timing.startMs, endMs: timing.endMs });
  }
  for (const [manualIndex, automaticIndex] of matches(manual, automatic)) {
    manual[manualIndex]!.startMs = automatic[automaticIndex]!.startMs;
    manual[manualIndex]!.endMs = automatic[automaticIndex]!.endMs;
    manual[manualIndex]!.automaticIndex = automaticIndex;
  }
  const result: TimedPhrase[] = [];
  for (let index = 0; index < phraseTexts.length; index++) {
    const phraseTokens = byPhrase[index]!;
    const first = phraseTokens[0], last = phraseTokens.at(-1);
    if (!first || !last) continue;
    if (first.startMs === undefined) continue;
    const endMs = last.endMs;
    if (endMs === undefined || endMs <= first.startMs) continue;
    const matched = phraseTokens.reduce((total, token) => total + Number(token.automaticIndex !== undefined), 0);
    if (matched < Math.max(1, Math.ceil(phraseTokens.length * .6))) continue;
    result.push({ id: `phrase:${index}:${first.startMs}`, text: phraseTexts[index]!,
      startMs: first.startMs, endMs, timing: 'youtube-word' });
  }
  if (result.length !== phraseTexts.length) {
    const present = new Set(result.map(item => Number(item.id.split(':')[1])));
    const missing = phraseTexts.filter((_, index) => !present.has(index)).slice(0, 3).join(' / ');
    throw new Error(`有 ${phraseTexts.length - result.length} 个语段未能对齐词级起点：${missing}`);
  }
  for (let i = 0; i + 1 < result.length; i++) {
    if (result[i + 1]!.startMs > result[i]!.startMs && result[i]!.endMs > result[i + 1]!.startMs) {
      result[i]!.endMs = result[i + 1]!.startMs;
    }
  }
  const merged: TimedPhrase[] = [];
  for (let i = 0; i < result.length; i++) {
    let current = { ...result[i]! };
    while (i + 1 < result.length && current.endMs - current.startMs <= 2000
      && result[i + 1]!.startMs - current.endMs <= MAX_SHORT_MERGE_GAP_MS) {
      const next = result[++i]!;
      current = { ...current, id: `${current.id}+${next.id}`, text: `${current.text}\n${next.text}`, endMs: next.endMs };
    }
    merged.push(current);
  }
  return merged;
}

export function phraseTextsFromCues(cues: RawCue[]): string[] {
  return groupSentences(cues).flatMap(group => readingLines(group.text));
}
