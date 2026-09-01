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
  const unitCharEnds: Array<{ end: number; complete: boolean }> = [];
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
      unitCharEnds.push({ end: display.length, complete: sentence.complete });
    }
  }
  const manual = tokens(display, 0);
  if (!manual.length) throw new Error('字幕没有可对齐的单词，已保留原字幕');
  const charEnds = [...new Set([...sentenceCharEnds, ...phraseCharEnds])].sort((a, b) => a - b);
  const tokenEndByChar = new Map<number, number>();
  const charEndByToken = new Map<number, number>();
  let tokenEnd = 0;
  for (const charEnd of charEnds) {
    while (tokenEnd < manual.length && manual[tokenEnd]!.charEnd <= charEnd) tokenEnd++;
    if (tokenEnd) {
      tokenEndByChar.set(charEnd, tokenEnd);
      charEndByToken.set(tokenEnd, charEnd);
    }
  }
  const sentenceEnds = new Set(sentenceCharEnds.map(end => tokenEndByChar.get(end)).filter((end): end is number => end !== undefined));
  const phraseEnds = new Set(phraseCharEnds.map(end => tokenEndByChar.get(end)).filter((end): end is number => end !== undefined));
  const units = unitCharEnds.map(unit => ({ end: tokenEndByChar.get(unit.end), complete: unit.complete }))
    .filter((unit): unit is { end: number; complete: boolean } => unit.end !== undefined);
  return { display, manual, sentenceEnds, phraseEnds, units, charEndByToken };
}

function validateTimings(timings: WordTiming[]) {
  for (let index = 0; index < timings.length; index++) {
    const timing = timings[index]!;
    if (!Number.isFinite(timing.startMs) || !Number.isFinite(timing.endMs) || timing.startMs < 0 || timing.endMs <= timing.startMs
      || index && timing.startMs < timings[index - 1]!.startMs) {
      throw new Error('词级时间顺序异常，已保留原字幕而未猜测重排');
    }
  }
}

type TextPlan = { start: number; end: number; startMs: number; endMs: number; duration: number };

