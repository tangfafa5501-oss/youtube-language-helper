export const SERVICE_CHANNEL = 'ylh-service-v1';
export type PublicSettings = { hasKey: boolean; language: string };
export type ServiceReply = { ok: boolean; error?: string; requestedLanguage?: string; settings?: PublicSettings;
  account?: { plan: string; maxCredits: number; usedCredits: number }; data?: unknown };

export function trustedServiceSender(sender: { id?: string; url?: string }, extensionId: string, page: 'options' | 'sidepanel') {
  if (sender.id !== extensionId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === extensionId && url.pathname === `/${page}.html` && !url.search && !url.hash;
  } catch { return false; }
}
