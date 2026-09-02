export const SERVICE_CHANNEL = 'ylh-service-v1';
export type ThemeSetting = 'system' | 'light' | 'dark';
export type DisplaySetting = 'phrases' | 'raw';
export type PublicSettings = { language: string; theme: ThemeSetting; displayMode: DisplaySetting };
export type ServiceReply = { ok: boolean; error?: string; settings?: PublicSettings };

export function trustedServiceSender(sender: { id?: string; url?: string }, extensionId: string, page: 'options' | 'sidepanel') {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === `/${page}.html` && !url.search && !url.hash;
  } catch { return false; }
}
