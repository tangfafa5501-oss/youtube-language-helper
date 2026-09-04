import { diffWords, type Change } from 'diff';

export type PracticeSegment = {
  videoId: string; session: string; trackId: string; startMs: number; endMs: number; text: string;
  language?: string;
};
// History survives reconnects; live work is additionally bound to a session.
export function practiceKey(segment: PracticeSegment) {
  return JSON.stringify([segment.videoId, segment.trackId, segment.startMs, segment.endMs, segment.text]);
}
export function livePracticeKey(segment: PracticeSegment) { return `${segment.session}:${practiceKey(segment)}`; }
export function normalizeDictation(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[.,!?;:'"()[\]{}<>—–\-“”‘’。，！？；：]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
export function wordCount(text: string) { return text.trim().split(/\s+/u).filter(Boolean).length; }
export type DictationResult = { changes: Change[]; correct: number; missed: number; extra: number; accuracy: number; passed: boolean };
export function checkDictation(reference: string, input: string): DictationResult {
  const changes = diffWords(normalizeDictation(reference), normalizeDictation(input));
  let correct = 0, missed = 0, extra = 0;
  for (const change of changes) {
    const count = wordCount(change.value);
    if (change.added) extra += count; else if (change.removed) missed += count; else correct += count;
  }
  const total = correct + missed + extra;
  return { changes, correct, missed, extra, accuracy: total ? Math.round(correct / total * 100) : 0,
    passed: correct > 0 && missed === 0 && extra === 0 };
}

export function segmentFromRows(rows: { id: string; startMs: number; endMs: number; text: string }[], startId: unknown, endId?: unknown) {
  const first = rows.findIndex(row => row.id === startId);
  const last = endId === undefined ? first : rows.findIndex(row => row.id === endId);
  if (first < 0 || last < first) return null;
  const start = rows[first]!, end = rows[last]!;
  if (start.startMs < 0 || end.endMs <= start.startMs || end.endMs - start.startMs > 60_000) return null;
  return { startMs: start.startMs, endMs: end.endMs, text: rows.slice(first, last + 1).map(row => row.text).join(' ') };
}
