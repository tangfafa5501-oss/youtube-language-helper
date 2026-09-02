import { captionUrl, record } from './captions.ts';
import type { RawCue } from './captions.ts';
import type { TimedPhrase } from './protocol.ts';
import { groupSentences } from './sentence-groups.ts';

export const YOUTUBE_NATIVE_CHANNEL = 'ylh-youtube-native-v1';
export const YOUTUBE_NATIVE_CACHE_KEY = 'youtube-native-cache-v1';

export type NativeTrackKind = 'manual' | 'asr';
export type NativeTranscriptFormat = 'youtube-timedtext-json3' | 'youtube-timedtext-xml';
export type NativeAuth = { pot?: string; potc?: string; capturedAt: number };
export type NativeTranscript = {
  videoId: string;
  language: string;
  kind: NativeTrackKind;
  body: string;
  format: NativeTranscriptFormat;
  requestCompletedAt?: number;
  capturedAt: number;
};

const VIDEO_ID = /^[\w-]{11}$/;
const LANGUAGE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/;
const CLIENT_KEYS = new Set(['c', 'cver', 'cos', 'cosver', 'cplatform', 'cbr', 'cbrver', 'cplayer', 'xorb', 'xobt', 'xovt']);
const MIN_DISPLAY_ROW_MS = 2_000;
const MAX_SHORT_MERGE_GAP_MS = 1_500;

export function normalizeNativeLanguage(value: string) {
  return value.trim().replaceAll('_', '-').toLowerCase();
}

export function nativeTrackKey(videoId: string, language: string, kind: NativeTrackKind) {
  return `${videoId}:${normalizeNativeLanguage(language)}:${kind}`;
}

export function observedTimedText(url: string) {
  try {
    if (url.length > 100_000) return null;
    const parsed = new URL(url);
    if (parsed.origin !== 'https://www.youtube.com' || parsed.pathname !== '/api/timedtext' || parsed.username || parsed.password) return null;
    const videoId = parsed.searchParams.get('v') ?? '';
    const language = parsed.searchParams.get('tlang') || parsed.searchParams.get('lang') || '';
    if (!VIDEO_ID.test(videoId) || !LANGUAGE.test(language)) return null;
    const kind: NativeTrackKind = (parsed.searchParams.get('kind') || parsed.searchParams.get('type') || '').toLowerCase() === 'asr' ? 'asr' : 'manual';
    const bounded = (value: string | null) => value && value.length <= 20_000 ? value : undefined;
    return { videoId, language, kind, url: parsed.href, pot: bounded(parsed.searchParams.get('pot')), potc: bounded(parsed.searchParams.get('potc')) };
  } catch { return null; }
}

export function timedTextFormat(body: string): NativeTranscriptFormat {
  return body.trimStart().startsWith('{') ? 'youtube-timedtext-json3' : 'youtube-timedtext-xml';
}

export function applyNativeAuth(baseUrl: string, videoId: string, auth: NativeAuth | null,
  client: unknown): string | null {
  const safe = captionUrl(baseUrl, videoId);
  if (!safe) return null;
  const url = new URL(safe);
  if (record(client)) {
    for (const [key, value] of Object.entries(client)) {
      if (CLIENT_KEYS.has(key) && typeof value === 'string' && value.length > 0 && value.length <= 200 && !url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }
  }
  if (auth && Date.now() - auth.capturedAt <= 10 * 60_000) {
    if (auth.pot && !url.searchParams.has('pot')) url.searchParams.set('pot', auth.pot);
    if (auth.potc && !url.searchParams.has('potc')) url.searchParams.set('potc', auth.potc);
  }
  return url.href.length <= 100_000 ? url.href : null;
}

export function validNativeTranscript(value: unknown): value is NativeTranscript {
  return record(value) && typeof value.videoId === 'string' && VIDEO_ID.test(value.videoId)
    && typeof value.language === 'string' && LANGUAGE.test(value.language)
    && (value.kind === 'manual' || value.kind === 'asr')
    && typeof value.body === 'string' && value.body.length > 0 && value.body.length <= 8_000_000
    && (value.format === 'youtube-timedtext-json3' || value.format === 'youtube-timedtext-xml')
    && (value.requestCompletedAt === undefined || typeof value.requestCompletedAt === 'number'
      && Number.isFinite(value.requestCompletedAt) && value.requestCompletedAt > 0)
    && typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt) && value.capturedAt > 0;
}

