import { record, type RawCue } from './captions.ts';
import { groupSentences, type CaptionGroup } from './sentence-groups.ts';
import { signedPlayerUrl } from './bilibili-wbi.ts';
import { selectBilibiliSubtitlePriority } from './bilibili-ocr.ts';
import type { TimedPhrase } from './protocol.ts';

export type BiliTrack = { id: string; name: string; language: string; kind: 'manual' | 'asr'; url: string;
  secondary?: { id: string; name: string; language: string; url: string } };

function chineseTrackRank(track: BiliTrack) {
  const label = `${track.language} ${track.name}`;
  if (/zh-Hans|简体/i.test(label)) return 0;
  if (/zh-CN|中国/i.test(label)) return 1;
  if (/zh-Hant|繁体/i.test(label)) return 2;
  return 3;
}
const MAX_BILI_PHRASE_MS = 6_000;
const MAX_BILI_RESPONSE_BYTES = 8_000_000;
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
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !(url.hostname === 'bilibili.com' || url.hostname.endsWith('.bilibili.com') || url.hostname.endsWith('.hdslb.com'))) return null;
    return url.href;
  } catch { return null; }
}
export function isBiliTrack(value: unknown): value is BiliTrack {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 500 || typeof value.name !== 'string' || value.name.length > 500
    || typeof value.language !== 'string' || value.language.length > 100 || (value.kind !== 'manual' && value.kind !== 'asr') || subtitleUrl(value.url) !== value.url) return false;
  if (value.secondary === undefined) return true;
  return record(value.secondary) && typeof value.secondary.id === 'string' && !!value.secondary.id && value.secondary.id !== value.id && value.secondary.id.length <= 500
    && typeof value.secondary.name === 'string' && value.secondary.name.length <= 500
    && typeof value.secondary.language === 'string' && value.secondary.language.length <= 100
    && subtitleUrl(value.secondary.url) === value.secondary.url && value.secondary.url !== value.url;
}
export function biliVideo(url: string) {
  try {
    const parsed = new URL(url); if (parsed.origin !== 'https://www.bilibili.com') return null;
    const bvid = parsed.href.match(/BV[0-9A-Za-z]{10}/)?.[0]; if (!bvid) return null;
    const requestedPage = Number(parsed.searchParams.get('p'));
    const page = Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 100_000 ? requestedPage : 1;
    return { bvid, page };
  } catch { return null; }
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('B站接口没有响应体');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BILI_RESPONSE_BYTES) { await reader.cancel(); throw new Error('B站响应过大，已停止读取'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; } catch { throw new Error('B站接口返回的不是有效 JSON'); }
}
async function envelope(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { credentials: 'include', signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 429 ? 'B 站请求过于频繁，已停止自动重试；请稍后刷新视频' : `B站接口请求失败：HTTP ${response.status}`);
  const payload = await boundedJson(response);
  if (!record(payload) || payload.code !== 0 || !record(payload.data)) throw new Error(typeof payload === 'object' && payload && 'message' in payload
    ? String(payload.message).slice(0, 500) : 'B站接口返回异常');
  return payload.data;
}
export async function biliMetadata(bvid: string, page: number, signal?: AbortSignal) {
  if (!/^BV1[0-9A-Za-z]{9}$/.test(bvid) || !Number.isSafeInteger(page) || page < 1 || page > 100_000) throw new Error('B站视频参数异常');
  const data = await envelope(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, signal);
  const pages = Array.isArray(data.pages) ? data.pages.filter(record) : [];
  const target = pages.find(item => item.page === page) ?? (page === 1 ? pages[0] : undefined);
  if (!target && page > 1) throw new Error(`B站没有第 ${page} P，未回退到其他分 P`);
  const aid = Number(data.aid), cid = Number(target?.cid ?? data.cid);
  if (!Number.isSafeInteger(aid) || aid <= 0 || !Number.isSafeInteger(cid) || cid <= 0) throw new Error('B站视频缺少有效 aid/cid');
  return { aid, cid, title: String(target?.part ?? data.title ?? '').slice(0, 1000) };
}
export async function biliTracks(bvid: string, aid: number, cid: number, signal?: AbortSignal): Promise<{ tracks: BiliTrack[]; needLogin: boolean; usedAiFallback: boolean }> {
  const data = await envelope(await signedPlayerUrl({ aid, cid, bvid }, signal), signal);
  const raw = record(data.subtitle) && Array.isArray(data.subtitle.subtitles) ? data.subtitle.subtitles : [];
  const usable = raw.filter(item => record(item) && subtitleUrl(item.subtitle_url));
  const selection = selectBilibiliSubtitlePriority(usable);
  const tracks: BiliTrack[] = selection.selectedTracks.filter(record).flatMap((item, index) => {
    const url = subtitleUrl(item.subtitle_url);
    if (!url) return [];
    const language = String(item.lan ?? '').slice(0, 100), name = String(item.lan_doc ?? (language || `字幕 ${index + 1}`)).slice(0, 500);
    return [{ id: `bili:${String(item.id ?? index).slice(0, 450)}:${index}`, name, language,
      kind: selection.usedAiFallback ? 'asr' : 'manual', url }];
  });
  const preferred = (items: BiliTrack[]) => [...items].sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  const english = preferred(tracks.filter(track => /^en(?:-|$)/i.test(track.language)));
  const chinese = [...tracks.filter(track => /^(?:zh|ai-zh)(?:-|$)/i.test(track.language))]
    .sort((a, b) => chineseTrackRank(a) - chineseTrackRank(b) || Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  if (english && chinese && !tracks.some(track => /双语|中英|bilingual/i.test(track.name))) {
    tracks.push({ id: `bili:dual:${tracks.indexOf(english)}:${tracks.indexOf(chinese)}`, name: `${english.name} + ${chinese.name}（网站双语）`.slice(0, 500),
      language: `${english.language}+${chinese.language}`, kind: english.kind === 'manual' && chinese.kind === 'manual' ? 'manual' : 'asr',
      url: english.url, secondary: { id: chinese.id, name: chinese.name, language: chinese.language, url: chinese.url } });
  }
  return { tracks, needLogin: Boolean(data.need_login_subtitle), usedAiFallback: selection.usedAiFallback };
}
export function chooseBiliTrack(tracks: BiliTrack[]) {
  const preference = (track: BiliTrack) => {
    if (/双语|中英|bilingual/i.test(track.name)) return 0;
    const rank = ['zh-cn','zh-hans','zh-hant','zh','ai-zh','en-us','en','ai-en'].indexOf(track.language.toLowerCase());
    return (rank < 0 ? 20 : rank + 1) + (track.kind === 'asr' ? .5 : 0);
  };
  return [...tracks].sort((a, b) => preference(a) - preference(b))[0];
}

export function chooseBiliPair(tracks: BiliTrack[]) {
  const single = tracks.filter(track => !track.secondary);
  const bilingual = single.find(track => /双语|中英|bilingual/i.test(track.name));
  if (bilingual) return { primary: bilingual, secondary: undefined };
  const manualFirst = (items: BiliTrack[]) => [...items].sort((a, b) => Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  const english = manualFirst(single.filter(track => /^en(?:-|$)/i.test(track.language)));
  const chinese = [...single.filter(track => /^(?:zh|ai-zh)(?:-|$)/i.test(track.language))]
    .sort((a, b) => chineseTrackRank(a) - chineseTrackRank(b) || Number(a.kind === 'asr') - Number(b.kind === 'asr'))[0];
  const primary = english ?? chooseBiliTrack(single);
  const secondary = primary && chinese && chinese.id !== primary.id ? chinese : undefined;
  return { primary, secondary };
}
async function fetchBiliCues(url: string, trackId: string, signal?: AbortSignal): Promise<RawCue[]> {
  const response = await fetch(url, { credentials: 'omit', signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`B站字幕下载失败：HTTP ${response.status}`);
  const payload = await boundedJson(response);
  if (!record(payload) || !Array.isArray(payload.body) || payload.body.length > 40_000) throw new Error('B站字幕结构异常');
  const cues = payload.body.map((item, index): RawCue | null => {
    if (!record(item)) return null;
    if (typeof item.content !== 'string') throw new Error(`B站字幕第 ${index + 1} 条正文结构异常`);
    const start = Number(item.from), end = Number(item.to), text = item.content;
    if (text.length > 100_000) throw new Error(`B站字幕第 ${index + 1} 条文本异常过长`);
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
    const primaryTimed = a.filter(validTime);
    const startMs = a.length ? primaryTimed.length ? Math.min(...primaryTimed.map(cue => cue.startMs)) : null
      : timed.length ? Math.min(...timed.map(cue => cue.startMs)) : null;
    output.push({ cueId: `${trackId}:${output.length}`, sourceIndex: output.length,
      text: [a.map(cue => cue.text).filter(Boolean).join(' '), b.map(cue => cue.text).filter(Boolean).join(' ')].filter(Boolean).join('\n'),
      startMs,
      endMs: timed.length ? Math.max(...timed.map(cue => cue.endMs)) : null,
      timingSource: 'start+duration', timingIssue: startMs !== null && timed.length ? null : '主字幕缺少或非法时间',
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
  if (!track.secondary) return fetchBiliCues(track.url, track.id, signal);
  const [primary, secondary] = await Promise.all([
    fetchBiliCues(track.url, track.id, signal),
    fetchBiliCues(track.secondary.url, track.secondary.id, signal),
  ]);
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

function cueLanes(cue: RawCue): DisplayLane | null {
  if (record(cue.raw) && Array.isArray(cue.raw.primary) && Array.isArray(cue.raw.secondary)) {
    return { primary: laneText(cue.raw.primary), secondary: laneText(cue.raw.secondary) };
  }
  const lines = cue.text.split(/\r?\n/u).map(line => line.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const latin = /\p{Script=Latin}/u;
  const primary = lines.filter(line => latin.test(line) && !cjk.test(line)).join(' ');
  const secondary = lines.filter(line => cjk.test(line)).join(' ');
  return primary && secondary ? { primary, secondary } : null;
}

function bilingualDisplayCues(cues: RawCue[]) {
  const lanes = new Map<string, DisplayLane>();
  const display: RawCue[] = [];
  let previousPrimary = '', previousSecondary = '', previousEndMs: number | null = null, found = false;
  for (const cue of cues) {
    const lanesForCue = cueLanes(cue);
    if (!lanesForCue) { previousPrimary = ''; previousSecondary = ''; previousEndMs = null; display.push(cue); continue; }
    found = true;
    const { primary, secondary } = lanesForCue;
    if (previousEndMs !== null && cue.startMs !== null && (cue.startMs < previousEndMs - MAX_BILI_PHRASE_MS || cue.startMs - previousEndMs > 1_500)) {
      previousPrimary = ''; previousSecondary = '';
    }
    const delta = { primary: rollingDelta(previousPrimary, primary), secondary: rollingDelta(previousSecondary, secondary) };
    previousPrimary = primary; previousSecondary = secondary; previousEndMs = cue.endMs;
    if (!delta.primary && !delta.secondary) {
      const last = display.at(-1);
      if (last && last.endMs !== null && cue.endMs !== null) display[display.length - 1] = { ...last, endMs: Math.max(last.endMs, cue.endMs) };
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
