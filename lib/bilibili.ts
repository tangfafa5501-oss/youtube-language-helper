import { record, type RawCue } from './captions.ts';
import { groupSentences } from './sentence-groups.ts';
import { signedPlayerUrl } from './bilibili-wbi.ts';
import type { TimedPhrase } from './timed-phrases.ts';

export type BiliTrack = { id: string; name: string; language: string; kind: 'manual' | 'asr'; url: string;
  secondary?: { id: string; name: string; language: string; url: string } };
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
  const chinese = preferred(tracks.filter(track => /^(?:zh|ai-zh)(?:-|$)/i.test(track.language)));
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
    while (Math.abs(aEnd - bEnd) > 750) {
      const nextPrimary = primary[left], nextSecondary = secondary[right];
      if (aEnd < bEnd && nextPrimary && validTime(nextPrimary) && nextPrimary.startMs <= bEnd + 250) {
        aEnd = Math.max(aEnd, nextPrimary.endMs); a.push(nextPrimary); left++; continue;
      }
      if (bEnd < aEnd && nextSecondary && validTime(nextSecondary) && nextSecondary.startMs <= aEnd + 250) {
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
export function biliPhrases(cues: RawCue[]): TimedPhrase[] {
  return groupSentences(cues).flatMap((group, index) => group.startMs !== null && group.endMs !== null && group.endMs > group.startMs
    ? [{ id: `bili-phrase:${index}:${group.startMs}`, text: group.text, startMs: group.startMs, endMs: group.endMs, timing: 'bilibili-cue' as const }] : []);
}
