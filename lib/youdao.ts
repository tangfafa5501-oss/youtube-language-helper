/** Youdao speech assessment HTTP v2. No SDK and no model-generated scores. */
export const YOUDAO_CHANNEL = 'ylh-youdao-v1';
export const YOUDAO_ORIGIN = 'https://openapi.youdao.com/*';
export const YOUDAO_ENDPOINT = 'https://openapi.youdao.com/iseapi';
export const MAX_ASSESSMENT_SECONDS = 120;
export type AssessmentLanguage = 'en' | 'zh-CHS';
export type YoudaoCredentials = { appKey: string; appSecret: string };
export type AssessedPhoneme = { phoneme: string; score?: number; correct?: boolean; heard?: string;
  expectedStress?: boolean; actualStress?: boolean };
export type AssessedWord = { text: string; ipa?: string; score?: number; phonemes: AssessedPhoneme[] };
export type PronunciationAssessment = { provider: 'youdao'; createdAt: number; referenceText: string; language: AssessmentLanguage;
  overall: number; accuracy: number; fluency: number; completeness: number; words: AssessedWord[]; speechRate?: number; requestId?: string };
export type AssessmentReply = { ok: boolean; error?: string; configured?: boolean; permitted?: boolean; assessment?: PronunciationAssessment };
export class AssessmentError extends Error {}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 500) => typeof value === 'string' ? value.slice(0, limit) : undefined;
const score = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;

export function assessmentLanguage(language: string | undefined, reference: string): AssessmentLanguage {
  const code = language?.toLowerCase().replace(/^ai-/, '');
  if (code === 'en' || code?.startsWith('en-')) return 'en';
  if (code === 'zh' || code?.startsWith('zh-')) return 'zh-CHS';
  if (code) throw new AssessmentError('有道语音评测仅支持英语和中文，请选择对应的主字幕');
  // Older recordings have no language metadata. Do not rewrite their original text.
  if (/\p{Script=Han}/u.test(reference)) return 'zh-CHS';
  if (/^[\p{Script=Latin}\p{Number}\p{Punctuation}\p{Separator}\s]+$/u.test(reference) && /[a-z]/i.test(reference)) return 'en';
  throw new AssessmentError('无法确定旧录音的评测语言，请在英语或中文字幕下重新录音');
}
export function validateReference(reference: unknown): asserts reference is string {
  if (typeof reference !== 'string' || !reference.trim() || reference.length > 10_000) throw new AssessmentError('字幕文本为空或过长，无法评估');
}
export function validCredentials(value: unknown): value is YoudaoCredentials {
  return object(value) && [value.appKey, value.appSecret].every(part => typeof part === 'string' && part.length >= 1
    && part.length <= 256 && !/\s|[\x00-\x1f]/.test(part));
}
export function youdaoError(code: unknown) {
  const messages: Record<string, string> = {
    '108': '应用 ID 无效', '110': '应用尚未绑定语音评测服务', '202': '签名校验失败，请检查应用 ID 和应用密钥',
    '203': '当前 IP 不在有道应用允许名单中', '205': '请在有道控制台将应用接入方式设为 API',
    '206': '时间戳无效，请检查系统时间', '207': '请求重复', '401': '账户余额不足',
    '11007': '录音超过 120 秒', '11010': '录音太短', '11011': '未检测到可评估的语音，请重新朗读录音',
    '11012': '参考文本太短', '11302': '有道处理超时', '11303': '请求过于频繁，请稍后重试',
  };
  const safeCode = typeof code === 'string' && /^\d{1,6}$/.test(code) ? code : 'unknown';
  return new AssessmentError(`有道评估失败（${safeCode}）：${messages[safeCode] ?? '服务未返回有效评估，请稍后重试'}`);
}
export function parseAssessment(value: unknown, referenceText: string, language: AssessmentLanguage): PronunciationAssessment {
  if (!object(value)) throw new AssessmentError('有道评估响应格式异常');
  if (String(value.errorCode) !== '0') throw youdaoError(String(value.errorCode));
  const overall = score(value.overall), accuracy = score(value.pronunciation), fluency = score(value.fluency), completeness = score(value.integrity);
  if (overall === undefined || accuracy === undefined || fluency === undefined || completeness === undefined
    || !Array.isArray(value.words) || value.words.length > 2000) throw new AssessmentError('有道未返回完整评分，未保存不完整结果');
  const words: AssessedWord[] = value.words.map(word => {
    if (!object(word) || !text(word.word)) throw new AssessmentError('有道单词评分格式异常');
    const phonemes: AssessedPhoneme[] = (Array.isArray(word.phonemes) ? word.phonemes.slice(0, 100) : []).map(p => {
      if (!object(p) || !text(p.phoneme)) throw new AssessmentError('有道音素评分格式异常');
      return { phoneme: text(p.phoneme)!, score: score(p.pronunciation), correct: typeof p.judge === 'boolean' ? p.judge : undefined,
        heard: text(p.calibration), expectedStress: typeof p.stress_ref === 'boolean' ? p.stress_ref : undefined,
        actualStress: typeof p.stress_detect === 'boolean' ? p.stress_detect : undefined };
    });
    return { text: text(word.word)!, ipa: text(word.IPA), score: score(word.pronunciation), phonemes };
  });
  return { provider: 'youdao', createdAt: Date.now(), referenceText, language, overall, accuracy, fluency, completeness, words,
    speechRate: typeof value.speed === 'number' && Number.isFinite(value.speed) && value.speed >= 0 ? value.speed : undefined,
    requestId: text(value.requestId, 128) };
}

