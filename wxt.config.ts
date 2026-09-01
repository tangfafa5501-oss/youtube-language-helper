import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Language Helper · M0',
    description: '显示 YouTube / B 站字幕并按语段定位、循环和跟读。无 AI、无账号同步。',
    minimum_chrome_version: '120',
    permissions: ['sidePanel', 'storage'],
    host_permissions: ['https://www.youtube.com/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*'],
    optional_host_permissions: ['https://api.supadata.ai/*'],
    action: { default_title: '打开原字幕面板' },
  },
});
