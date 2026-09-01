import { captionUrl, record, watchVideoId } from '../lib/captions';
import { CHANNEL, type Track, type VideoInfo } from '../lib/protocol';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'], world: 'MAIN', runAt: 'document_start',
  main() {
    let currentId: string | null = null;
    let session = crypto.randomUUID();
    let inFlight: AbortController | null = null;
    let busy = false;
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
    document.addEventListener('yt-navigate-start', () => { session = crypto.randomUUID(); inFlight?.abort(); });
    addEventListener('message', async event => {
      const m = event.data;
      if (event.source !== window || event.origin !== location.origin || !record(m) || m.channel !== CHANNEL || m.direction !== 'request'
        || m.version !== 1 || typeof m.requestId !== 'string' || !/^[\w-]{1,100}$/.test(m.requestId)) return;
      const reply = (payload: object) => window.postMessage({ channel: CHANNEL, direction: 'response', version: 1, requestId: m.requestId, ...payload }, location.origin);
      if (m.type === 'info') { reply({ video: info() }); return; }
      if (m.type === 'word-timing') {
        if (typeof m.videoId !== 'string' || typeof m.session !== 'string' || typeof m.language !== 'string') return;
        if (busy) { reply({ error: '上一字幕请求仍在结束，请稍后重试' }); return; }
        const v = info();
        if (!v || m.videoId !== v.videoId || m.session !== v.session || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(m.language)) {
          reply({ error: '视频已切换，未请求词级时间' }); return;
        }
        busy = true; const controller = new AbortController(); inFlight = controller;
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try {
          const ytcfg = (window as unknown as { ytcfg?: { get?: (key: string) => unknown } }).ytcfg;
          const visitorData = ytcfg?.get?.('VISITOR_DATA');
          if (typeof visitorData !== 'string' || visitorData.length < 20 || visitorData.length > 2000) throw new Error('YouTube 页面没有可用访客会话');
          const context = { client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple',
            deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471', hl: 'en',
            timeZone: 'UTC', utcOffsetMinutes: 0, visitorData } };
          const playerResponse = await fetch('/youtubei/v1/player?prettyPrint=false', { method: 'POST', credentials: 'include',
            signal: controller.signal, redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-YouTube-Client-Name': '101',
              'X-YouTube-Client-Version': '1.02', 'X-Goog-Visitor-Id': visitorData },
            body: JSON.stringify({ videoId: v.videoId, context,
              playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } } }) });
          if (!playerResponse.ok) throw new Error(`YouTube 播放器接口失败：HTTP ${playerResponse.status}`);
          let player: unknown;
          try { player = JSON.parse(await boundedBody(playerResponse, 4_000_000, 'YouTube 播放器')); }
          catch (error) { throw error instanceof SyntaxError ? new Error('YouTube 播放器响应格式异常') : error; }
          if (!record(player) || !record(player.videoDetails) || player.videoDetails.videoId !== v.videoId) throw new Error('YouTube 播放器响应与视频不匹配');
          const captions = record(player.captions) ? player.captions : {};
          const renderer = record(captions.playerCaptionsTracklistRenderer) ? captions.playerCaptionsTracklistRenderer : {};
          const tracks = Array.isArray(renderer.captionTracks) ? renderer.captionTracks.filter(record) : [];
          const baseLanguage = m.language.toLowerCase().split('-')[0];
          const track = tracks.find(t => t.kind === 'asr' && String(t.languageCode).toLowerCase().split('-')[0] === baseLanguage)
            ?? tracks.find(t => t.kind === 'asr');
          if (!track || typeof track.baseUrl !== 'string') throw new Error('当前视频没有自动字幕词级时间轨');
          const target = captionUrl(track.baseUrl, v.videoId);
          if (!target) throw new Error('词级字幕地址未通过来源校验');
          const response = await fetch(target, { credentials: 'include', signal: controller.signal, redirect: 'error' });
          if (!response.ok) throw new Error(`词级字幕请求失败：HTTP ${response.status}`);
          const body = await boundedBody(response, 8_000_000, '词级字幕');
          if (!body.trim()) throw new Error('词级字幕返回空内容');
          if (info()?.session !== v.session) throw new Error('视频已切换，旧词级时间已丢弃');
          reply({ body, videoId: v.videoId, session: v.session });
        } catch (error) {
          reply({ error: error instanceof Error && error.name === 'AbortError' ? '词级时间请求超时或视频切换，已停止' : error instanceof Error ? error.message : '词级时间请求失败' });
        } finally { clearTimeout(timeout); busy = false; if (inFlight === controller) inFlight = null; }
        return;
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
