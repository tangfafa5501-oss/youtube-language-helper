import { audioToDataUrl } from './capture-audio.ts';
import type { PrecisePlaybackController } from './playback-machine.ts';
import type { State } from './protocol.ts';
import { segmentFromRows } from './practice.ts';

type PracticePort = { postMessage(message: unknown): void };
export function handlePracticeMessage<Owner extends PracticePort>(message: Record<string, unknown>, owner: Owner,
  state: State, playback: PrecisePlaybackController<Owner>, current: () => boolean) {
  if (!['practice-pause', 'practice-capture', 'practice-cancel'].includes(String(message.type))) return false;
  if (!current() || state.status !== 'loaded' || !state.video || message.videoId !== state.video.videoId
    || message.session !== state.video.session || message.trackId !== state.trackId) return true;
  if (message.type === 'practice-cancel') { playback.cancelCapture(owner); return true; }
  if (typeof message.requestId !== 'string' || message.requestId.length > 100) return true;
  const binding = { videoId: state.video.videoId, session: state.video.session, trackId: state.trackId };
  void (async () => {
    let data: string | undefined, error: string | undefined;
    try {
      if (playback.mode !== 'practice') throw new Error('请先点击麦克风进入跟读模式');
      if (message.type === 'practice-pause') playback.pause(owner);
      else {
        const segment = segmentFromRows(state.phrases ?? [], message.phraseId, message.endPhraseId);
        if (!segment) throw new Error('练习片段已失效或超过 60 秒');
        data = await audioToDataUrl(await playback.capture(owner, segment));
      }
    } catch (reason) { error = reason instanceof Error ? reason.message : '练习操作失败'; }
    if (current()) try { owner.postMessage({ type: 'practice-response', requestId: message.requestId, ...binding, data, error }); } catch { /* panel closed */ }
  })();
  return true;
}
