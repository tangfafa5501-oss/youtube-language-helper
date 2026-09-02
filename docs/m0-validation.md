# M0 当前验证记录

更新时间：2026-09-02。本文件只保留当前生产路线和仍有效的证据；已撤销实现及其阶段性数字不再作为现状依据。

## 1. 自动化基线

| 层级 | 结果 | 能证明什么 |
| --- | --- | --- |
| 静态检查 | TypeScript 类型检查、生产构建通过 | 源码类型和 MV3 构建成立 |
| 单元测试 | 77/77 PASSED | 解析、缓存、分句、时间、双轨和播放纯逻辑 |
| 生产 bundle 集成 | 61/61 PASSED | 构建产物中的消息、会话、加载和播放协议 |
| 独立测试浏览器 | 24/24，`ALL PASSED (100%)` | 最新生产包重载、哈希、真实 JSON3 回放和最终 DOM |

单元测试命令：

```powershell
npm test
```

完整生产集成命令：

```powershell
npm run test:integration
```

## 2. Service Worker 与构建身份

测试环境：Chrome for Testing 152，解压加载 `.output/chrome-mv3`。

- 调用 `chrome.runtime.reload()`：`2026-09-02T03:02:15.272Z`。
- 旧 Worker 关闭：`2026-09-02T03:02:15.338Z`。
- 旧测试浏览器进程关闭：`2026-09-02T03:02:15.510Z`。
- 新 Worker 出现：`2026-09-02T03:02:16.599Z`，随后稳定等待 750ms。
- 新旧 Worker 实例令牌不同。
- 生产树 SHA-256：`A89A8ECD6CB49A4D9FC7B8AD81D6E96E82706470FBEF7A59DFFB7F477835D219`。
- `background.js`、`content-scripts/youtube.js` 和 `sidepanel.html` 的 source/package/running SHA-256 逐项一致。

命令行加载的解压扩展在同一测试进程中不会自动重新注册 Worker，因此自动脚本在确认旧 Worker `close` 后关闭旧进程，再使用同一 Profile 和加载目录重启。这是本环境完成真实重载所需的步骤，不得简化为仅比较磁盘文件。

## 3. YouTube 真实 JSON3 回放

- 视频：`wKpqixrbb6E`。
- 数据：原生 JSON3，237257 字节。
- 数据 SHA-256：`441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`。
- 最终 Side Panel DOM：299 行。
- 根容器：`data-display-mode=phrases`。
- 所有字幕节点都有时间。
- `underTwoCountFromDom=0`。
- 疑似小写错误续接计数为 0。
- `A doctor, right before he lost everything.` 与 `His name was Dr. Jekyll, and this is his story.` 均完整出现。
- 点击第一句后播放器到达约 `10.579s`。
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

断言结果：显示模式正确、目标疑问句精确合并、禁止碎片独立行数为 0、所有行不少于 2000ms、总行数为 2。

## 5. Bilibili 当前边界

生产 bundle 已覆盖官方轨道读取、网站双语、主副轨独立加载、快速切轨、点击定位、连续播放、逐句跟读、SPA 分 P 和多标签页隔离。历史真实登录浏览器证据可证明当时安装版本的主要交互，但不能自动覆盖当前提交。

自动化中的 B站接口响应属于受控数据，不应表述为本轮实时网站请求。长时间轴模拟也不能冒充真实长视频定位。

## 6. 证据文件

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

以上边界不会降低现有 24/24 回放证据，但禁止把证据等级升级为未执行的环境。
