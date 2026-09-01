/*
 * Adapted from youtube-digest/background.js, handleFetchTranscript and
 * pollTranscriptJob (local revision 5462cae).
 * Copyright (c) 2026 Zara Zhang. MIT License: public/licenses/youtube-digest.txt.
 * Kept: canonical URL, native/text=false request, HTTP 202 job flow, 60 polls.
 * Adapted: injected bounded transport, configurable language, raw result return.
 * Intentionally omitted: caption cleanup, whole-second rounding, AI text output.
 */
import { record } from '../captions.ts';

export class DigestTranscriptError extends Error {}
export type DigestRequest = (url: string) => Promise<{ status: number; data: unknown }>;

export function digestTranscriptUrl(videoId: string, language: string) {
  const canonicalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const apiUrl = new URL('https://api.supadata.ai/v1/transcript');
  apiUrl.searchParams.set('url', canonicalVideoUrl);
  apiUrl.searchParams.set('text', 'false');
  apiUrl.searchParams.set('lang', language);
  apiUrl.searchParams.set('mode', 'native');
  return apiUrl.toString();
}

export async function handleFetchTranscript(videoId: string, language: string, request: DigestRequest,
  wait: (ms: number) => Promise<void>) {
  const response = await request(digestTranscriptUrl(videoId, language));
  if (response.status === 202) {
    const jobData = response.data;
    if (!record(jobData) || typeof jobData.jobId !== 'string' || !/^[\w-]{1,200}$/.test(jobData.jobId)) {
      throw new DigestTranscriptError('Supadata 任务 ID 异常');
    }
    return await pollTranscriptJob(jobData.jobId, request, wait);
  }
  return response.data;
}

async function pollTranscriptJob(jobId: string, request: DigestRequest, wait: (ms: number) => Promise<void>) {
  const maxAttempts = 60;
  const pollInterval = 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await wait(pollInterval);
    const response = await request(`https://api.supadata.ai/v1/transcript/${encodeURIComponent(jobId)}`);
    const data = response.data;
    if (!record(data)) throw new DigestTranscriptError('Supadata 任务响应异常');
    if (data.status === 'completed') return record(data.result) ? data.result : data;
    if (data.status === 'failed') throw new DigestTranscriptError('Supadata 任务失败，未自动重新提交');
    if (data.status !== 'queued' && data.status !== 'active') throw new DigestTranscriptError('Supadata 任务状态异常');
  }
  throw new DigestTranscriptError('Supadata 仍在处理，已停止 60 次轮询；服务端任务可能继续，重试可能再用额度');
}