function buildAlignedTimedPhrases(cues: RawCue[], timings: WordTiming[] | null,
  timingSource: 'youtube-word' | 'youtube-estimated'): TimedPhrase[] {
  if (timings) validateTimings(timings);
  const { display, manual, phraseEnds, units, charEndByToken } = timedTextPlan(cues);
  const estimates = estimatedWordTimings(cues);
  if (estimates.length !== manual.length || estimates.some((timing, index) => normalize(timing.text) !== manual[index]!.value)) {
    throw new Error('估算词界无法完整映射字幕文本');
  }
  for (let index = 0; index < manual.length; index++) {
    manual[index]!.estimatedStartMs = estimates[index]!.startMs;
    manual[index]!.estimatedEndMs = estimates[index]!.endMs;
  }

  if (timingSource === 'youtube-word') {
    if (!timings) throw new Error('词级时间缺失');
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
    // single initial after music markers. Accept this only for the last token
    // on both sides, and keep the resulting phrase labelled estimated.
    const finalManual = manual.at(-1), finalAutomatic = automatic.at(-1);
    if (finalManual && finalAutomatic && finalManual.automaticIndex === undefined
      && !usedAutomatic[automatic.length - 1] && /^\p{L}$/u.test(finalAutomatic.value)
      && finalManual.value.length <= 8 && finalManual.value.startsWith(finalAutomatic.value)) {
      finalManual.startMs = finalAutomatic.startMs;
      finalManual.endMs = finalAutomatic.endMs;
      finalManual.automaticIndex = automatic.length - 1;
      finalManual.estimatedTiming = true;
    }
    const alignedCount = manual.reduce((count, token) => count + Number(token.automaticIndex !== undefined), 0);
    if (alignedCount < Math.ceil(manual.length * MIN_GLOBAL_WORD_COVERAGE)) {
      throw new Error('未能对齐：词级字幕与标点正文整体匹配不足');
    }
  }

  const matchedPrefix = new Uint32Array(manual.length + 1);
  const approximatePrefix = new Uint32Array(manual.length + 1);
  const previousMatchedEnd: Array<number | undefined> = Array(manual.length + 1);
  const nextMatchedStart: Array<number | undefined> = Array(manual.length + 1);
  let previousEnd: number | undefined;
  for (let index = 0; index < manual.length; index++) {
    const token = manual[index]!;
    matchedPrefix[index + 1] = matchedPrefix[index]! + Number(token.automaticIndex !== undefined);
    approximatePrefix[index + 1] = approximatePrefix[index]! + Number(token.estimatedTiming);
    previousMatchedEnd[index] = previousEnd;
    if (token.endMs !== undefined) previousEnd = token.endMs;
  }
  previousMatchedEnd[manual.length] = previousEnd;
  let followingStart: number | undefined;
  for (let index = manual.length - 1; index >= 0; index--) {
    if (manual[index]!.startMs !== undefined) followingStart = manual[index]!.startMs;
    nextMatchedStart[index] = followingStart;
  }

  const spanTimes = (start: number, end: number) => {
    const matched = matchedPrefix[end]! - matchedPrefix[start]!;
    const exact = timingSource === 'youtube-word' && matched === end - start
      && approximatePrefix[end]! === approximatePrefix[start]!;
    if (exact) return { startMs: manual[start]!.startMs!, endMs: manual[end - 1]!.endMs!, exact };
    let startMs = timingSource === 'youtube-word'
      ? manual[start]!.startMs ?? previousMatchedEnd[start] ?? manual[start]!.estimatedStartMs!
      : manual[start]!.estimatedStartMs!;
    let endMs = timingSource === 'youtube-word'
      ? (end < manual.length ? manual[end]!.startMs : undefined)
        ?? manual[end - 1]!.endMs ?? nextMatchedStart[end] ?? manual[end - 1]!.estimatedEndMs!
      : manual[end - 1]!.estimatedEndMs!;
    if (endMs <= startMs) {
      startMs = manual[start]!.estimatedStartMs!; endMs = manual[end - 1]!.estimatedEndMs!;
    }
    return { startMs, endMs, exact: false };
  };

  const estimatedSpanTimes = (start: number, end: number) => ({
    startMs: manual[start]!.estimatedStartMs!,
    endMs: manual[end - 1]!.estimatedEndMs!,
    exact: false,
  });

  // Each complete SBD sentence is planned independently. This makes sentence
  // punctuation immutable here; only the explicit sub-two-second pass below
  // may merge a short sentence forward. Unpunctuated units share a run so the
  // textual semantic boundaries can still form usable phrases.
  const planRange = (rangeStart: number, rangeEnd: number): TextPlan[] => {
    const attempt = (rangeTimes: typeof spanTimes): TextPlan[] | null => {
      const whole = rangeTimes(rangeStart, rangeEnd), wholeStart = whole.startMs, wholeEnd = whole.endMs;
      if (wholeEnd - wholeStart < MIN_PHRASE_MS) {
        return [{ start: rangeStart, end: rangeEnd, startMs: wholeStart, endMs: wholeEnd, duration: wholeEnd - wholeStart }];
      }
      const candidate = (start: number, end: number): TextPlan | null => {
        const span = rangeTimes(start, end), startMs = span.startMs;
        const nextStart = end < rangeEnd ? rangeTimes(end, rangeEnd).startMs : undefined;
        const endMs = span.endMs;
        if (endMs <= startMs) return null;
        const duration = endMs - startMs;
        const semanticEnd = end === rangeEnd || phraseEnds.has(end);
        const maxDuration = semanticEnd ? MAX_SEMANTIC_PHRASE_MS : TARGET_PHRASE_MS;
        if (duration < MIN_PHRASE_MS || duration > maxDuration
          || nextStart !== undefined && endMs > nextStart) return null;
        return { start, end, startMs, endMs, duration };
      };
      const plan: Array<TextPlan | null> = Array.from({ length: rangeEnd + 1 }, () => null);
      const cost = new Float64Array(rangeEnd + 1); cost.fill(Number.POSITIVE_INFINITY); cost[rangeEnd] = 0;
      for (let start = rangeEnd - 1; start >= rangeStart; start--) {
        const firstStart = rangeTimes(start, rangeEnd).startMs;
        let best: TextPlan | null = null, bestScore = Number.POSITIVE_INFINITY, bestDistance = Number.POSITIVE_INFINITY;
        for (let end = start + 1; end <= rangeEnd; end++) {
          if (rangeTimes(end - 1, rangeEnd).startMs - firstStart > MAX_SEMANTIC_PHRASE_MS) break;
          if (!Number.isFinite(cost[end])) continue;
          const choice = candidate(start, end);
          if (!choice) continue;
          const rank = end === rangeEnd ? 0 : phraseEnds.has(end) ? 1 : 2;
          const boundaryPenalty = rank === 0 ? 0 : rank === 1 ? PHRASE_BOUNDARY_PENALTY : WORD_BOUNDARY_PENALTY;
          const overSeconds = Math.max(0, choice.duration - TARGET_PHRASE_MS) / 1_000;
          const underSeconds = Math.max(0, TARGET_PHRASE_MS - choice.duration) / 1_000;
          const distance = Math.abs(choice.duration - TARGET_PHRASE_MS);
          const score = cost[end]! + boundaryPenalty + overSeconds * overSeconds + underSeconds * .02;
          if (score < bestScore - 1e-9 || Math.abs(score - bestScore) <= 1e-9 && distance < bestDistance) {
            best = choice; bestScore = score; bestDistance = distance;
          }
        }
        if (best) { plan[start] = best; cost[start] = bestScore; }
      }
      if (!Number.isFinite(cost[rangeStart])) return null;
      const result: TextPlan[] = [];
      let cursor = rangeStart;
      while (cursor < rangeEnd) {
        const choice = plan[cursor];
        if (!choice) return null;
        result.push(choice); cursor = choice.end;
      }
      return result;
    };
    const aligned = attempt(spanTimes);
    if (aligned) return aligned;
    const estimated = timingSource === 'youtube-word' ? attempt(estimatedSpanTimes) : null;
    if (!estimated) {
      const rangeText = display.slice(manual[rangeStart]!.charStart,
        rangeEnd < manual.length ? manual[rangeEnd]!.charStart : display.length).trim();
      throw new Error(`字幕未能对齐到可用的自然语段词界（词 ${rangeStart}-${rangeEnd}：${rangeText.slice(0, 120)}）`);
    }
    return estimated;
  };

  const planned: TextPlan[] = [];
  let unitStart = 0, incompleteStart: number | null = null;
  for (const unit of units) {
    if (unit.complete) {
      if (incompleteStart !== null && incompleteStart < unitStart) planned.push(...planRange(incompleteStart, unitStart));
      incompleteStart = null;
      planned.push(...planRange(unitStart, unit.end));
    } else if (incompleteStart === null) incompleteStart = unitStart;
    unitStart = unit.end;
  }
  if (incompleteStart !== null && incompleteStart < manual.length) planned.push(...planRange(incompleteStart, manual.length));
  if (!planned.length || planned[0]!.start !== 0 || planned.at(-1)!.end !== manual.length) {
    throw new Error('字幕的自然语段计划不完整');
  }

  const textPlans: Array<TextPlan & { text: string }> = [];
  let charStart = 0;
  for (const choice of planned) {
    let charEnd = charEndByToken.get(choice.end)
      ?? (choice.end < manual.length ? manual[choice.end]!.charStart : display.length);
    if (!charEndByToken.has(choice.end)) {
      while (charEnd > charStart && /['"“‘]/u.test(display[charEnd - 1]!)) charEnd--;
    }
    const text = display.slice(charStart, charEnd).trim();
    if (!text) throw new Error('词级断句产生空文本');
    textPlans.push({ ...choice, text }); charStart = charEnd;
  }

  type Resolved = TimedPhrase & { plannedStartMs: number; plannedEndMs: number };
  const resolved: Resolved[] = textPlans.map((item, index) => {
    if (timingSource === 'youtube-estimated') return { id: `phrase:${index}:${item.startMs}`, text: item.text,
      startMs: item.startMs, endMs: item.endMs, timing: 'youtube-estimated',
      plannedStartMs: item.startMs, plannedEndMs: item.endMs };
    const span = spanTimes(item.start, item.end);
    let startMs = span.startMs, endMs = span.endMs;
    let timing: 'youtube-word' | 'youtube-estimated' = span.exact ? 'youtube-word' : 'youtube-estimated';
    if (endMs - startMs < MIN_PHRASE_MS || endMs - startMs > MAX_SEMANTIC_PHRASE_MS || endMs <= startMs) {
      startMs = item.startMs; endMs = item.endMs; timing = 'youtube-estimated';
    }
    return { id: `phrase:${index}:${startMs}`, text: item.text, startMs, endMs, timing,
      plannedStartMs: item.startMs, plannedEndMs: item.endMs };
  });

  // Exact and estimated sources can disagree at a local boundary. Resolve only
  // the overlap: prefer an already sequential local plan, otherwise move or
  // trim the estimated side when it still retains two seconds. If neither side
  // has an independent boundary, keep both text lines in one shared time group.
  const nonOverlapping: Resolved[] = [];
  for (const source of resolved) {
    const current = { ...source };
    const previous = nonOverlapping.at(-1);
    if (previous && current.startMs < previous.endMs) {
      const beforePrevious = nonOverlapping.at(-2);
      const sequentialPlan = previous.timing === 'youtube-estimated' && current.timing === 'youtube-estimated'
        && previous.plannedEndMs <= current.plannedStartMs
        && previous.plannedEndMs - previous.plannedStartMs >= MIN_PHRASE_MS
        && current.plannedEndMs - current.plannedStartMs >= MIN_PHRASE_MS
        && (!beforePrevious || previous.plannedStartMs >= beforePrevious.endMs);
      if (sequentialPlan) {
        previous.startMs = previous.plannedStartMs; previous.endMs = previous.plannedEndMs;
        current.startMs = current.plannedStartMs; current.endMs = current.plannedEndMs;
      }
      if (current.startMs < previous.endMs && current.timing === 'youtube-estimated'
        && current.endMs - previous.endMs >= MIN_PHRASE_MS) {
        current.startMs = previous.endMs;
      } else if (current.startMs < previous.endMs && previous.timing === 'youtube-estimated'
        && current.startMs - previous.startMs >= MIN_PHRASE_MS) {
        previous.endMs = current.startMs;
      } else if (current.startMs < previous.endMs
        && Math.max(previous.endMs, current.endMs) - Math.min(previous.startMs, current.startMs) <= MAX_SEMANTIC_PHRASE_MS) {
        previous.text = `${previous.text}\n${current.text}`;
        previous.startMs = Math.min(previous.startMs, current.startMs);
        previous.endMs = Math.max(previous.endMs, current.endMs);
        previous.plannedEndMs = current.plannedEndMs;
        previous.timing = previous.timing === 'youtube-word' && current.timing === 'youtube-word'
          ? 'youtube-word' : 'youtube-estimated';
        continue;
      }
      if (current.startMs < previous.endMs) throw new Error('相邻自然语段的时间无法安全消除重叠');
    }
    nonOverlapping.push(current);
  }

  // The two-second minimum is the only time rule allowed to merge complete
  // text units. A nearby short phrase joins forward; across a long gap or when
  // merging would exceed the safety ceiling, retain its planned estimated span.
  const result: TimedPhrase[] = [];
  for (let index = 0; index < nonOverlapping.length; index++) {
    let current = { ...nonOverlapping[index]! };
    while (current.endMs - current.startMs < MIN_PHRASE_MS) {
      const next = nonOverlapping[index + 1];
      if (next && next.startMs - current.endMs <= 1_500
        && next.endMs - current.startMs <= MAX_SEMANTIC_PHRASE_MS) {
        current = { ...current, text: `${current.text}\n${next.text}`, endMs: next.endMs,
          plannedEndMs: next.plannedEndMs,
          timing: current.timing === 'youtube-word' && next.timing === 'youtube-word' ? 'youtube-word' : 'youtube-estimated' };
        index++;
        continue;
      }
      const paddedEnd = current.startMs + MIN_PHRASE_MS;
      if (!next || paddedEnd <= next.startMs) current.endMs = paddedEnd;
      else { current.startMs = current.plannedStartMs; current.endMs = current.plannedEndMs; }
      current.timing = 'youtube-estimated';
      break;
    }
    result.push({ id: `phrase:${result.length}:${current.startMs}`, text: current.text,
      startMs: current.startMs, endMs: current.endMs, timing: current.timing });
  }
  if (result.map(item => item.text).join('').replace(/\s/gu, '') !== display.replace(/\s/gu, '')) {
    throw new Error('词级断句未完整保留字幕文本');
  }
  if (result.some((item, index) => item.endMs - item.startMs < MIN_PHRASE_MS
    || item.endMs - item.startMs > MAX_SEMANTIC_PHRASE_MS
    || index > 0 && item.startMs < result[index - 1]!.endMs)) {
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
  return buildAlignedTimedPhrases(cues, null, 'youtube-estimated');
}

export function phraseTextsFromCues(cues: RawCue[]): string[] {
  return groupSentences(cues).flatMap(group => readingLines(group.text));
}
