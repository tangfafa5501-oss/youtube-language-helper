import { record, watchVideoId } from '../lib/captions';
import { SERVICE_CHANNEL, trustedServiceSender, type PublicSettings, type ServiceReply } from '../lib/settings';
import { SUPADATA_ORIGIN, SupadataError, fetchSupadata, testSupadata, validLanguage } from '../lib/supadata';

export default defineBackground(() => {
  // Fail closed: do not save/read a secret unless content-script access is off.
  const protectedStorage = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => true, () => false);
  const active = new Map<string, { controller: AbortController; tabId?: number; videoId?: string }>();
  const storageKey = 'supadata-v1';
  const validKey = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);
  async function settings() {
    if (!await protectedStorage) throw new SupadataError('无法限制密钥存储访问，已停止');
    const result = (await browser.storage.local.get(storageKey))[storageKey];
    return { key: record(result) && validKey(result.key) ? result.key : '',
      language: record(result) && validLanguage(result.language) ? result.language : 'en',
      theme: record(result) && (result.theme === 'light' || result.theme === 'dark') ? result.theme : 'system',
      displayMode: record(result) && result.displayMode === 'raw' ? 'raw' : 'phrases' } as const;
  }
  const publicSettings = (config: Awaited<ReturnType<typeof settings>>): PublicSettings => ({
    hasKey: Boolean(config.key), language: config.language, theme: config.theme, displayMode: config.displayMode,
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== SERVICE_CHANNEL || message.version !== 1) return;
    const fromOptions = trustedServiceSender(sender, browser.runtime.id, 'options');
    const fromPanel = trustedServiceSender(sender, browser.runtime.id, 'sidepanel');
    if (!fromOptions && !fromPanel) { sendResponse({ ok: false, error: '拒绝非设置页/侧边栏的服务请求' }); return; }
    const respond = async (): Promise<ServiceReply> => {
      const config = await settings();
      if (message.type === 'settings') return { ok: true, settings: publicSettings(config) };
      if (message.type === 'save-preferences') {
        const theme: PublicSettings['theme'] | null = message.theme === 'light' || message.theme === 'dark' || message.theme === 'system' ? message.theme : null;
        const displayMode: PublicSettings['displayMode'] | null = message.displayMode === 'raw' || message.displayMode === 'phrases' ? message.displayMode : null;
        if (!theme || !displayMode) throw new SupadataError('外观设置格式不正确');
        const next = { ...config, theme, displayMode };
        await browser.storage.local.set({ [storageKey]: next });
        return { ok: true, settings: publicSettings(next) };
      }
      if (message.type === 'save' || message.type === 'delete') {
        if (message.type === 'delete') {
          for (const task of active.values()) task.controller.abort();
          const next = { ...config, key: '' };
          await browser.storage.local.set({ [storageKey]: next });
          await browser.permissions.remove({ origins: [SUPADATA_ORIGIN] }).catch(() => false);
          return { ok: true, settings: publicSettings(next) };
        }
        const language = typeof message.language === 'string' ? message.language.trim() : '';
        if (!validLanguage(language) || typeof message.key !== 'string') throw new SupadataError('Key 或语言格式不正确');
        if (typeof message.key !== 'string' || message.key.length > 512) throw new SupadataError('请输入有效 Key（不含空白字符）');
        const key = message.key.trim() || config.key;
        if (!validKey(key)) throw new SupadataError('请输入有效 Key（不含空白字符）');
        for (const task of active.values()) task.controller.abort();
        const next = { ...config, key, language };
        await browser.storage.local.set({ [storageKey]: next });
        return { ok: true, settings: publicSettings(next) };
      }
      if (message.type !== 'test' && message.type !== 'transcript') throw new SupadataError('未知服务操作');
      if (message.type === 'transcript' && !fromPanel) throw new SupadataError('服务操作来源不匹配');
      if (!config.key) throw new SupadataError('请先在 API 设置中填写并保存 Supadata Key');
      if (!await browser.permissions.contains({ origins: [SUPADATA_ORIGIN] })) throw new SupadataError('请在 API 设置中测试连接并允许 Supadata 域名访问');
      let videoId = '';
      let requestedLanguage = config.language;
      const purpose = message.purpose === 'secondary' ? 'secondary' : 'primary';
      const operation = message.type === 'test' ? 'test' : `tab:${message.tabId}:${purpose}`;
      if (message.type === 'transcript') {
        if (message.language !== undefined) {
          if (!validLanguage(message.language)) throw new SupadataError('字幕请求语言非法');
          requestedLanguage = message.language;
        }
        if (!Number.isInteger(message.tabId) || Number(message.tabId) <= 0 || typeof message.videoId !== 'string') throw new SupadataError('视频绑定参数异常');
        const tab = await browser.tabs.get(message.tabId as number);
        if (!tab.url || watchVideoId(tab.url) !== message.videoId) throw new SupadataError('标签页视频已切换，未发送请求');
        videoId = message.videoId;
      }
      if (active.has(operation)) throw new SupadataError('已有请求进行中，请勿重复点击');
      const controller = new AbortController();
      active.set(operation, { controller, ...(message.type === 'transcript' ? { tabId: message.tabId as number, videoId } : {}) });
      const timeout = setTimeout(() => controller.abort(), message.type === 'test' ? 15_000 : 90_000);
      try {
        if (message.type === 'test') return { ok: true, account: await testSupadata(config.key, controller.signal) };
        const result = await fetchSupadata(videoId, requestedLanguage, config.key, controller.signal);
        const tab = await browser.tabs.get(message.tabId as number);
        if (!tab.url || watchVideoId(tab.url) !== videoId) throw new SupadataError('视频已切换，服务结果已丢弃');
        return { ok: true, data: result.data, requestedLanguage };
      } finally {
        clearTimeout(timeout);
        if (active.get(operation)?.controller === controller) active.delete(operation);
      }
    };
    void respond().then(sendResponse, error => sendResponse({ ok: false,
      error: error instanceof SupadataError ? error.message : '服务请求失败或超时，请检查网络后手动重试（不会自动重新提交）' }));
    return true;
  });
  browser.tabs.onRemoved.addListener(tabId => {
    for (const [key, task] of active) if (key.startsWith(`tab:${tabId}:`)) task.controller.abort();
  });
  browser.tabs.onUpdated.addListener((tabId, change) => {
    for (const [key, task] of active) if (key.startsWith(`tab:${tabId}:`) && task.videoId && typeof change.url === 'string'
      && watchVideoId(change.url) !== task.videoId) task.controller.abort();
  });
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    console.warn('Video Language Helper: side panel setup failed');
  });
});
