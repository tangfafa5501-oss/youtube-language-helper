import { record, watchVideoId } from '../lib/captions';
import { SERVICE_CHANNEL, trustedServiceSender, type ServiceReply } from '../lib/settings';
import { SUPADATA_ORIGIN, SupadataError, fetchSupadata, testSupadata, validLanguage } from '../lib/supadata';

export default defineBackground(() => {
  // Fail closed: do not save/read a secret unless content-script access is off.
  const protectedStorage = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => true, () => false);
  const active = new Map<string, AbortController>();
  const storageKey = 'supadata-v1';
  async function settings() {
    if (!await protectedStorage) throw new SupadataError('无法限制密钥存储访问，已停止');
    const result = (await browser.storage.local.get(storageKey))[storageKey];
    return { key: record(result) && typeof result.key === 'string' ? result.key : '',
      language: record(result) && validLanguage(result.language) ? result.language : 'en' };
  }
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== SERVICE_CHANNEL || message.version !== 1) return;
    const fromOptions = trustedServiceSender(sender, browser.runtime.id, 'options');
    const fromPanel = trustedServiceSender(sender, browser.runtime.id, 'sidepanel');
    if (!fromOptions && !fromPanel) { sendResponse({ ok: false, error: '拒绝非设置页/侧边栏的服务请求' }); return; }
    const respond = async (): Promise<ServiceReply> => {
      const config = await settings();
      if (message.type === 'settings') return { ok: true, settings: { hasKey: !!config.key, language: config.language } };
      if (message.type === 'save' || message.type === 'delete') {
        if (!fromOptions) throw new SupadataError('只允许在设置页修改密钥');
        if (message.type === 'delete') {
          for (const controller of active.values()) controller.abort();
          await browser.storage.local.remove(storageKey);
          return { ok: true, settings: { hasKey: false, language: 'en' } };
        }
        if (!validLanguage(message.language) || typeof message.key !== 'string') throw new SupadataError('Key 或语言格式不正确');
        const key = message.key.trim() || config.key;
        if (!key || !/^[\x21-\x7e]{8,512}$/.test(key)) throw new SupadataError('请输入有效 Key（不含空白字符）');
        await browser.storage.local.set({ [storageKey]: { key, language: message.language } });
        return { ok: true, settings: { hasKey: true, language: message.language } };
      }
      if (message.type !== 'test' && message.type !== 'transcript') throw new SupadataError('未知服务操作');
      if (message.type === 'test' && !fromOptions || message.type === 'transcript' && !fromPanel) throw new SupadataError('服务操作来源不匹配');
      if (!config.key) throw new SupadataError('请先在 API 设置中填写并保存 Supadata Key');
      if (!await browser.permissions.contains({ origins: [SUPADATA_ORIGIN] })) throw new SupadataError('请在 API 设置中测试连接并允许 Supadata 域名访问');
      let videoId = '';
      let requestedLanguage = config.language;
      const operation = message.type === 'test' ? 'test' : `tab:${message.tabId}`;
      if (message.type === 'transcript') {
        if (message.language !== undefined) {
          if (!validLanguage(message.language)) throw new SupadataError('字幕请求语言非法');
          requestedLanguage = message.language;
        }
        if (!Number.isInteger(message.tabId) || typeof message.videoId !== 'string') throw new SupadataError('视频绑定参数异常');
        const tab = await browser.tabs.get(message.tabId as number);
        if (!tab.url || watchVideoId(tab.url) !== message.videoId) throw new SupadataError('标签页视频已切换，未发送请求');
        videoId = message.videoId;
      }
      if (active.has(operation)) throw new SupadataError('已有请求进行中，请勿重复点击');
      const controller = new AbortController(); active.set(operation, controller);
      const timeout = setTimeout(() => controller.abort(), message.type === 'test' ? 15_000 : 90_000);
      try {
        if (message.type === 'test') return { ok: true, account: await testSupadata(config.key, controller.signal) };
        const result = await fetchSupadata(videoId, requestedLanguage, config.key, controller.signal);
        const tab = await browser.tabs.get(message.tabId as number);
        if (!tab.url || watchVideoId(tab.url) !== videoId) throw new SupadataError('视频已切换，服务结果已丢弃');
        return { ok: true, data: result.data, requestedLanguage };
      } finally { clearTimeout(timeout); active.delete(operation); }
    };
    void respond().then(sendResponse, error => sendResponse({ ok: false,
      error: error instanceof SupadataError ? error.message : '服务请求失败或超时，请检查网络后手动重试（不会自动重新提交）' }));
    return true;
  });
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    console.warn('YouTube Language Helper: side panel setup failed');
  });
});
