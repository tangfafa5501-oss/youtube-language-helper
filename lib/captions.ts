export type RawCue = {
  cueId: string;
  sourceIndex: number;
  text: string;
  startMs: number | null;
  endMs: number | null;
  timingSource: 'start+duration' | 'offset+duration';
  timingIssue: string | null;
  raw: Record<string, unknown>;
};

export type WordTiming = { text: string; startMs: number; endMs: number };

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function time(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

// JSON3 events without segs are window/style operations, not caption entries.
// Keep every text event, including duplicates, whitespace, overlaps and bad timing.
export function parseJson3(body: string, trackId: string): { cues: RawCue[]; eventCount: number; controlEventCount: number } {
  if (body.length > 8_000_000) throw new Error('字幕响应过大，M0 不截断显示');
  if (!body.trim()) throw new Error('网页直读返回空内容；此实验路径尚未修复。请使用上方“读取字幕 · Supadata”按钮');
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new Error('字幕响应不是 JSON3，未进行猜测转换'); }
  if (!record(data) || !Array.isArray(data.events) || data.events.length > 40_000) {
    throw new Error('字幕 JSON3 结构不支持或条目过多');
  }
  const cues: RawCue[] = [];
  let controlEventCount = 0;
  for (const [index, event] of data.events.entries()) {
    if (!record(event)) throw new Error('字幕包含非法事件，未静默丢弃');
    if (!('segs' in event)) { controlEventCount++; continue; }
    if (!Array.isArray(event.segs) || event.segs.some(s => !record(s) || typeof s.utf8 !== 'string')) {
      throw new Error('字幕文本事件结构异常，未静默丢弃');
    }
    const startMs = time(event.tStartMs);
    const durationMs = time(event.dDurationMs);
    const end = startMs !== null && durationMs !== null ? startMs + durationMs : null;
    const endMs = end !== null && Number.isFinite(end) ? end : null;
    const timingIssue = startMs === null ? '缺少或非法开始时间'
      : durationMs === null || durationMs <= 0 || endMs === null ? '缺少或非法持续时间' : null;
    cues.push({ cueId: `${trackId}:${index}`, sourceIndex: index,
      text: event.segs.map(s => (s as { utf8: string }).utf8).join(''),
      startMs, endMs, timingSource: 'start+duration', timingIssue, raw: event });
  }
  if (!cues.length) throw new Error('响应不包含文本条目，未当作成功');
  return { cues, eventCount: data.events.length, controlEventCount };
}

export function parseJson3WordTimings(body: string): WordTiming[] {
  if (body.length > 8_000_000) throw new Error('字幕响应过大，未读取词级时间');
  let data: unknown;
  try { data = JSON.parse(body); } catch { throw new Error('词级字幕响应不是 JSON3'); }
  if (!record(data) || !Array.isArray(data.events)) throw new Error('词级字幕 JSON3 结构不支持');
  const words: WordTiming[] = [];
  for (const event of data.events) {
    if (!record(event) || !Array.isArray(event.segs)) continue;
    const eventStart = time(event.tStartMs), duration = time(event.dDurationMs);
    if (eventStart === null || duration === null || duration <= 0) continue;
    const segments = event.segs.filter(record);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (typeof segment.utf8 !== 'string' || !segment.utf8.trim()) continue;
      const offset = time(segment.tOffsetMs) ?? 0;
      const nextOffset = i + 1 < segments.length ? time(segments[i + 1]!.tOffsetMs) : null;
      const startMs = eventStart + offset;
      const endMs = eventStart + (nextOffset !== null && nextOffset > offset ? nextOffset : duration);
      if (endMs > startMs) words.push({ text: segment.utf8, startMs, endMs });
    }
  }
  if (!words.length) throw new Error('网站自动字幕没有提供可用的词级时间');
  return words;
}

export function watchVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.searchParams.get('v');
    return u.origin === 'https://www.youtube.com' && u.pathname === '/watch' && id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export function captionUrl(baseUrl: string, videoId: string): string | null {
  try {
    const u = new URL(baseUrl, 'https://www.youtube.com');
    if (u.origin !== 'https://www.youtube.com' || u.pathname !== '/api/timedtext' || u.searchParams.get('v') !== videoId || u.username || u.password) return null;
    u.searchParams.set('fmt', 'json3');
    return u.href;
  } catch { return null; }
}
