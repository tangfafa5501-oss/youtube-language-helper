import { record, watchVideoId } from '../lib/captions';
import { registerBilibiliNetwork } from '../lib/bilibili-background';
import { SERVICE_CHANNEL, trustedServiceSender, type PublicSettings, type ServiceReply } from '../lib/settings';
import { createAssessmentService } from '../lib/assessment-service';
import { YOUDAO_CHANNEL, YOUDAO_ORIGIN } from '../lib/youdao';
import { readAssessmentRecording, saveRecordingAssessment } from '../lib/assessment-store';
import { YOUTUBE_NATIVE_CACHE_KEY, YOUTUBE_NATIVE_CHANNEL, applyNativeAuth, boundedNativeCache, chooseNativeTranscript,
  observedTimedText, timedTextFormat, validNativeTranscript, type NativeAuth, type NativeTrackKind,
  type NativeTranscript } from '../lib/youtube-native';

export default defineBackground(() => {
  registerBilibiliNetwork();
  // Fail closed: do not save/read a secret unless content-script access is off.
  const protectedStorage = browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).then(() => true, () => false);
  const assessmentKey = 'youdao-assessment-v1';
  const assessmentService = createAssessmentService({
    extensionId: browser.runtime.id, protectedStorage,
    permitted: () => browser.permissions.contains({ origins: [YOUDAO_ORIGIN] }),
    readCredentials: async () => (await browser.storage.local.get(assessmentKey))[assessmentKey],
    writeCredentials: async value => { if (value) await browser.storage.local.set({ [assessmentKey]: value }); else await browser.storage.local.remove(assessmentKey); },
    getRecording: readAssessmentRecording,
    saveAssessment: saveRecordingAssessment,
  });
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== YOUDAO_CHANNEL || message.version !== 1) return;
    void assessmentService(message, sender).then(sendResponse); return true;
  });
  const settingsKey = 'settings-v2';
  const legacySettingsKey = 'supadata-v1';
  const nativeAuth = new Map<string, NativeAuth>();
  let nativeCache: NativeTranscript[] = [];
  const nativeCacheReady = (async () => {
    try {
      const stored = (await browser.storage.session.get(YOUTUBE_NATIVE_CACHE_KEY))[YOUTUBE_NATIVE_CACHE_KEY];
      nativeCache = boundedNativeCache(Array.isArray(stored) ? stored : []);
    } catch { nativeCache = []; }
  })();
  async function saveNativeTranscript(entry: NativeTranscript) {
    await nativeCacheReady;
    nativeCache = boundedNativeCache([entry, ...nativeCache]);
    try { await browser.storage.session.set({ [YOUTUBE_NATIVE_CACHE_KEY]: nativeCache }); } catch { /* Memory cache still works. */ }
  }
  async function boundedText(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('YouTube 字幕没有响应体');
    const decoder = new TextDecoder(); let body = '', size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8_000_000) { await reader.cancel(); throw new Error('YouTube 字幕响应过大'); }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    if (!body.trim()) throw new Error('YouTube 原生字幕返回空内容');
    return body;
  }
  async function boundYouTubeTab(tabId: number, videoId: string) {
    const tab = await browser.tabs.get(tabId);
    if (!tab.url || watchVideoId(tab.url) !== videoId) throw new Error('标签页视频已切换，旧字幕已丢弃');
    return tab;
  }
  async function fetchNative(url: string, tabId: number, videoId: string, language: string, kind: NativeTrackKind,
    requestCompletedAt?: number) {
    await boundYouTubeTab(tabId, videoId);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(url, { credentials: 'include', redirect: 'error', cache: 'force-cache', signal: controller.signal });
      if (!response.ok) throw new Error(`YouTube 原生字幕请求失败：HTTP ${response.status}`);
      const body = await boundedText(response);
      await boundYouTubeTab(tabId, videoId);
      const entry: NativeTranscript = { videoId, language, kind, body, format: timedTextFormat(body),
        ...(requestCompletedAt ? { requestCompletedAt } : {}), capturedAt: Date.now() };
      await saveNativeTranscript(entry);
      return entry;
    } finally { clearTimeout(timeout); }
  }
  const trustedYouTubeSender = async (sender: Browser.runtime.MessageSender, videoId: string) => {
    if (sender.id !== browser.runtime.id || !Number.isInteger(sender.tab?.id)
      || (sender.frameId !== undefined && sender.frameId !== 0)) return null;
    try { await boundYouTubeTab(sender.tab!.id!, videoId); return sender.tab!.id!; } catch { return null; }
  };

  browser.webRequest?.onCompleted.addListener(details => {
    if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300) return;
    const observed = observedTimedText(details.url); if (!observed) return;
    void (async () => {
      try {
        await boundYouTubeTab(details.tabId, observed.videoId);
        if (observed.pot || observed.potc) nativeAuth.set(observed.videoId,
          { pot: observed.pot, potc: observed.potc, capturedAt: Date.now() });
        const target = new URL(observed.url); target.searchParams.set('fmt', 'json3');
        const entry = await fetchNative(target.href, details.tabId, observed.videoId, observed.language, observed.kind,
          details.timeStamp);
        await browser.tabs.sendMessage(details.tabId, { channel: YOUTUBE_NATIVE_CHANNEL, version: 1, type: 'captured',
          videoId: entry.videoId, language: entry.language, kind: entry.kind }).catch(() => undefined);
      } catch { /* Page bridge can still request the selected track explicitly. */ }
    })();
  }, { urls: ['https://www.youtube.com/api/timedtext*'] });

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== YOUTUBE_NATIVE_CHANNEL || message.version !== 1) return;
    const respond = async () => {
      if (typeof message.videoId !== 'string' || !/^[\w-]{11}$/.test(message.videoId)) throw new Error('原生字幕请求参数异常');
      const tabId = await trustedYouTubeSender(sender, message.videoId);
      if (tabId === null) throw new Error('拒绝未绑定当前视频的原生字幕请求');
      if (message.type === 'latest') {
        await nativeCacheReady;
        const entry = nativeCache.filter(item => item.videoId === message.videoId)
          .sort((left, right) => right.capturedAt - left.capturedAt)[0];
        return entry ? { ok: true, entry } : { ok: false, error: 'cache-miss' };
      }
      if (!validLanguage(message.language) || (message.kind !== 'manual' && message.kind !== 'asr')) {
        throw new Error('原生字幕请求参数异常');
      }
      const kind = message.kind as NativeTrackKind;
      if (message.type === 'cache') {
        await nativeCacheReady;
        const entry = chooseNativeTranscript(nativeCache, message.videoId, message.language, kind);
        return entry ? { ok: true, entry } : { ok: false, error: 'cache-miss' };
      }
      if (message.type === 'auth-status') {
        const auth = nativeAuth.get(message.videoId);
        return { ok: true, available: Boolean(auth && Date.now() - auth.capturedAt <= 10 * 60_000) };
      }
      if (message.type !== 'fetch' || typeof message.baseUrl !== 'string') throw new Error('未知原生字幕操作');
      const target = applyNativeAuth(message.baseUrl, message.videoId, nativeAuth.get(message.videoId) ?? null, message.client);
      if (!target) throw new Error('字幕地址未通过 YouTube 来源校验');
      const entry = await fetchNative(target, tabId, message.videoId, message.language, kind);
      if (!validNativeTranscript(entry)) throw new Error('原生字幕响应结构异常');
      return { ok: true, entry };
    };
    void respond().then(sendResponse, error => sendResponse({ ok: false,
      error: error instanceof Error && error.name === 'AbortError' ? 'YouTube 原生字幕请求超时' : error instanceof Error ? error.message : '原生字幕请求失败' }));
    return true;
  });
  const validLanguage = (value: unknown): value is string => typeof value === 'string'
    && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value);
  let settingsInFlight: Promise<PublicSettings> | null = null;
  async function readSettings() {
    if (!await protectedStorage) throw new Error('无法读取扩展本地设置');
    const stored = await browser.storage.local.get([settingsKey, legacySettingsKey]);
    const current = record(stored[settingsKey]) ? stored[settingsKey] : record(stored[legacySettingsKey]) ? stored[legacySettingsKey] : {};
    const config: PublicSettings = {
      language: validLanguage(current.language) ? current.language : 'en',
      theme: current.theme === 'light' || current.theme === 'dark' ? current.theme : 'system',
      displayMode: 'phrases',
    };
    if (!record(stored[settingsKey]) || current.displayMode !== 'phrases') await browser.storage.local.set({ [settingsKey]: config });
    if (stored[legacySettingsKey] !== undefined) {
      await browser.storage.local.remove(legacySettingsKey);
      await browser.permissions.remove({ origins: ['https://api.supadata.ai/*'] }).catch(() => false);
    }
    return config;
  }
  async function settings() {
    if (settingsInFlight) return settingsInFlight;
    const task = readSettings(); settingsInFlight = task;
    try { return await task; } finally { if (settingsInFlight === task) settingsInFlight = null; }
  }
  void settings().catch(() => undefined);
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!record(message) || message.channel !== SERVICE_CHANNEL || message.version !== 1) return;
    const fromOptions = trustedServiceSender(sender, browser.runtime.id, 'options');
    const fromPanel = trustedServiceSender(sender, browser.runtime.id, 'sidepanel');
    if (!fromOptions && !fromPanel) { sendResponse({ ok: false, error: '拒绝非设置页/侧边栏的服务请求' }); return; }
    const respond = async (): Promise<ServiceReply> => {
      const config = await settings();
      if (message.type === 'settings') return { ok: true, settings: config };
      if (message.type === 'save-preferences') {
        const theme: PublicSettings['theme'] | null = message.theme === 'light' || message.theme === 'dark' || message.theme === 'system' ? message.theme : null;
        const displayMode: PublicSettings['displayMode'] | null = message.displayMode === 'phrases' ? 'phrases' : null;
        const language = typeof message.language === 'string' ? message.language.trim() : config.language;
        if (!theme || !displayMode || !validLanguage(language)) throw new Error('设置格式不正确');
        const next: PublicSettings = { language, theme, displayMode };
        await browser.storage.local.set({ [settingsKey]: next });
        return { ok: true, settings: next };
      }
      throw new Error('未知设置操作');
    };
    void respond().then(sendResponse, error => sendResponse({ ok: false,
      error: error instanceof Error ? error.message : '设置操作失败' }));
    return true;
  });
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    console.warn('Video Language Helper: side panel setup failed');
  });
});
