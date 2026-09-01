import { record, type RawCue } from './captions.ts';
import { groupSentences, type CaptionGroup } from './sentence-groups.ts';
import { signedPlayerUrl } from './bilibili-wbi.ts';
import type { TimedPhrase } from './timed-phrases.ts';

export type BiliTrack = { id: string; name: string; language: string; kind: 'manual' | 'asr'; url: string;
  secondary?: { id: string; name: string; language: string; url: string } };
const MAX_BILI_PHRASE_MS = 6_000;
const BVID_ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
const BVID_XOR = 23_442_827_791_579n;
const MAX_AID = 1n << 51n;

export function bvidToAid(bvid: string) {
  if (!/^BV1[0-9A-Za-z]{9}$/.test(bvid)) return null;
  const chars = [...bvid];
  [chars[3], chars[9]] = [chars[9]!, chars[3]!];
  [chars[4], chars[7]] = [chars[7]!, chars[4]!];
  let encoded = 0n;
  for (const char of chars.slice(3)) {
    const index = BVID_ALPHABET.indexOf(char);
    if (index < 0) return null;
    encoded = encoded * 58n + BigInt(index);
  }
  const aid = (encoded & (MAX_AID - 1n)) ^ BVID_XOR;
  return aid > 0n && aid <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(aid) : null;
}

function subtitleUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 4000) return null;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || !(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com') || url.hostname.endsWith('.hdslb.com'))) return null;
    return url.href;
  } catch { return null; }
}
export function isBiliTrack(value: unknown): value is BiliTrack {
  if (!record(value) || typeof value.id !== 'string' || value.id.length > 500 || typeof value.name !== 'string' || value.name.length > 500
    || typeof value.language !== 'string' || value.language.length > 100 || (value.kind !== 'manual' && value.kind !== 'asr') || subtitleUrl(value.url) !== value.url) return false;
  if (value.secondary === undefined) return true;
  return record(value.secondary) && typeof value.secondary.id === 'string' && value.secondary.id.length <= 500
    && typeof value.secondary.name === 'string' && value.secondary.name.length <= 500
    && typeof value.secondary.language === 'string' && value.secondary.language.length <= 100
    && subtitleUrl(value.secondary.url) === value.secondary.url;
}
export function biliVideo(url: string) {
  try {
    const parsed = new URL(url); if (parsed.origin !== 'https://www.bilibili.com') return null;
    const bvid = parsed.href.match(/BV[0-9A-Za-z]{10}/)?.[0]; if (!bvid) return null;
    const page = Math.max(1, Number(parsed.searchParams.get('p')) || 1); return { bvid, page };
  } catch { return null; }
}
async function envelope(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { credentials: 'include', signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 429 ? 'B 站请求过于频繁，已停止自动重试；请稍后刷新视频' : `B站接口请求失败：HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!record(payload) || payload.code !== 0 || !record(payload.data)) throw new Error(typeof payload === 'object' && payload && 'message' in payload ? String(payload.message) : 'B站接口返回异常');
  return payload.data;
}
export async function biliMetadata(bvid: string, page: number, signal?: AbortSignal) {
  const data = await envelope(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, signal);
  const pages = Array.isArray(data.pages) ? data.pages.filter(record) : [];
  const target = pages.find(item => item.page === page) ?? pages[0];
  const aid = Number(data.aid), cid = Number(target?.cid ?? data.cid);
  if (!Number.isFinite(aid) || !Number.isFinite(cid) || !cid) throw new Error('B站视频缺少 aid/cid');
  return { aid, cid, title: String(target?.part ?? data.title ?? '').slice(0, 1000) };
}
export async function biliTracks(bvid: string, aid: number, cid: number, signal?: AbortSignal): Promise<{ tracks: BiliTrack[]; needLogin: boolean }> {
  const data = await envelope(await signedPlayerUrl({ aid, cid, bvid }, signal), signal);
  const raw = record(data.subtitle) && Array.isArray(data.subtitle.subtitles) ? data.subtitle.subtitles : [];
  const tracks: BiliTrack[] = raw.filter(record).flatMap((item, index) => {
    const url = subtitleUrl(item.subtitle_url);
    if (!url) return [];
    const language = String(item.lan ?? ''), name = String(item.lan_doc ?? (language || `字幕 ${index + 1}`));
    const automatic = Number(item.ai_status) > 0 || Number(item.ai_type) > 0 || language.startsWith('ai-');
    const kind: BiliTrack['kind'] = automatic ? 'asr' : 'manual';
    return [{ id: `bili:${String(item.id ?? index)}`, name, language, kind, url }];
  });
  const preferred = (items: BiliTrack[]) => [...items].sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  const english = preferred(tracks.filter(track => /^en(?:-|$)/i.test(track.language)));
  const chineseRank = (track: BiliTrack) => {
    const label = `${track.language} ${track.name}`;
    if (/zh-Hans|简体/i.test(label)) return 0;
    if (/zh-CN|中国/i.test(label)) return 1;
    if (/zh-Hant|繁体/i.test(label)) return 2;
    return 3;
  };
  const chinese = [...tracks.filter(track => /^(?:zh|ai-zh)(?:-|$)/i.test(track.language))]
    .sort((a, b) => chineseRank(a) - chineseRank(b) || Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  if (english && chinese && !tracks.some(track => /双语|中英|bilingual/i.test(track.name))) {
    tracks.push({ id: `bili:dual:${english.id}:${chinese.id}`, name: `${english.name} + ${chinese.name}（网站双语）`,
      language: `${english.language}+${chinese.language}`, kind: english.kind === 'manual' && chinese.kind === 'manual' ? 'manual' : 'asr',
      url: english.url, secondary: { id: chinese.id, name: chinese.name, language: chinese.language, url: chinese.url } });
  }
  return { tracks, needLogin: Boolean(data.need_login_subtitle) };
}
export function chooseBiliTrack(tracks: BiliTrack[]) {
  const preference = (track: BiliTrack) => {
    if (/双语|中英|bilingual/i.test(track.name)) return 0;
    const rank = ['zh-CN','zh-Hans','zh-Hant','zh','ai-zh','en-US','en','ai-en'].indexOf(track.language);
    return (rank < 0 ? 20 : rank + 1) + (track.kind === 'asr' ? .5 : 0);
  };
  return [...tracks].sort((a, b) => preference(a) - preference(b))[0];
}
async function fetchBiliCues(url: string, trackId: string, signal?: AbortSignal): Promise<RawCue[]> {
  const response = await fetch(url, { credentials: 'omit', signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`B站字幕下载失败：HTTP ${response.status}`);
  const payload: unknown = await response.json();
  if (!record(payload) || !Array.isArray(payload.body) || payload.body.length > 40_000) throw new Error('B站字幕结构异常');
  const cues = payload.body.map((item, index): RawCue | null => {
    if (!record(item)) return null;
    const start = Number(item.from), end = Number(item.to), text = String(item.content ?? '');
    const valid = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start;
    return { cueId: `${trackId}:${index}`, sourceIndex: index, text, startMs: valid ? Math.round(start * 1000) : null,
      endMs: valid ? Math.round(end * 1000) : null, timingSource: 'start+duration', timingIssue: valid ? null : '缺少或非法时间', raw: item };
  }).filter((cue): cue is RawCue => cue !== null);
  if (!cues.length) throw new Error('B站字幕为空'); return cues;
}
function validTime(cue: RawCue): cue is RawCue & { startMs: number; endMs: number } {
  return cue.startMs !== null && cue.endMs !== null && cue.endMs > cue.startMs;
}
export function pairBiliCues(primary: RawCue[], secondary: RawCue[], trackId = 'bili:dual'): RawCue[] {
  const output: RawCue[] = []; let left = 0, right = 0;
  const emit = (a: RawCue[], b: RawCue[]) => {
    const timed = [...a, ...b].filter(validTime);
    output.push({ cueId: `${trackId}:${output.length}`, sourceIndex: output.length,
      text: [a.map(cue => cue.text).filter(Boolean).join(' '), b.map(cue => cue.text).filter(Boolean).join(' ')].filter(Boolean).join('\n'),
      startMs: timed.length ? Math.min(...timed.map(cue => cue.startMs)) : null,
      endMs: timed.length ? Math.max(...timed.map(cue => cue.endMs)) : null,
      timingSource: 'start+duration', timingIssue: timed.length ? null : '缺少或非法时间',
      raw: { primary: a.map(cue => cue.raw), secondary: b.map(cue => cue.raw) } });
  };
  while (left < primary.length && right < secondary.length) {
    const first = primary[left]!, second = secondary[right]!;
    if (!validTime(first)) { emit([first], []); left++; continue; }
    if (!validTime(second)) { emit([], [second]); right++; continue; }
    if (first.endMs < second.startMs - 500) { emit([first], []); left++; continue; }
    if (second.endMs < first.startMs - 500) { emit([], [second]); right++; continue; }
    const a = [first], b = [second]; left++; right++;
    let aEnd = first.endMs, bEnd = second.endMs;
    const groupStart = Math.min(first.startMs, second.startMs);
    while (Math.abs(aEnd - bEnd) > 750) {
      const nextPrimary = primary[left], nextSecondary = secondary[right];
      if (aEnd < bEnd && nextPrimary && validTime(nextPrimary) && nextPrimary.startMs <= bEnd + 250
        && Math.max(bEnd, nextPrimary.endMs) - groupStart <= MAX_BILI_PHRASE_MS) {
        aEnd = Math.max(aEnd, nextPrimary.endMs); a.push(nextPrimary); left++; continue;
      }
      if (bEnd < aEnd && nextSecondary && validTime(nextSecondary) && nextSecondary.startMs <= aEnd + 250
        && Math.max(aEnd, nextSecondary.endMs) - groupStart <= MAX_BILI_PHRASE_MS) {
        bEnd = Math.max(bEnd, nextSecondary.endMs); b.push(nextSecondary); right++; continue;
      }
      break;
    }
    emit(a, b);
  }
  while (left < primary.length) { const cue = primary[left++]; if (cue) emit([cue], []); }
  while (right < secondary.length) { const cue = secondary[right++]; if (cue) emit([], [cue]); }
  return output;
}
export async function biliCues(track: BiliTrack, signal?: AbortSignal): Promise<RawCue[]> {
  const primary = await fetchBiliCues(track.url, track.id, signal);
  if (!track.secondary) return primary;
  const secondary = await fetchBiliCues(track.secondary.url, track.secondary.id, signal);
  return pairBiliCues(primary, secondary, track.id);
}

function joinCueText(cues: RawCue[]) {
  let text = '';
  for (const cue of cues) {
    const next = cue.text.replace(/\s+/gu, ' ').trim();
    if (!next) continue;
    text += text && !/\s$/u.test(text) && !/^[,.;:!?\)\]\}，。；：！？、]/u.test(next) ? ` ${next}` : next;
  }
  return text;
}

function laneText(value: unknown) {
  if (!Array.isArray(value)) return '';
  return value.flatMap(item => record(item) && (typeof item.content === 'string' || typeof item.text === 'string')
    ? [String(item.content ?? item.text).replace(/\s+/gu, ' ').trim()] : []).filter(Boolean).join(' ');
}

function comparableWord(word: string) {
  return word.toLocaleLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function rollingDelta(previous: string, current: string) {
  const next = current.replace(/\s+/gu, ' ').trim();
  if (!previous || !next) return next;
  const leftWords = previous.split(/\s+/u), rightWords = next.split(/\s+/u);
  const maxWords = Math.min(leftWords.length, rightWords.length);
  for (let count = maxWords; count >= 1; count--) {
    const left = leftWords.slice(-count).map(comparableWord);
    const right = rightWords.slice(0, count).map(comparableWord);
    const matchedCharacters = right.join('').length;
    if ((count >= 3 || matchedCharacters >= 14) && left.every((word, index) => word && word === right[index])) {
      return rightWords.slice(count).join(' ');
    }
  }
  const compactPrevious = previous.replace(/\s+/gu, ''), compactNext = next.replace(/\s+/gu, '');
  const maxCharacters = Math.min(compactPrevious.length, compactNext.length);
  for (let count = maxCharacters; count >= 6; count--) {
    if (compactPrevious.slice(-count) === compactNext.slice(0, count)
      && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(compactNext.slice(0, count))) {
      return compactNext.slice(count);
    }
  }
  return next;
}

type DisplayLane = { primary: string; secondary: string };

function bilingualDisplayCues(cues: RawCue[]) {
  const lanes = new Map<string, DisplayLane>();
  const display: RawCue[] = [];
  let previousPrimary = '', previousSecondary = '', found = false;
  for (const cue of cues) {
    const paired = record(cue.raw) && Array.isArray(cue.raw.primary) && Array.isArray(cue.raw.secondary);
    if (!paired) { display.push(cue); continue; }
    found = true;
    const primary = laneText(cue.raw.primary), secondary = laneText(cue.raw.secondary);
    const delta = { primary: rollingDelta(previousPrimary, primary), secondary: rollingDelta(previousSecondary, secondary) };
    if (primary) previousPrimary = primary;
    if (secondary) previousSecondary = secondary;
    if (!delta.primary && !delta.secondary) {
      const last = display.at(-1);
      if (last && last.endMs !== null && cue.endMs !== null) last.endMs = Math.max(last.endMs, cue.endMs);
      continue;
    }
    const derived = { ...cue, text: delta.primary || delta.secondary };
    lanes.set(derived.cueId, delta); display.push(derived);
  }
  return found ? { cues: display, lanes } : null;
}

function splitBiliGroup(group: CaptionGroup) {
  const chunks: RawCue[][] = [];
  let current: RawCue[] = [];
  for (const cue of group.cues) {
    const start = current[0]?.startMs;
    const end = cue.endMs;
    if (current.length && start !== null && start !== undefined && end !== null && end - start > MAX_BILI_PHRASE_MS) {
      chunks.push(current); current = [];
    }
    current.push(cue);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function biliPhrases(cues: RawCue[]): TimedPhrase[] {
  const bilingual = bilingualDisplayCues(cues);
  const groups = groupSentences(bilingual?.cues ?? cues);
  const phrases: TimedPhrase[] = [];
  for (const group of groups) for (const members of splitBiliGroup(group)) {
    const startMs = members[0]?.startMs, endMs = members.reduce<number | null>((end, cue) => cue.endMs === null ? end : Math.max(end ?? cue.endMs, cue.endMs), null);
    if (startMs === null || startMs === undefined || endMs === null || endMs <= startMs) continue;
    const primary = bilingual ? joinCueText(members.map(cue => ({ ...cue, text: bilingual.lanes.get(cue.cueId)?.primary ?? '' }))) : '';
    const secondary = bilingual ? joinCueText(members.map(cue => ({ ...cue, text: bilingual.lanes.get(cue.cueId)?.secondary ?? '' }))) : '';
    const text = bilingual ? [primary, secondary].filter(Boolean).join('\n') : joinCueText(members);
    if (!text) continue;
    phrases.push({ id: `bili-phrase:${phrases.length}:${startMs}`, text, startMs, endMs, timing: 'bilibili-cue' });
  }
  return phrases;
}
