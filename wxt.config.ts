import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Language Helper',
    description: '显示 YouTube / B 站双语字幕并按语段定位和逐句跟读。无 AI、无账号同步。',
    minimum_chrome_version: '120',
    permissions: ['sidePanel', 'storage', 'webRequest'],
    host_permissions: ['https://www.youtube.com/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*'],
    action: { default_title: '打开原字幕面板' },
  },
});
