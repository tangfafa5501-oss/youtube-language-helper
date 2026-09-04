import type { PracticeSegment } from './practice';

export function createPracticeClient(send: (message: unknown) => void) {
  const pending = new Map<string, { binding: PracticeSegment; resolve: (data: string | undefined) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  return {
    request(type: 'practice-pause' | 'practice-capture', binding: PracticeSegment, phraseId: string, endPhraseId: string, signal?: AbortSignal) {
      return new Promise<string | undefined>((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('练习已取消')); return; }
        const requestId = crypto.randomUUID();
        const abort = () => {
          const task = pending.get(requestId); if (!task) return;
          pending.delete(requestId); clearTimeout(task.timer); signal?.removeEventListener('abort', abort);
          send({ version: 1, type: 'practice-cancel', ...binding }); reject(new Error('练习已取消'));
        };
        const finish = (error?: Error, value?: string) => {
          signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(value);
        };
        const timer = setTimeout(() => {
          pending.delete(requestId); send({ version: 1, type: 'practice-cancel', ...binding }); finish(new Error('视频页面未及时回应，请刷新视频后重试'));
        }, type === 'practice-capture' ? 100_000 : 5_000);
        pending.set(requestId, { binding, timer, resolve: value => finish(undefined, value), reject: error => finish(error) });
        signal?.addEventListener('abort', abort, { once: true });
        send({ version: 1, type, requestId, ...binding, phraseId, endPhraseId });
      });
    },
    receive(message: Record<string, unknown>) {
      if (message.type !== 'practice-response') return false;
      const task = pending.get(String(message.requestId));
      if (!task || message.videoId !== task.binding.videoId || message.session !== task.binding.session || message.trackId !== task.binding.trackId) return true;
      pending.delete(String(message.requestId)); clearTimeout(task.timer);
      if (typeof message.error === 'string') task.reject(new Error(message.error));
      else task.resolve(typeof message.data === 'string' ? message.data : undefined);
      return true;
    },
    reset() {
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('视频或字幕轨已切换')); }
      pending.clear();
    },
  };
}