/** Only accept the canonical PCM WAV produced by our converter, never a relabeled MP3. */
export function validateAssessmentWav(q: unknown) {
  if (typeof q !== 'string' || !q.length || q.length > 5_120_060 || q.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(q)) {
    throw new AssessmentError('评估音频无效或超过 120 秒');
  }
  const binary = atob(q), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const name = (offset: number, length: number) => binary.slice(offset, offset + length);
  if (bytes.length < 46 || name(0, 4) !== 'RIFF' || name(8, 8) !== 'WAVEfmt ' || name(36, 4) !== 'data'
    || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1
    || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint32(28, true) !== 32000
    || view.getUint16(32, true) !== 2 || view.getUint16(34, true) !== 16 || view.getUint32(40, true) !== bytes.length - 44
    || (bytes.length - 44) % 2 || (bytes.length - 44) / 32000 > MAX_ASSESSMENT_SECONDS) {
    throw new AssessmentError('评估需要 16kHz、16bit、单声道 PCM WAV');
  }
  return (bytes.length - 44) / 32000;
}
export async function signYoudao(q: string, credentials: YoudaoCredentials, salt: string, curtime: string) {
  const input = q.length > 20 ? q.slice(0, 10) + q.length + q.slice(-10) : q;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credentials.appKey + input + salt + curtime + credentials.appSecret));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function requestAssessment(q: string, reference: string, language: AssessmentLanguage, credentials: YoudaoCredentials,
  signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PronunciationAssessment> {
  validateAssessmentWav(q); validateReference(reference);
  const salt = crypto.randomUUID(), curtime = String(Math.floor(Date.now() / 1000));
  const body = new URLSearchParams({ q, text: reference, langType: language, appKey: credentials.appKey, salt, curtime,
    sign: await signYoudao(q, credentials, salt, curtime), signType: 'v2', format: 'wav', rate: '16000', channel: '1', type: '1' });
  signal.throwIfAborted();
  const response = await fetcher(YOUDAO_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body, credentials: 'omit', redirect: 'error', cache: 'no-store', signal });
  if (!response.ok) throw new AssessmentError(`有道评估请求失败（HTTP ${response.status}）`);
  const reader = response.body?.getReader(); if (!reader) throw new AssessmentError('有道返回空响应');
  let json = '', size = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); throw new AssessmentError('有道评估响应过大'); }
      json += decoder.decode(chunk.value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  signal.throwIfAborted();
  try { return parseAssessment(JSON.parse(json + decoder.decode()), reference, language); }
  catch (error) { if (error instanceof AssessmentError) throw error; throw new AssessmentError('有道评估响应格式异常'); }
}
