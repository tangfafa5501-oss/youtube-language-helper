import type { RawCue, WordTiming } from './captions.ts';
import { readingLines, readingSentences } from './reading-lines.ts';
import { groupSentences } from './sentence-groups.ts';

export type TimedPhrase = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  timing: 'youtube-word' | 'youtube-estimated' | 'bilibili-cue';
};

type Token = { value: string; phrase: number; charStart: number; charEnd: number;
  startMs?: number; endMs?: number; automaticIndex?: number; estimatedTiming?: boolean;
  estimatedStartMs?: number; estimatedEndMs?: number };
const tokenPattern = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const normalize = (value: string) => value.toLocaleLowerCase('en-US').replace(/’/g, "'");
const MAX_ALIGNMENT_CELLS = 50_000_000;
const MAX_ALIGNMENT_TOKENS = 12_000;
const MIN_GLOBAL_WORD_COVERAGE = .8;
const MIN_PHRASE_MS = 2_000;
const TARGET_PHRASE_MS = 6_000;
const MAX_SEMANTIC_PHRASE_MS = 10_000;
const PHRASE_BOUNDARY_PENALTY = 2;
const WORD_BOUNDARY_PENALTY = 6;
const CROSSED_SENTENCE_PENALTY = 20;

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

function buildAlignedTimedPhrases(cues: RawCue[], timings: WordTiming[],
  timingSource: 'youtube-word' | 'youtube-estimated'): TimedPhrase[] {
  for (let index = 0; index < timings.length; index++) {
    const timing = timings[index]!;
    if (!Number.isFinite(timing.startMs) || !Number.isFinite(timing.endMs) || timing.startMs < 0 || timing.endMs <= timing.startMs
      || index && timing.startMs < timings[index - 1]!.startMs) {
      throw new Error('词级时间顺序异常，已保留原字幕而未猜测重排');
    }
  }
  const { display, manual, sentenceEnds, phraseEnds } = timedTextPlan(cues);
  if (timingSource === 'youtube-word') {
    const estimates = estimatedWordTimings(cues);
    if (estimates.length !== manual.length || estimates.some((timing, index) => normalize(timing.text) !== manual[index]!.value)) {
      throw new Error('估算词界无法完整映射字幕文本');
    }
    for (let index = 0; index < manual.length; index++) {
      manual[index]!.estimatedStartMs = estimates[index]!.startMs;
      manual[index]!.estimatedEndMs = estimates[index]!.endMs;
    }
  }
  const automatic: Token[] = [];
  for (const timing of timings) {
    for (const token of tokens(timing.text, -1)) automatic.push({ ...token, startMs: timing.startMs, endMs: timing.endMs });
  }
  const alignedPairs = matches(manual, automatic);
  const usedAutomatic = new Uint8Array(automatic.length);
  for (const [manualIndex, automaticIndex] of alignedPairs) {
    manual[manualIndex]!.startMs = automatic[automaticIndex]!.startMs;
    manual[manualIndex]!.endMs = automatic[automaticIndex]!.endMs;
    manual[manualIndex]!.automaticIndex = automaticIndex;
    usedAutomatic[automaticIndex] = 1;
  }
  // Some automatic tracks encode a final vocalization such as "Muah" as a
  // single initial after music markers. Accept this only for the last token on
  // both sides; broad one-letter fuzzy matching would corrupt ordinary words.
  const finalManual = manual.at(-1), finalAutomatic = automatic.at(-1);
  if (timingSource === 'youtube-word' && finalManual && finalAutomatic
    && finalManual.automaticIndex === undefined && !usedAutomatic[automatic.length - 1]
    && /^\p{L}$/u.test(finalAutomatic.value) && finalManual.value.length <= 8
    && finalManual.value.startsWith(finalAutomatic.value)) {
    finalManual.startMs = finalAutomatic.startMs;
    finalManual.endMs = finalAutomatic.endMs;
    finalManual.automaticIndex = automatic.length - 1;
    finalManual.estimatedTiming = true;
  }
  const alignedCount = manual.reduce((count, token) => count + Number(token.automaticIndex !== undefined), 0);
  if (timingSource === 'youtube-word' && alignedCount < Math.ceil(manual.length * MIN_GLOBAL_WORD_COVERAGE)) {
    throw new Error('词级字幕与标点正文的整体匹配不足');
  }
  const matchedPrefix = new Uint32Array(manual.length + 1);
  const estimatedPrefix = new Uint32Array(manual.length + 1);
  for (let index = 0; index < manual.length; index++) {
    matchedPrefix[index + 1] = matchedPrefix[index]! + Number(manual[index]!.automaticIndex !== undefined);
    estimatedPrefix[index + 1] = estimatedPrefix[index]! + Number(manual[index]!.estimatedTiming);
  }
  type Candidate = { end: number; startMs: number; endMs: number; duration: number;
    timing: 'youtube-word' | 'youtube-estimated' };
  const candidate = (start: number, end: number): Candidate | null => {
    const first = manual[start], last = manual[end - 1];
    if (!first || !last) return null;
    const matched = matchedPrefix[end]! - matchedPrefix[start]!;
    const exact = first.startMs !== undefined && last.endMs !== undefined
      && matched >= Math.max(1, Math.ceil((end - start) * .6));
    const startMs = exact ? first.startMs : first.estimatedStartMs;
    const sourceEndMs = exact ? last.endMs : last.estimatedEndMs;
    if (startMs === undefined || sourceEndMs === undefined || sourceEndMs <= startMs) return null;
    const next = end < manual.length ? manual[end] : undefined;
    const nextStart = exact ? next?.startMs ?? next?.estimatedStartMs : next?.estimatedStartMs;
    if (end < manual.length && nextStart === undefined) return null;
    let endMs = sourceEndMs;
    if (endMs - startMs < MIN_PHRASE_MS) {
      const paddedEnd = startMs + MIN_PHRASE_MS;
      if (nextStart !== undefined && paddedEnd > nextStart) return null;
      endMs = paddedEnd;
    }
    const duration = endMs - startMs;
    const semanticEnd = sentenceEnds.has(end) || phraseEnds.has(end);
    const maxDuration = semanticEnd ? MAX_SEMANTIC_PHRASE_MS : TARGET_PHRASE_MS;
    if (duration < MIN_PHRASE_MS || duration > maxDuration
      || nextStart !== undefined && endMs > nextStart) return null;
    return { end, startMs, endMs, duration,
      timing: timingSource === 'youtube-estimated' || !exact || estimatedPrefix[end]! > estimatedPrefix[start]!
        ? 'youtube-estimated' : 'youtube-word' };
  };
  // Work backwards and score the complete remaining plan. Six seconds is a
  // target rather than a hard cutoff: sentence and reading boundaries may run
  // longer, while arbitrary word cuts cannot. Crossing a sentence or cutting
  // at an ordinary word is deliberately much more expensive than modestly
  // exceeding the target at a natural boundary.
  const plan: Array<Candidate | null> = Array.from({ length: manual.length + 1 }, () => null);
  const cost = new Float64Array(manual.length + 1); cost.fill(Number.POSITIVE_INFINITY); cost[manual.length] = 0;
  const sentencePrefix = new Uint32Array(manual.length + 1);
  for (let end = 1; end <= manual.length; end++) {
    sentencePrefix[end] = sentencePrefix[end - 1]! + Number(sentenceEnds.has(end));
  }
  for (let start = manual.length - 1; start >= 0; start--) {
    const firstStart = manual[start]!.startMs;
    if (firstStart === undefined) continue;
    let best: Candidate | null = null, bestScore = Number.POSITIVE_INFINITY, bestDistance = Number.POSITIVE_INFINITY;
    for (let end = start + 1; end <= manual.length; end++) {
      const nextTokenStart = manual[end - 1]!.startMs;
      if (nextTokenStart !== undefined && nextTokenStart - firstStart > MAX_SEMANTIC_PHRASE_MS) break;
      if (!Number.isFinite(cost[end])) continue;
      const choice = candidate(start, end);
      if (!choice) continue;
      const rank = sentenceEnds.has(end) ? 0 : phraseEnds.has(end) ? 1 : 2;
      const boundaryPenalty = rank === 0 ? 0 : rank === 1 ? PHRASE_BOUNDARY_PENALTY : WORD_BOUNDARY_PENALTY;
      const crossedSentences = end > start + 1 ? sentencePrefix[end - 1]! - sentencePrefix[start]! : 0;
      const overSeconds = Math.max(0, choice.duration - TARGET_PHRASE_MS) / 1_000;
      const underSeconds = Math.max(0, TARGET_PHRASE_MS - choice.duration) / 1_000;
      const distance = Math.abs(choice.duration - TARGET_PHRASE_MS);
      const score = cost[end]! + boundaryPenalty + crossedSentences * CROSSED_SENTENCE_PENALTY
        + overSeconds * overSeconds + underSeconds * .02;
      if (score < bestScore - 1e-9 || Math.abs(score - bestScore) <= 1e-9 && distance < bestDistance) {
        best = choice; bestScore = score; bestDistance = distance;
      }
    }
    if (best) { plan[start] = best; cost[start] = bestScore; }
  }
  if (!Number.isFinite(cost[0])) throw new Error('字幕未能对齐到可用的自然语段词界');

  const result: TimedPhrase[] = [];
  let start = 0, charStart = 0;
  while (start < manual.length) {
    const choice = plan[start];
    if (!choice) throw new Error('字幕的自然语段计划不完整');
    const charEnd = choice.end < manual.length ? manual[choice.end]!.charStart : display.length;
    const text = display.slice(charStart, charEnd).trim();
    if (!text) throw new Error('词级断句产生空文本');
    result.push({ id: `phrase:${result.length}:${choice.startMs}`, text,
      startMs: choice.startMs, endMs: choice.endMs, timing: choice.timing });
    start = choice.end; charStart = charEnd;
  }
  if (result.map(item => item.text).join('').replace(/\s/gu, '') !== display.replace(/\s/gu, '')) {
    throw new Error('词级断句未完整保留字幕文本');
  }
  if (result.some(item => item.endMs - item.startMs < MIN_PHRASE_MS || item.endMs - item.startMs > MAX_SEMANTIC_PHRASE_MS)) {
    throw new Error('词级断句超出自然语段安全范围');
  }
  return result;
}

