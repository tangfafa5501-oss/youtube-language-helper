import { record } from './captions.ts';
import type { BiliTrack, biliMetadata, biliTracks } from './bilibili.ts';

export const BILI_NETWORK_CHANNEL = 'ylh-bilibili-network-v1';
export type BiliRoute = { bvid: string; page: number };
export type BiliMetadataTracks = Awaited<ReturnType<typeof biliTracks>> & { metadata: Awaited<ReturnType<typeof biliMetadata>> };
type BiliRequest = BiliRoute & ({ type: 'metadata-tracks' } | { type: 'cues'; track: BiliTrack });

// Content scripts never retry subtitle downloads with a page-origin fetch.
export function requestBilibili<T>(request: BiliRequest, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => { void browser.runtime.sendMessage({ channel: BILI_NETWORK_CHANNEL, version: 1,
      type: 'cancel', requestId }).catch(() => undefined); };
    const abort = () => { cancel(); finish(new DOMException('Aborted', 'AbortError')); };
    const timeout = setTimeout(() => { cancel(); finish(new Error('B站后台响应超时，请重试 B站字幕')); }, 15_000);
    signal?.addEventListener('abort', abort, { once: true });
    void browser.runtime.sendMessage({ channel: BILI_NETWORK_CHANNEL, version: 1, requestId, ...request }).then(reply => {
      if (!record(reply) || reply.ok !== true) {
        finish(new Error(record(reply) && typeof reply.error === 'string' ? reply.error : 'B站后台响应格式异常')); return;
      }
      finish(undefined, reply.result as T);
    }, () => finish(new Error('B站后台通信失败，请重新加载扩展后重试')));
  });
}
