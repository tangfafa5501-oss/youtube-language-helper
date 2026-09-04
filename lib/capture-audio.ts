import { preferredRecordingType, stopMediaTracks } from './recording.ts';

// Run only while the playback controller owns this capture. The media clock,
// rather than a wall-clock sleep, excludes buffering time from the segment.
export async function captureVideoAudio(video: HTMLVideoElement, endMs: number, signal: AbortSignal): Promise<Blob> {
  const source = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  const capture = source.captureStream ?? source.mozCaptureStream;
  if (!capture || video.mediaKeys) throw new Error('此视频不支持原声音频采集，仍可录音并分析自己的音高');
  const stream = capture.call(video);
  const audio = new MediaStream(stream.getAudioTracks());
  if (!audio.getAudioTracks().length) { stopMediaTracks(stream); throw new Error('视频未提供可采集的音轨'); }
  try {
    const mimeType = preferredRecordingType(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(audio, mimeType ? { mimeType } : undefined);
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = []; let error: Error | undefined, done = false;
      const finish = (reason?: Error) => {
        if (done) return; done = true; error = reason;
        clearInterval(poll); clearTimeout(timeout); signal.removeEventListener('abort', abort);
        if (recorder.state !== 'inactive') recorder.stop(); else reject(reason ?? new Error('原声采集未启动'));
      };
      const abort = () => finish(new Error('原声采集已取消'));
      const poll = setInterval(() => {
        if (signal.aborted) abort();
        else if (video.currentTime * 1000 >= endMs || video.ended) finish();
      }, 20);
      const timeout = setTimeout(() => finish(new Error('原声采集超时，请等待视频缓冲后重试')), 90_000);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => finish(new Error('浏览器无法录制此视频的音频'));
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        if (error) reject(error); else if (!blob.size) reject(new Error('未采集到原声数据')); else resolve(blob);
      };
      signal.addEventListener('abort', abort, { once: true });
      try { recorder.start(); if (signal.aborted) abort(); else void video.play().catch(() => finish(new Error('请点击播放后重试原声采集'))); }
      catch { finish(new Error('原声录制初始化失败')); }
    });
  } finally { stopMediaTracks(stream); }
}

export async function audioToDataUrl(blob: Blob): Promise<string> {
  if (blob.size > 4_000_000) throw new Error('采集片段过大，请缩短练习片段');
  return await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('音频读取失败'));
    reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
  });
}
