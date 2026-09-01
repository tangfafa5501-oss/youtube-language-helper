import { record, type RawCue } from './captions.ts';
import { DigestTranscriptError as SupadataError, digestTranscriptUrl, handleFetchTranscript } from './vendor/digest-transcript.ts';
export { DigestTranscriptError as SupadataError } from './vendor/digest-transcript.ts';

export const SUPADATA_ORIGIN = 'https://api.supadata.ai/*';
export const validLanguage = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value) && value.length <= 35;
export function transcriptUrl(videoId: string, language: string) {
  if (!/^[\w-]{11}$/.test(videoId) || !validLanguage(language)) throw new SupadataError('视频 ID 或语言代码非法');
  return digestTranscriptUrl(videoId, language);
}

export function parseSupadata(data: unknown) {
  if (!record(data) || !Array.isArray(data.content) || !data.content.length || data.content.length > 40_000
    || !validLanguage(data.lang) || JSON.stringify(data).length > 8_000_000) {
    throw new SupadataError('Supadata 未返回可用的带时间戳条目，未当作读取成功');
  }
  const language = data.lang;
  const cues: RawCue[] = data.content.map((row, index) => {
    if (!record(row) || typeof row.text !== 'string') throw new SupadataError('Supadata 文本条目结构异常');
    const startMs = typeof row.offset === 'number' && Number.isFinite(row.offset) && row.offset >= 0 ? row.offset : null;
    const duration = typeof row.duration === 'number' && Number.isFinite(row.duration) && row.duration >= 0 ? row.duration : null;
    const sum = startMs !== null && duration !== null ? startMs + duration : null;
    const endMs = sum !== null && Number.isFinite(sum) ? sum : null;
    return { cueId: `supadata:${language}:${index}`, sourceIndex: index, text: row.text, startMs, endMs,
      timingSource: 'offset+duration', timingIssue: startMs === null ? '缺少或非法开始时间'
        : duration === null || duration <= 0 || endMs === null ? '缺少或非法持续时间' : null, raw: row };
  });
  return { cues, language, availableLangs: Array.isArray(data.availableLangs) ? data.availableLangs.filter(validLanguage).slice(0, 200) : [] };
}

function httpError(status: number) {
  const messages: Record<number, string> = {
    401: 'Supadata Key 无效，请在 API 设置中检查', 402: 'Supadata 额度不足，请检查账户',
    403: 'Supadata 拒绝访问，请检查 API 权限或视频访问限制',
    404: 'Supadata 未找到可访问的视频或已有字幕', 429: 'Supadata 请求受限，请稍后手动重试',
    206: 'Supadata 没有返回完整的已有字幕，未采用部分结果',
  };
  return new SupadataError(messages[status] ?? `Supadata 请求失败（HTTP ${status}）`);
}
async function requestJson(url: string, key: string, signal: AbortSignal, fetcher: typeof fetch) {
  // Bound each fetch as well as the entire job; keep SW requests below 30s.
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  const response = await fetcher(url, { method: 'GET', headers: { 'x-api-key': key }, signal: requestSignal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (response.status !== 200 && response.status !== 202) throw httpError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new SupadataError('Supadata 返回空响应');
  let size = 0, body = ''; const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 8_000_000) { await reader.cancel(); throw new SupadataError('Supadata 响应过大，已停止'); }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  try { return { status: response.status, data: JSON.parse(body) as unknown }; } catch { throw new SupadataError('Supadata 响应格式异常'); }
}
export async function testSupadata(key: string, signal: AbortSignal, fetcher = fetch) {
  const { data } = await requestJson('https://api.supadata.ai/v1/me', key, signal, fetcher);
  if (!record(data) || typeof data.plan !== 'string' || typeof data.maxCredits !== 'number' || typeof data.usedCredits !== 'number'
    || !Number.isFinite(data.maxCredits) || !Number.isFinite(data.usedCredits)) throw new SupadataError('账户接口响应结构异常');
  // Never return account identity or the key to the UI.
  return { plan: data.plan.slice(0, 100), maxCredits: data.maxCredits, usedCredits: data.usedCredits };
}
export async function fetchSupadata(videoId: string, language: string, key: string, signal: AbortSignal, fetcher = fetch,
  wait = (ms: number) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new SupadataError('请求已停止')); return; }
    const abort = () => { clearTimeout(timer); reject(new SupadataError('请求已停止')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  })) {
  transcriptUrl(videoId, language); // Validate before delegating to the ported flow.
  const data = await handleFetchTranscript(videoId, language, url => requestJson(url, key, signal, fetcher), wait);
  const parsed = parseSupadata(data);
  return { data, language: parsed.language, count: parsed.cues.length };
}
