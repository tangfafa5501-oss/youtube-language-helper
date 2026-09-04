import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Language Helper',
    description: '显示 YouTube / B站双语字幕，B站人工字幕优先且可自动回退 AI 字幕。无账号同步。',
    minimum_chrome_version: '120',
    permissions: ['sidePanel', 'storage', 'webRequest', 'declarativeNetRequestWithHostAccess'],
    host_permissions: ['https://www.youtube.com/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://*.hdslb.com/*', 'https://openapi.youdao.com/*'],
    action: { default_title: '打开原字幕面板' },
  },
});
