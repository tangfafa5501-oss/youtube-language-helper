import { captionUrl, record, watchVideoId } from '../lib/captions';
import { CHANNEL, type Track, type VideoInfo } from '../lib/protocol';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], world: 'MAIN', runAt: 'document_start',
  main() {
    let currentId: string | null = null;
    let session = crypto.randomUUID();
    let inFlight: AbortController | null = null;
    let busy = false;
    let captionPrime: { session: string; toggled: boolean } | null = null;
    const urls = new Map<string, string>();
    async function boundedBody(response: Response, maxBytes: number, label: string) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`${label}没有响应体`);
      const decoder = new TextDecoder(); let body = '', bytes = 0;
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new Error(`${label}响应过大`); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      return body + decoder.decode();
    }
    function info(): VideoInfo | null {
      const id = watchVideoId(location.href);
      if (id !== currentId) {
        currentId = id; session = crypto.randomUUID(); urls.clear(); inFlight?.abort();
      }
      if (!id) return null;
      const player = document.getElementById('movie_player') as (HTMLElement & { getPlayerResponse?: () => unknown }) | null;
      let response: unknown;
      try { response = player?.getPlayerResponse?.(); } catch { /* Player not initialized. */ }
      if (!record(response) || !record(response.videoDetails) || response.videoDetails.videoId !== id) {
        response = (window as unknown as { ytInitialPlayerResponse?: unknown }).ytInitialPlayerResponse;
      }
      const result: VideoInfo = { videoId: id, session, title: document.title.slice(0, 1000), tracks: [],
        availability: '播放器尚未就绪，请稍后重试', platform: 'youtube' };
      urls.clear();
      if (!record(response) || !record(response.videoDetails) || response.videoDetails.videoId !== id) return result;
      result.title = String(response.videoDetails.title ?? result.title).slice(0, 1000);
      const status = record(response.playabilityStatus) ? response.playabilityStatus : {};
      if (status.status !== 'OK') { result.availability = '视频不可播放或需要访问权限，请先在 YouTube 页面处理'; return result; }
      const captions = record(response.captions) ? response.captions : {};
      const renderer = record(captions.playerCaptionsTracklistRenderer) ? captions.playerCaptionsTracklistRenderer : {};
      const tracks = Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
      for (const [index, t] of tracks.slice(0, 200).entries()) {
        if (!record(t) || typeof t.baseUrl !== 'string') continue;
        const url = captionUrl(t.baseUrl, id);
        if (!url) continue;
        const name = record(t.name) ? t.name : {};
        const label = typeof name.simpleText === 'string' ? name.simpleText
          : Array.isArray(name.runs) ? name.runs.map(r => record(r) ? r.text ?? '' : '').join('') : t.languageCode;
        const track: Track = { id: `${String(t.vssId ?? t.languageCode)}:${index}`.slice(0, 500),
          name: String(label ?? '未知轨道').slice(0, 500), language: String(t.languageCode ?? '').slice(0, 100),
          kind: t.kind === 'asr' ? 'asr' : 'manual', fingerprint: '' };
        track.fingerprint = JSON.stringify([track.id, track.name, track.language, track.kind]);
        urls.set(track.id, url); result.tracks.push(track);
      }
      result.availability = result.tracks.length ? '' : '当前播放器没有提供可读取的字幕轨';
      return result;
    }
    function nativeClient() {
      const ytcfg = (window as unknown as { ytcfg?: { get?: (key: string) => unknown } }).ytcfg;
      const context = ytcfg?.get?.('INNERTUBE_CONTEXT');
      const client = record(context) && record(context.client) ? context.client : {};
      const pick = (key: string) => typeof client[key] === 'string' ? String(client[key]).slice(0, 200) : undefined;
      return Object.fromEntries(Object.entries({ c: pick('clientName'), cver: pick('clientVersion'), cos: pick('osName'),
        cosver: pick('osVersion'), cplatform: pick('platform'), cbr: pick('browserName'), cbrver: pick('browserVersion'),
        cplayer: 'UNIPLAYER', xorb: '2', xobt: '3', xovt: '3' }).filter(([, value]) => value));
    }
    function subtitleButton() {
      return document.querySelector<HTMLButtonElement>('#movie_player .ytp-subtitles-button');
    }
    document.addEventListener('yt-navigate-start', () => { session = crypto.randomUUID(); captionPrime = null; inFlight?.abort(); });
    addEventListener('message', async event => {
      const m = event.data;
      if (event.source !== window || event.origin !== location.origin || !record(m) || m.channel !== CHANNEL || m.direction !== 'request'
        || m.version !== 1 || typeof m.requestId !== 'string' || !/^[\w-]{1,100}$/.test(m.requestId)) return;
      const reply = (payload: object) => window.postMessage({ channel: CHANNEL, direction: 'response', version: 1, requestId: m.requestId, ...payload }, location.origin);
      if (m.type === 'info') { reply({ video: info() }); return; }
      if (m.type === 'native-target') {
        if (typeof m.trackId !== 'string') return;
        const v = info();
        if (!v || m.videoId !== v.videoId || m.session !== v.session || !urls.has(m.trackId)) {
          reply({ error: '视频或字幕轨已切换，请重新读取' }); return;
        }
        reply({ videoId: v.videoId, session: v.session, trackId: m.trackId, baseUrl: urls.get(m.trackId), client: nativeClient() });
        return;
      }
      if (m.type === 'prime-captions') {
        const v = info();
        if (!v || m.videoId !== v.videoId || m.session !== v.session) { reply({ error: '视频已切换，未触发字幕轨' }); return; }
        if (captionPrime?.session === v.session) { reply({ primed: true, toggled: captionPrime.toggled }); return; }
        const button = subtitleButton();
        if (!button || button.disabled) { reply({ error: 'YouTube 字幕按钮尚未就绪' }); return; }
        const toggled = button.getAttribute('aria-pressed') !== 'true';
        if (toggled) button.click();
        captionPrime = { session: v.session, toggled };
        reply({ primed: true, toggled }); return;
      }
      if (m.type === 'restore-captions') {
        const v = info(); const prime = captionPrime; captionPrime = null;
        if (v && prime?.session === v.session && prime.toggled) {
          const button = subtitleButton(); if (button?.getAttribute('aria-pressed') === 'true') button.click();
        }
        reply({ restored: true }); return;
      }
      if (m.type !== 'load' || typeof m.trackId !== 'string') return;
      if (busy) { reply({ error: '上一字幕请求仍在结束，请稍后重试' }); return; }
      const v = info();
      if (!v || m.videoId !== v.videoId || m.session !== v.session || !urls.has(m.trackId)) { reply({ error: '视频已切换，请重新读取字幕轨' }); return; }
      const target = urls.get(m.trackId)!;
      busy = true;
      const controller = new AbortController(); inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(target, { credentials: 'include', signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '字幕访问被拒绝，请在 YouTube 检查访问权限' : `字幕请求失败：HTTP ${response.status}`);
        const body = await boundedBody(response, 8_000_000, '字幕');
        if (info()?.session !== v.session) throw new Error('视频已切换，旧响应已丢弃');
        reply({ body, videoId: v.videoId, session: v.session, trackId: m.trackId });
      } catch (error) {
        reply({ error: error instanceof Error && error.name === 'AbortError' ? '字幕请求超时或视频切换，已停止' : error instanceof Error ? error.message : '字幕网络请求失败' });
      } finally { clearTimeout(timeout); busy = false; if (inFlight === controller) inFlight = null; }
    });
  },
});
