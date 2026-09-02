# M0 当前验证记录

更新时间：2026-09-02。本文件只保留当前生产路线和仍有效的证据；已撤销实现及其阶段性数字不再作为现状依据。

## 1. 自动化基线

| 层级 | 结果 | 能证明什么 |
| --- | --- | --- |
| 静态检查 | TypeScript 类型检查、生产构建通过 | 源码类型和 MV3 构建成立 |
| 单元测试 | 82/82 PASSED | 解析、缓存、自然分句、状态机、精准 seek、边界与监听器生命周期 |
| 生产 bundle 集成 | 61/61 PASSED | 构建产物中的消息、会话、加载和播放协议 |
| 独立测试浏览器 | 20/20，`ALL PASSED (100%)` | 当前生产包哈希、双平台控制、精准定位、句尾暂停和原生字幕隔离 |

单元测试命令：

```powershell
npm test
```

完整生产集成命令：

```powershell
npm run test:integration
```

## 2. 当前播放闭环环境与构建身份

测试环境：Chrome for Testing 152，非无头、独立 Profile，解压加载由当前 `.output/chrome-mv3` 复制的 QA 包。

- 采集时间：`2026-09-03 04:21`（Asia/Taipei）。
- `background.js`、YouTube/B站 main/content script 和 `sidepanel.html` 的构建、QA 包、运行时 SHA-256 逐项一致。
- `content-scripts/youtube.js`：`BC0A7A15519A69837ECD0B35C2659554E8A424A3E66CC9C2DE32F55956823527`。
- `content-scripts/bilibili.js`：`50517E4E622B4593C9FA24D39E6DBBE5D89ABE1CEF0B9CE3A6E02E7CEA80736E`。
- 播放断言无相关脚本错误；最终采集记录到 4 条 YouTube 外部广告 `doubleclick.net` CORS/资源失败噪声，不来自扩展代码，也未影响 20/20 结果。

本轮重点是播放状态机，不重复宣称 Service Worker 热重载；运行时身份由当前构建、复制包和浏览器运行资源三方哈希证明。

## 3. YouTube 真实 JSON3 回放

- 视频：`wKpqixrbb6E`。
- 数据：原生 JSON3，237257 字节。
- 数据 SHA-256：`441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`。
- 最终 Side Panel DOM：299 行。
- 根容器：`data-display-mode=phrases`。
- 所有字幕节点都有时间。
- `underTwoCountFromDom=0` 是该真实数据集的观察值，不再是产品硬门槛。
- 疑似小写错误续接计数为 0。
- `A doctor, right before he lost everything.` 与 `His name was Dr. Jekyll, and this is his story.` 均完整出现。
- 点击第一句定位报告为 `10.560s → 10.560s`、误差 `0.0ms`。
- 下一句定位报告为 `14.160s → 14.160s`、误差 `0.0ms`；上一句返回 `10.560s`。
- 快速“下一句→上一句→下一句”后只保留最后目标 `14.160s`。
- Manual 在 `20.600s` 精确暂停，450ms 后仍为暂停且媒体时钟不变；播放键只推进一条到 `18.560s`。
- YouTube 原生 CC 状态在操作前后保持 `true → true`。
- 页面和面板相关错误为空。

## 4. 核心反例

真实全文不包含用户截图中的目标句，因此断言脚本把用户提供的四行字幕事件编码为独立 JSON3 场景，避免把合成反例冒充视频全文。

输入碎片包含：

- `And what if you were wrong about every`
- `single one?`
- `Think about that. Every match completely`
- `wrong.`

最终 DOM 只保留两行：

1. `And what if you were wrong about every single one?`
2. `Think about that. Every match completely wrong.`

断言结果：显示模式正确、目标疑问句精确合并、禁止碎片独立行数为 0。低于 2000ms 不再作为失败条件。

## 5. Bilibili 当前边界

生产 bundle 已覆盖官方轨道读取、网站双语、主副轨独立加载、快速切轨、Auto/Manual、SPA 分 P 和多标签页隔离。本轮 test-browser 另用受控官方响应结构与真实 Chromium 媒体元素验证：`1.500s → 1.500s`、句尾 `2.500s` 精确暂停、450ms 不续播、播放只推进一条、原生 text track 保持 `count=1/mode=showing`、断连后旧 Manual 边界不再生效。

自动化中的 B站接口响应属于受控数据，不应表述为本轮实时网站请求。长时间轴模拟也不能冒充真实长视频定位。

## 6. 证据文件

当前播放闭环证据（临时 QA 目录，不纳入仓库）：

- `C:\Users\alxanday\AppData\Local\Temp\ylh-playback-qa-20260903\playback-validation.json`
- `C:\Users\alxanday\AppData\Local\Temp\ylh-playback-qa-20260903\youtube-playback-test-browser.png`
- `C:\Users\alxanday\AppData\Local\Temp\ylh-playback-qa-20260903\bilibili-playback-test-browser.png`

以下为此前字幕显示验收物证：

- `artifacts/acceptance/test-browser-realdata-replay.png`
- `artifacts/acceptance/test-browser-realdata-replay.png.json`
- `artifacts/acceptance/sidepanel-main-test-browser.png`
- `artifacts/acceptance/sidepanel-narrow-test-browser.png`
- `artifacts/acceptance/primary-subtitle-menu-test-browser.png`
- `artifacts/acceptance/secondary-subtitle-menu-test-browser.png`
- `artifacts/acceptance/follow-mode-test-browser.png`
- `artifacts/acceptance/settings-light-test-browser.png`
- `artifacts/acceptance/settings-dark-test-browser.png`

旧 `simulated` 图片不得作为当前真实数据回放物证。两张未跟踪的旧图片已移出仓库，不纳入提交。

## 7. 尚未覆盖

- 用户当前 Chrome 原生 Side Panel 的 `installed-real`。
- 本轮提交在真实网络 timedtext 下的端到端抓取时序。
- Chrome for Testing 原生 Side Panel target；当前自动化记录 `nativeSidePanelTarget=false`，在真实生产 `sidepanel.html` 页面执行 DOM 门禁。

以上边界不会降低当前 20/20 播放闭环证据，但禁止把证据等级升级为未执行的环境。
