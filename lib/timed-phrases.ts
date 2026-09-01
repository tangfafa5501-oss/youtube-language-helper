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

function tokens(text: string, phrase: number): Token[] {
  return [...text.matchAll(tokenPattern)].map(match => ({ value: normalize(match[0]), phrase }));
}

// Global edit alignment maps spelling and recognition substitutions as well as
// exact words. Directions use one byte per cell; typical 20-minute lessons stay
// well below the extension's existing subtitle response limit.
function matches(a: Token[], b: Token[]): Array<[number, number]> {
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
    if (direction === 1) { result.push([--i, --j]); }
    else if (direction === 2) i--;
    else j--;
  }
  return result.reverse();
}

export function buildTimedPhrases(cues: RawCue[], timings: WordTiming[]): TimedPhrase[] {
  const phraseTexts = phraseTextsFromCues(cues);
  const manual = phraseTexts.flatMap((text, index) => tokens(text, index));
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
    const phraseTokens = manual.filter(token => token.phrase === index);
    const first = phraseTokens[0], last = phraseTokens.at(-1);
    if (!first || !last) continue;
    if (first.startMs === undefined) {
      const manualStart = manual.indexOf(first);
      const inside = phraseTokens.findIndex(token => token.automaticIndex !== undefined);
      let automaticIndex = inside >= 0 ? phraseTokens[inside]!.automaticIndex! - inside : -1;
      if (automaticIndex < 0) {
        const previous = manual.slice(0, manualStart).findLast(token => token.automaticIndex !== undefined);
        const next = manual.slice(manualStart + phraseTokens.length).find(token => token.automaticIndex !== undefined);
        if (previous?.automaticIndex !== undefined && next?.automaticIndex !== undefined
          && previous.automaticIndex + 1 < next.automaticIndex) automaticIndex = previous.automaticIndex + 1;
      }
      const timing = automatic[automaticIndex];
      if (timing?.startMs !== undefined) { first.startMs = timing.startMs; first.endMs = timing.endMs; }
    }
    if (first.startMs === undefined) continue;
    const lastTimed = phraseTokens.findLast(token => token.endMs !== undefined);
    const endMs = lastTimed?.endMs ?? first.endMs;
    if (endMs === undefined || endMs <= first.startMs) continue;
    result.push({ id: `phrase:${index}:${first.startMs}`, text: phraseTexts[index]!,
      startMs: first.startMs, endMs, timing: 'youtube-word' });
  }
  if (result.length !== phraseTexts.length) {
    const present = new Set(result.map(item => Number(item.id.split(':')[1])));
    const missing = phraseTexts.filter((_, index) => !present.has(index)).slice(0, 3).join(' / ');
    throw new Error(`有 ${phraseTexts.length - result.length} 个语段未能对齐词级起点：${missing}`);
  }
  for (let i = 0; i + 1 < result.length; i++) {
    if (result[i + 1]!.startMs > result[i]!.startMs) result[i]!.endMs = result[i + 1]!.startMs;
  }
  const merged: TimedPhrase[] = [];
  for (let i = 0; i < result.length; i++) {
    let current = { ...result[i]! };
    while (i + 1 < result.length && current.endMs - current.startMs <= 2000) {
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