export function chooseNativeTranscript(entries: readonly NativeTranscript[], videoId: string, language: string, kind: NativeTrackKind) {
  const wanted = normalizeNativeLanguage(language);
  const base = wanted.split('-')[0];
  const candidates = [...entries]
    .filter(entry => entry.videoId === videoId && entry.kind === kind)
    .sort((left, right) => right.capturedAt - left.capturedAt);
  const exact = candidates.find(entry => normalizeNativeLanguage(entry.language) === wanted);
  if (exact || wanted.includes('-')) return exact ?? null;
  const compatible = candidates.filter(entry => normalizeNativeLanguage(entry.language).split('-')[0] === base);
  const languages = new Set(compatible.map(entry => normalizeNativeLanguage(entry.language)));
  return languages.size === 1 ? compatible[0] ?? null : null;
}

export function boundedNativeCache(entries: readonly NativeTranscript[]) {
  const output: NativeTranscript[] = [];
  const keys = new Set<string>();
  let characters = 0;
  for (const entry of [...entries].filter(validNativeTranscript).sort((left, right) => right.capturedAt - left.capturedAt)) {
    const key = nativeTrackKey(entry.videoId, entry.language, entry.kind);
    if (keys.has(key) || output.length >= 8 || characters + entry.body.length > 7_500_000) continue;
    keys.add(key); characters += entry.body.length; output.push(entry);
  }
  return output;
}

// Reading rows are display-only: SBD restores complete sentences across
// YouTube ASR event boundaries, while raw cues stay available unchanged.
export function nativeDisplayPhrases(cues: readonly RawCue[]): TimedPhrase[] {
  // YouTube rolling JSON3 commonly inserts timed `"\n"` events between every
  // visible ASR text event. They are layout signals, not spoken pauses or
  // sentence boundaries. Keep them in raw cues, but exclude them from the
  // display-only sentence grouping or every rolling caption becomes a row.
  const ordered = [...cues].filter(cue => cue.startMs !== null && cue.text.trim())
    .sort((left, right) => left.startMs! - right.startMs! || left.sourceIndex - right.sourceIndex);
  const nextStarts = new Array<number | null>(ordered.length).fill(null);
  let nextGreater: number | null = null;
  for (let end = ordered.length - 1; end >= 0;) {
    const start = ordered[end]!.startMs!; let first = end;
    while (first > 0 && ordered[first - 1]!.startMs === start) first--;
    for (let index = first; index <= end; index++) nextStarts[index] = nextGreater;
    nextGreater = start; end = first - 1;
  }
  const displayCues = ordered.map((cue, index) => {
    const nextStart = nextStarts[index]!;
    const endMs = cue.endMs !== null && cue.endMs > cue.startMs! ? cue.endMs : nextStart;
    return { ...cue, endMs };
  });
  const groups: ReturnType<typeof groupSentences> = [];
  let run: RawCue[] = [];
  const flush = () => { groups.push(...groupSentences(run)); run = []; };
  for (const cue of displayCues) {
    const previous = run.at(-1);
    if (previous?.endMs !== null && previous?.endMs !== undefined && cue.startMs !== null
      && cue.startMs - previous.endMs > MAX_SHORT_MERGE_GAP_MS) flush();
    run.push(cue);
  }
  flush();
  const rows: TimedPhrase[] = groups.flatMap(group => {
    const text = group.text.replace(/\s+/gu, ' ').trim();
    if (!text || group.startMs === null || group.endMs === null || group.endMs <= group.startMs) return [];
    return [{ id: `youtube-native:${group.id}`, text, startMs: group.startMs, endMs: group.endMs,
      timing: 'youtube-native' as const }];
  });
  for (let index = 0; index < rows.length;) {
    const current = rows[index]!, next = rows[index + 1]!;
    if (current.endMs - current.startMs >= MIN_DISPLAY_ROW_MS) { index++; continue; }
    const minimumEnd = current.startMs + MIN_DISPLAY_ROW_MS;
    if (next && next.startMs < minimumEnd) {
      const separator = /^[,.;:!?\)\]\}，。；：！？、]/u.test(next.text) ? '' : ' ';
      rows.splice(index, 2, { ...current, id: `${current.id}+${next.id}`,
        text: `${current.text}${separator}${next.text}`, endMs: Math.max(current.endMs, next.endMs) });
      continue;
    }
    rows[index] = { ...current, endMs: minimumEnd, timing: 'youtube-estimated' };
    index++;
  }
  return rows;
}
