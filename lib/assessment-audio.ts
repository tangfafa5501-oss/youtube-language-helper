import { AssessmentError, MAX_ASSESSMENT_SECONDS } from './youdao.ts';

export function encodeAssessmentWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const length = channels[0]?.length ?? 0;
  if (sampleRate !== 16000 || !length || !channels.length || channels.length > 8 || channels.some(c => c.length !== length)
    || length / sampleRate > MAX_ASSESSMENT_SECONDS) throw new AssessmentError('录音为空、格式异常或超过 120 秒，请重新录制较短片段');
  const bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => bytes.set(new TextEncoder().encode(text), offset);
  write(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); write(8, 'WAVEfmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    let sample = 0; for (const channel of channels) sample += channel[i]! / channels.length;
    if (!Number.isFinite(sample)) throw new AssessmentError('录音采样无效');
    sample = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function audioBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export async function prepareAssessmentAudio(blob: Blob) {
  if (!blob.size || blob.size > 20_000_000) throw new AssessmentError('录音为空或文件过大');
  // decodeAudioData resamples to this context's rate. It does not play audio or request a microphone.
  const context = new OfflineAudioContext(1, 1, 16000);
  let decoded: AudioBuffer;
  try { decoded = await context.decodeAudioData(await blob.arrayBuffer()); }
  catch { throw new AssessmentError('录音解码失败，请重新录制'); }
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  return audioBase64(encodeAssessmentWav(channels, decoded.sampleRate));
}