export function buildTimedPhrases(cues: RawCue[], timings: WordTiming[]): TimedPhrase[] {
  return buildAlignedTimedPhrases(cues, timings, 'youtube-word');
}

// Supadata supplies canonical cue starts/ends but not word offsets. When the
// independent YouTube word track cannot be aligned, distribute the cue span
// deterministically over its own words. This is explicitly labelled estimated;
// starts remain anchored to the source cue timeline and no text is rewritten.
function estimatedWordTimings(cues: RawCue[]): WordTiming[] {
  const result: WordTiming[] = [];
  let cursorMs = 0;
  for (const cue of cues) {
    const cueTokens = tokens(cue.text, -1);
    if (!cueTokens.length) continue;
    const valid = cue.startMs !== null && cue.endMs !== null && Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs)
      && cue.startMs >= 0 && cue.endMs > cue.startMs;
    const sourceStart = valid ? cue.startMs! : cursorMs;
    const startMs = Math.max(cursorMs, sourceStart);
    const duration = valid ? cue.endMs! - cue.startMs! : Math.max(MIN_PHRASE_MS, cueTokens.length * 450);
    const unit = duration / cueTokens.length;
    for (let index = 0; index < cueTokens.length; index++) {
      const wordStart = startMs + unit * index;
      const slotEnd = startMs + unit * (index + 1);
      result.push({ text: cueTokens[index]!.value, startMs: wordStart,
        endMs: Math.min(slotEnd, wordStart + MAX_SEMANTIC_PHRASE_MS) });
    }
    cursorMs = startMs + duration;
  }
  if (!result.length) throw new Error('字幕没有可用于自然语段分段的文字');
  return result;
}

export function buildEstimatedTimedPhrases(cues: RawCue[]): TimedPhrase[] {
  return buildAlignedTimedPhrases(cues, estimatedWordTimings(cues), 'youtube-estimated');
}

export function phraseTextsFromCues(cues: RawCue[]): string[] {
  return groupSentences(cues).flatMap(group => readingLines(group.text));
}
