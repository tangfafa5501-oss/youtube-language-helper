import type { RawCue, WordTiming } from './captions.ts';
import { readingLines, readingSentences } from './reading-lines.ts';
import { groupSentences } from './sentence-groups.ts';

export type TimedPhrase = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  timing: 'youtube-word' | 'bilibili-cue';
};

type Token = { value: string; phrase: number; charStart: number; charEnd: number;
  startMs?: number; endMs?: number; automaticIndex?: number };
const tokenPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const normalize = (value: string) => value.toLocaleLowerCase('en-US').replace(/’/g, "'");
const MAX_ALIGNMENT_CELLS = 50_000_000;
const MAX_ALIGNMENT_TOKENS = 12_000;
const MAX_SHORT_MERGE_GAP_MS = 1_500;
const MIN_PHRASE_MS = 2_000;
const MAX_PHRASE_MS = 5_000;

function tokens(text: string, phrase: number): Token[] {
  return [...text.matchAll(tokenPattern)].map(match => ({ value: normalize(match[0]), phrase,
    charStart: match.index!, charEnd: match.index! + match[0].length }));
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

function timedTextPlan(cues: RawCue[]) {
  let display = '';
  const sentenceCharEnds: number[] = [], phraseCharEnds: number[] = [];
  for (const group of groupSentences(cues)) {
    for (const sentence of readingSentences(group.text)) {
      if (display) display += '\n';
      const sentenceStart = display.length;
      display += sentence.text;
      let cursor = 0;
      for (const line of sentence.lines) {
        const lineStart = sentence.text.indexOf(line, cursor);
        if (lineStart < 0) throw new Error('断句文本无法映射回字幕，已保留原字幕');
        cursor = lineStart + line.length;
        phraseCharEnds.push(sentenceStart + cursor);
      }
      if (sentence.complete) sentenceCharEnds.push(display.length);
    }
  }
  const manual = tokens(display, 0);
  if (!manual.length) throw new Error('字幕没有可对齐的单词，已保留原字幕');
  const charEnds = [...new Set([...sentenceCharEnds, ...phraseCharEnds])].sort((a, b) => a - b);
  const tokenEndByChar = new Map<number, number>();
  let tokenEnd = 0;
  for (const charEnd of charEnds) {
    while (tokenEnd < manual.length && manual[tokenEnd]!.charEnd <= charEnd) tokenEnd++;
    if (tokenEnd) tokenEndByChar.set(charEnd, tokenEnd);
  }
  const sentenceEnds = new Set(sentenceCharEnds.map(end => tokenEndByChar.get(end)).filter((end): end is number => end !== undefined));
  const phraseEnds = new Set(phraseCharEnds.map(end => tokenEndByChar.get(end)).filter((end): end is number => end !== undefined));
  return { display, manual, sentenceEnds, phraseEnds };
}

export function buildTimedPhrases(cues: RawCue[], timings: WordTiming[]): TimedPhrase[] {
  for (let index = 0; index < timings.length; index++) {
    const timing = timings[index]!;
    if (!Number.isFinite(timing.startMs) || !Number.isFinite(timing.endMs) || timing.startMs < 0 || timing.endMs <= timing.startMs
      || index && timing.startMs < timings[index - 1]!.startMs) {
      throw new Error('词级时间顺序异常，已保留原字幕而未猜测重排');
    }
  }
  const { display, manual, sentenceEnds, phraseEnds } = timedTextPlan(cues);
  const automatic: Token[] = [];
  for (const timing of timings) {
    for (const token of tokens(timing.text, -1)) automatic.push({ ...token, startMs: timing.startMs, endMs: timing.endMs });
  }
  for (const [manualIndex, automaticIndex] of matches(manual, automatic)) {
    manual[manualIndex]!.startMs = automatic[automaticIndex]!.startMs;
    manual[manualIndex]!.endMs = automatic[automaticIndex]!.endMs;
    manual[manualIndex]!.automaticIndex = automaticIndex;
  }
  const matchedPrefix = new Uint32Array(manual.length + 1);
  for (let index = 0; index < manual.length; index++) {
    matchedPrefix[index + 1] = matchedPrefix[index]! + Number(manual[index]!.automaticIndex !== undefined);
  }
  type Candidate = { end: number; startMs: number; endMs: number; duration: number };
  const candidate = (start: number, end: number): Candidate | null => {
    const first = manual[start], last = manual[end - 1];
    if (!first || !last || first.startMs === undefined || last.endMs === undefined || last.endMs <= first.startMs) return null;
    const matched = matchedPrefix[end]! - matchedPrefix[start]!;
    if (matched < Math.max(1, Math.ceil((end - start) * .6))) return null;
    if (end < manual.length && manual[end]!.startMs === undefined) return null;
    return { end, startMs: first.startMs, endMs: last.endMs, duration: last.endMs - first.startMs };
  };
  const result: TimedPhrase[] = [];
  let start = 0, charStart = 0;
  while (start < manual.length) {
    let sentenceChoice: Candidate | null = null, phraseChoice: Candidate | null = null;
    let wordChoice: Candidate | null = null, finalChoice: Candidate | null = null;
    const remaining = candidate(start, manual.length);
    const balancedTarget = remaining && remaining.duration > MAX_PHRASE_MS
      ? remaining.duration / Math.ceil(remaining.duration / MAX_PHRASE_MS) : MAX_PHRASE_MS;
    for (let end = start + 1; end <= manual.length; end++) {
      const last = manual[end - 1]!;
      if (last.endMs === undefined) continue;
      const firstStart = manual[start]!.startMs;
      if (firstStart !== undefined && last.endMs - firstStart > MAX_PHRASE_MS) break;
      const choice = candidate(start, end);
      if (!choice) continue;
      const nextStart = end < manual.length ? manual[end]!.startMs : undefined;
      const separatedByGap = nextStart !== undefined && nextStart - choice.endMs > MAX_SHORT_MERGE_GAP_MS;
      if (end === manual.length) finalChoice = choice;
      if (choice.duration <= MIN_PHRASE_MS && !separatedByGap && end < manual.length) continue;
      if (sentenceEnds.has(end)) { sentenceChoice = choice; break; }
      if ((phraseEnds.has(end) || separatedByGap) && !phraseChoice) phraseChoice = choice;
      if (!wordChoice || Math.abs(choice.duration - balancedTarget) < Math.abs(wordChoice.duration - balancedTarget)) {
        wordChoice = choice;
      }
    }
    const choice = sentenceChoice ?? phraseChoice ?? wordChoice ?? finalChoice;
    if (!choice) throw new Error('字幕未能对齐到五秒内的可靠词界，已保留原字幕而未猜测时间');
    const charEnd = choice.end < manual.length ? manual[choice.end]!.charStart : display.length;
    const text = display.slice(charStart, charEnd).trim();
    if (!text) throw new Error('词级断句产生空文本，已保留原字幕');
    result.push({ id: `phrase:${result.length}:${choice.startMs}`, text,
      startMs: choice.startMs, endMs: choice.endMs, timing: 'youtube-word' });
    start = choice.end; charStart = charEnd;
  }
  for (let i = 0; i + 1 < result.length; i++) {
    if (result[i + 1]!.startMs > result[i]!.startMs && result[i]!.endMs > result[i + 1]!.startMs) {
      result[i]!.endMs = result[i + 1]!.startMs;
    }
  }
  if (result.map(item => item.text).join('').replace(/\s/gu, '') !== display.replace(/\s/gu, '')) {
    throw new Error('词级断句未完整保留字幕文本，已回退原字幕');
  }
  return result;
}

export function phraseTextsFromCues(cues: RawCue[]): string[] {
  return groupSentences(cues).flatMap(group => readingLines(group.text));
}
