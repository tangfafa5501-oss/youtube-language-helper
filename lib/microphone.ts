import Recorder from 'recorder-core/recorder.mp3.min';

type RecorderInstance = {
  open(ok: () => void, fail: (message: string, denied: boolean) => void): void;
  start(): void; stop(ok: (blob: Blob, duration: number) => void, fail: (message: string) => void): void;
  close(): void;
};
export type MicrophoneStatus = 'idle' | 'requesting' | 'recording' | 'stopping';
export class PracticeMicrophone {
  private recorder: RecorderInstance | null = null;
  private generation = 0;
  private limit: ReturnType<typeof setTimeout> | undefined;
  status: MicrophoneStatus = 'idle';
  constructor(private update: (status: MicrophoneStatus, duration?: number, power?: number) => void,
    private onLimit: () => void) {}
  async start() {
    if (this.status !== 'idle') return;
    const token = ++this.generation; this.status = 'requesting'; this.update(this.status);
    const recorder: RecorderInstance = Recorder({ type: 'mp3', sampleRate: 16_000, bitRate: 16,
      onProcess: (_buffers: Int16Array[], power: number, duration: number) => {
        if (token === this.generation && this.status === 'recording') this.update(this.status, duration, power);
      } });
    this.recorder = recorder;
    try {
      await new Promise<void>((resolve, reject) => recorder.open(resolve, (_message, denied) => reject(new Error(denied
        ? '麦克风权限未允许，请通过麦克风授权页重试' : '无法打开麦克风，请检查设备是否连接或被其他应用占用'))));
      if (token !== this.generation) { recorder.close(); return; }
      recorder.start(); this.status = 'recording'; this.update(this.status, 0, 0);
      this.limit = setTimeout(() => this.onLimit(), 120_000);
    } catch (error) { recorder.close(); if (token === this.generation) { this.status = 'idle'; this.update(this.status); } throw error; }
  }
  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    if (!this.recorder || this.status !== 'recording') throw new Error('当前没有正在录制的音频');
    clearTimeout(this.limit); const recorder = this.recorder, token = this.generation;
    this.status = 'stopping'; this.update(this.status);
    try {
      return await new Promise((resolve, reject) => recorder.stop((blob, durationMs) => {
        if (token !== this.generation) reject(new Error('录音已取消'));
        else if (!blob.size) reject(new Error('录音为空，请重试')); else resolve({ blob, durationMs });
      }, () => reject(new Error('录音编码失败，请重新录制'))));
    } finally { recorder.close(); if (token === this.generation) { this.status = 'idle'; this.update(this.status); } }
  }
  cancel() { this.generation++; clearTimeout(this.limit); this.recorder?.close(); this.recorder = null; this.status = 'idle'; this.update(this.status); }
}

export async function requestMicrophonePermission(signal: AbortSignal) {
  const permission = await navigator.permissions.query({ name: 'microphone' as PermissionName });
  if (permission.state === 'granted') return;
  if (permission.state === 'denied') throw new Error('麦克风权限已被拒绝，请在浏览器中允许此扩展使用麦克风后重试');
  if (signal.aborted) throw new Error('练习已取消');
  const nonce = crypto.randomUUID();
  return await new Promise<void>((resolve, reject) => {
    let windowId: number | undefined, settled = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true;
      clearTimeout(timer); browser.runtime.onMessage.removeListener(receive); signal.removeEventListener('abort', abort);
      browser.windows.onRemoved.removeListener(closed);
      if (windowId !== undefined) void browser.windows.remove(windowId).catch(() => undefined);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(new Error('练习已取消'));
    const closed = (id: number) => { if (id === windowId) finish(new Error('麦克风授权页已关闭，点击录音可以重试')); };
    const receive = (message: unknown, sender: Browser.runtime.MessageSender) => {
      const value = message as { type?: string; nonce?: string; granted?: boolean } | null;
      if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL('/permission.html'))
        || value?.type !== 'practice-permission' || value.nonce !== nonce) return;
      finish(value.granted ? undefined : new Error('麦克风权限未允许，可再次打开授权页重试'));
    };
    const timer = setTimeout(() => finish(new Error('麦克风授权超时，请点击录音重试')), 60_000);
    browser.runtime.onMessage.addListener(receive); browser.windows.onRemoved.addListener(closed); signal.addEventListener('abort', abort, { once: true });
    void browser.windows.create({ url: browser.runtime.getURL('/permission.html') + `?nonce=${nonce}`, type: 'popup', width: 480, height: 390, focused: true })
      .then(window => { windowId = window?.id; if (settled && windowId !== undefined) void browser.windows.remove(windowId).catch(() => undefined);
        else if (signal.aborted) abort(); }).catch(() => finish(new Error('无法打开麦克风授权页')));
  });
}
