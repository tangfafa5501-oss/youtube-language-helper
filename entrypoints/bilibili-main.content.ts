import { biliMetadata, biliTracks, biliVideo, bvidToAid } from '../lib/bilibili';
import { record } from '../lib/captions';

const BILI_CHANNEL = 'ylh-bilibili-page-v1';

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*', 'https://www.bilibili.com/list/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    addEventListener('message', async event => {
      const message = event.data;
      if (event.source !== window || event.origin !== location.origin || !record(message)
        || message.channel !== BILI_CHANNEL || message.direction !== 'request' || message.version !== 1
        || message.type !== 'metadata-tracks' || typeof message.requestId !== 'string' || message.requestId.length > 100) return;
      const reply = (payload: object) => window.postMessage({ channel: BILI_CHANNEL, direction: 'response', version: 1,
        requestId: message.requestId, ...payload }, location.origin);
      const current = biliVideo(location.href);
      if (!current || message.bvid !== current.bvid || message.page !== current.page) {
        reply({ error: 'B站视频已切换' }); return;
      }
      // Acknowledge synchronously so the isolated content script knows the
      // page-session bridge exists and must not start a duplicate fallback.
      reply({ stage: 'accepted' });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const currentCidElement = document.querySelector('.bpx-state-multi-active-item[data-cid]')
          ?? document.querySelector('[data-cid][aria-current="true"]')
          ?? document.querySelector('[data-cid]');
        const pageCid = Number(currentCidElement?.getAttribute('data-cid'));
        const pageAid = bvidToAid(current.bvid);
        const metadata = pageAid && Number.isFinite(pageCid) && pageCid > 0
          ? { aid: pageAid, cid: pageCid, title: document.querySelector('h1')?.textContent?.trim().slice(0, 1000) || document.title.slice(0, 1000) }
          : await biliMetadata(current.bvid, current.page, controller.signal);
        const result = await biliTracks(current.bvid, metadata.aid, metadata.cid, controller.signal);
        if (biliVideo(location.href)?.bvid !== current.bvid) throw new Error('B站视频已切换');
        reply({ metadata, tracks: result.tracks, needLogin: result.needLogin });
      } catch (error) {
        reply({ error: error instanceof Error && error.name === 'AbortError' ? 'B站字幕轨请求超时' : error instanceof Error ? error.message : 'B站字幕轨请求失败' });
      } finally { clearTimeout(timeout); }
    });
  },
});
