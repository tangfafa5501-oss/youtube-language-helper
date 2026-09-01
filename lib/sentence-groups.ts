import sbd from 'sbd';
import type { RawCue } from './captions.ts';

const MAX_SHORT_MERGE_GAP_MS = 1_500;
const MAX_SBD_RUN_TEXT = 500_000;

export type CaptionGroup = {
  id: string;
  text: string;
  startMs: number | null;
  endMs: number | null;
  cues: [RawCue, ...RawCue[]];
  notice: string | null;
};

function joinText(cues: RawCue[]) {
  const parts: string[] = [], ends: number[] = [];
  let length = 0;
  for (const [i, cue] of cues.entries()) {
    const separator = i && !/\s$/.test(cues[i - 1]!.text) && !/^\s/.test(cue.text) ? ' ' : '';
    parts.push(separator, cue.text); length += separator.length + cue.text.length; ends.push(length);
  }
  return { text: parts.join(''), ends };
}

function group(cues: RawCue[], notice: string | null = null): CaptionGroup {
  const first = cues[0];
  if (!first) throw new Error('字幕组不能为空');
  let endMs: number | null = 0;
  for (const cue of cues) {
    if (cue.endMs === null) { endMs = null; break; }
    endMs = Math.max(endMs!, cue.endMs);
  }
  return { id: `sbd:${first.cueId}:${cues.at(-1)!.cueId}`, text: joinText(cues).text,
    startMs: first.startMs, endMs, cues: cues as [RawCue, ...RawCue[]], notice };
}

export function rawCaptionGroups(cues: RawCue[]): CaptionGroup[] {
  return cues.map(cue => group([cue], cue.timingIssue));
}

function groupRun(cues: RawCue[]): CaptionGroup[] {
  if (!cues.length) return [];
  const { text, ends } = joinText(cues);
  if (text.length > MAX_SBD_RUN_TEXT) return cues.map(cue => group([cue], '连续字幕文本过长，按原条目时间显示'));
  let sentences: string[];
  try {
    sentences = sbd.sentences(text, { preserve_whitespace: true, newline_boundaries: false,
      html_boundaries: false, sanitize: false });
  } catch { sentences = []; }
  // SBD determines boundaries, never supplies replacement caption text. Fail
  // safely if an upstream edge case loses/reorders characters or punctuation.
  if (!sentences.length || sentences.join('') !== text) {
    return cues.map(cue => group([cue], '断句结果无法完整映射原文，保留原始条目'));
  }
  const groups: CaptionGroup[] = [];
  const append = (members: RawCue[], notice: string | null) => {
    // SBD emits trailing text even when it found no sentence boundary. That
    // remainder is not evidence that hundreds of raw captions form one sentence.
    if (!/[.!?][\s"'”’\)\]\}]*$/u.test(joinText(members).text)) {
      for (const cue of members) groups.push(group([cue], '缺少句末标点，按原条目时间分组'));
    } else {
      groups.push(group(members, notice));
    }
  };
  let offset = 0, cueIndex = 0, first = 0, internalBoundary = false;
  for (const sentence of sentences) {
    offset += sentence.length;
    const boundary = offset - (sentence.length - sentence.trimEnd().length);
    while (cueIndex < ends.length - 1 && ends[cueIndex]! < boundary) cueIndex++;
    if (text.slice(boundary, ends[cueIndex]).trim()) {
      internalBoundary = true;
      continue; // No word timing: a raw cue is indivisible.
    }
    if (cueIndex < first) continue;
    append(cues.slice(first, cueIndex + 1), internalBoundary
      ? '句界位于原条目内部；缺少句内时间，保留为同组' : null);
    first = cueIndex + 1; internalBoundary = false;
  }
  if (first < cues.length) append(cues.slice(first), '末尾按原条目时间保留');

  // Only a <2s sentence joins its successor. An exact two-second sentence is
  // already within the accepted range; an isolated final short sentence stays.
  const merged: CaptionGroup[] = [];
  for (let i = 0; i < groups.length; i++) {
    const current = groups[i]!;
    const members = [...current.cues];
    let endMs = current.endMs, notice = current.notice;
    while (i + 1 < groups.length && current.startMs !== null && endMs !== null
      && endMs - current.startMs < 2000
      && groups[i + 1]!.startMs !== null && groups[i + 1]!.startMs! - endMs <= MAX_SHORT_MERGE_GAP_MS) {
      const next = groups[++i]!;
      for (const cue of next.cues) members.push(cue);
      endMs = next.endMs === null ? null : Math.max(endMs, next.endMs);
      notice ??= next.notice;
    }
    merged.push(members.length === current.cues.length ? current : group(members, notice));
  }
  return merged;
}

export function groupSentences(cues: RawCue[]): CaptionGroup[] {
  const result: CaptionGroup[] = [];
  let run: RawCue[] = [];
  const flush = () => { result.push(...groupRun(run)); run = []; };
  for (const cue of cues) {
    // Invalid/empty cues remain visible and are hard barriers. Do not infer a
    // duration or reorder decreasing timestamps to make a cleaner sentence.
    if (cue.timingIssue || cue.startMs === null || cue.endMs === null || cue.endMs <= cue.startMs || !cue.text.trim()) {
      flush(); result.push(group([cue], cue.timingIssue ?? '时间或文本异常；保留原始条目')); continue;
    }
    if (run.length && cue.startMs < run.at(-1)!.startMs!) flush();
    run.push(cue);
  }
  flush(); return result;
}
