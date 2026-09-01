# 研究依据与验证边界

更新：2026-08-31。

## 本机观察

参考发布包：

```text
C:\Users\alxanday\AppData\Local\Google\Chrome\User Data\Profile 2\Extensions\hiijpdndbjfnffibdhajdanjekbnalob\0.7.5_0
```

- `manifest.json`：Manifest V3、后台 `background.js`、侧边栏 `sidepanel.html`，YouTube/Netflix 内容脚本。
- `content-scripts/youtube.js`：通过页面播放器 `getPlayerResponse()` 等来源读取响应，使用页面消息桥接。
- `background.js`：可见 timedtext 请求观察、字幕、播放、同步及 Azure Speech 评估路径。
- `chunks/sidepanel-D1fHanSQ.js`：可见字幕、录音、听写、翻译、登录和视频登记等路径。
- AI 客户端默认访问 `https://worker.enjoy.bot`，向 `/translations`、`/chat/completions`、`/dictionary/query`、`/azure/tokens` 发送请求，并要求 Enjoy Bearer Token。
- 文本请求中模型名为 `default`，不能因此认定其真实模型供应商。
- 本地 AI 选择器存在云回退路径；独立实现必须避免不经用户同意切回 Enjoy。
- 原包启用 Azure 韵律评估，复制相同行为可能增加评分费用。

这些结论来自静态文件检查，不是登录账号测试、网络抓包或全功能运行验收。当前没有取得原始 TypeScript 工程，也没有确认发布包再分发许可；不直接把发布包当作本项目源码。

本轮只登记参考位置，尚未复制参考包。以后若建立研究副本，仅复制静态发布文件并核对哈希，不包含浏览器存储、Cookies、凭据；`research/enjoy-echo/` 已加入 Git 忽略。

## 官方资料

- [WXT](https://github.com/wxt-dev/wxt)：MIT 开源扩展框架，支持 TypeScript、MV3 和前端框架集成。
- [Plasmo](https://github.com/PlasmoHQ/plasmo)：评估过的替代框架，本项目选择 WXT，不同时引入。
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)：网址匹配、隔离环境、页面桥接边界。
- [Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)：侧边栏入口和标签页相关行为。
- [DeepSeek 接口](https://api-docs.deepseek.com/)：官方 API 地址、认证和请求格式。
- [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)：价格和模型会变化，实现与连接测试时复核，不固定使用旧报价。
- [Azure 语音评估](https://learn.microsoft.com/zh-cn/azure/ai-services/speech-service/how-to-pronunciation-assessment)：原扩展评分技术的对照。
- [腾讯新版口语评测计费](https://cloud.tencent.com/document/product/1774/107342)、[有道评测](https://ai.youdao.com/DOCSIRMA/html/tts/api/yypc/index.html)：后续候选，未决定接入、未购买。

## 排除项

`D:\github\bilibili-digest` 的字幕处理仍有用户报告的问题，本项目首期不采用其自然断句实现。B 站和 Netflix 不在首期支持列表。

本机 Whisper 与 Argos 模型已经检查过文件用途，但用户决定暂缓本地模型；本项目不复制、加载或安装相关依赖。
