import { biliCues, biliMetadata, biliTracks, biliVideo, isBiliTrack } from './bilibili.ts';
import { BILI_NETWORK_CHANNEL, type BiliRoute } from './bilibili-network.ts';
import { record } from './captions.ts';

export const BILI_REFERER_RULE_ID = 47001;
export function bilibiliRefererRule(extensionId: string): Browser.declarativeNetRequest.Rule {
  return {
    id: BILI_REFERER_RULE_ID, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://bilibili.com' }] },
    condition: {
      regexFilter: '^https://([a-z0-9-]+\\.)*(bilibili\\.com|hdslb\\.com)/',
      initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest'], requestMethods: ['get'],
    },
  };
}

// Register a Bilibili-only service. No shared YouTube handler or cache is changed.
export function registerBilibiliNetwork() {
  const jobs = new Map<string, AbortController>();
  let headersReady: Promise<void> | undefined;
  const ensureHeaders = () => headersReady ??= browser.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [BILI_REFERER_RULE_ID], addRules: [bilibiliRefererRule(browser.runtime.id)],
  }).catch(() => { headersReady = undefined; throw new Error('B站请求头规则不可用，请重新加载扩展'); });
  const bound = async (tabId: number, route: BiliRoute) => {
    const tab = await browser.tabs.get(tabId);
    const current = biliVideo(tab.url ?? '');
    if (!current || current.bvid !== route.bvid || current.page !== route.page) throw new Error('B站视频已切换，旧请求已丢弃');
  };
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== BILI_NETWORK_CHANNEL || message.version !== 1) return;
    const respond = async () => {
      if (sender.id !== browser.runtime.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0
        || !biliVideo(sender.url ?? '') || typeof message.requestId !== 'string' || !/^[\w-]{1,100}$/.test(message.requestId)) {
        throw new Error('拒绝未绑定 B站主页面的后台请求');
      }
      const tabId = sender.tab!.id!, key = `${tabId}:${message.requestId}`;
      if (message.type === 'cancel') { jobs.get(key)?.abort(); return null; }
      if (typeof message.bvid !== 'string' || !/^BV1[0-9A-Za-z]{9}$/.test(message.bvid)
        || !Number.isSafeInteger(message.page) || Number(message.page) < 1 || Number(message.page) > 100_000) throw new Error('B站请求参数异常');
      if (message.type !== 'metadata-tracks' && message.type !== 'cues') throw new Error('未知 B站后台操作');
      if (message.type === 'cues' && (!isBiliTrack(message.track) || message.track.secondary)) throw new Error('B站字幕地址未通过校验');
      const route = { bvid: message.bvid, page: Number(message.page) };
      await bound(tabId, route);
      if (jobs.has(key) || [...jobs.keys()].filter(id => id.startsWith(`${tabId}:`)).length >= 4) throw new Error('B站后台请求仍在处理中');
      const controller = new AbortController(); jobs.set(key, controller);
      const timeout = setTimeout(() => controller.abort(), 12_000);
      try {
        await ensureHeaders();
        controller.signal.throwIfAborted();
        await bound(tabId, route);
        let result: unknown;
        if (message.type === 'cues') result = await biliCues(message.track as Parameters<typeof biliCues>[0], controller.signal);
        else {
          const metadata = await biliMetadata(route.bvid, route.page, controller.signal);
          result = { metadata, ...await biliTracks(route.bvid, metadata.aid, metadata.cid, controller.signal) };
        }
        controller.signal.throwIfAborted();
        await bound(tabId, route);
        return result;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('B站后台请求超时或已取消');
        if (error instanceof TypeError) throw new Error('B站后台网络请求失败，请检查网络连接与网站访问权限');
        throw error;
      } finally { clearTimeout(timeout); jobs.delete(key); }
    };
    void respond().then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false,
      error: error instanceof Error ? error.message : 'B站后台请求失败' }));
    return true;
  });
}
