# Video Language Helper 交接记录

更新时间：2026-09-02 23:39（Asia/Taipei）
仓库：`D:\github\youtube-language-helper`
分支：`codex/initial-design`
当前代码提交：`d3b3974 fix: use native captions and enforce phrase rows`

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站学习侧栏。当前目标是让 YouTube 只使用网页原生 `timedtext` 字幕，并把显示层整理为连续自然语句：短于 2000ms 的字幕块必须向后合并，完整长句不能再被旧的 5 秒规则强行切碎。

本轮验收重点不是离线算法演示，而是最新生产构建在独立 Chrome for Testing 中经过 Service Worker 真正重载后运行。验收必须核对运行时文件 SHA-256、最终 Side Panel DOM 的 `data-display-mode=phrases`、所有字幕节点时长，以及用户指出的核心反例 `And what if you were wrong about every single one?`。

固定产品要求：

- YouTube 只使用网页原生字幕；B站继续使用网站官方字幕。
- 已撤销的第三方付费字幕服务已退出生产路线，不再提供 Key、付费请求、备用按钮或自动调用。
- canonical cues/timing 保持不变；自然语句是仅用于显示和学习控制的派生层。
- 不足 2000ms 的派生行向后合并；不再设置 5 秒硬拆分上限。
- 必须区分静态、单元测试、生产包模拟、真实数据离线回放、独立测试浏览器和用户当前安装环境，低等级证据不能冒充高等级证据。

## 2. 完成了什么

- 已提交 `d3b3974`，共变更 27 个文件：接入 YouTube 原生字幕捕获/缓存/请求，删除旧第三方字幕服务、旧 reading-lines/timed-phrases 生产实现及相应旧测试，更新设置、协议、侧栏和集成测试。
- 后台已监听 `/api/timedtext`，捕获正文与 `pot/potc`；内容脚本会消费实时 `captured` 消息，并在连接或刷新时优先查询 `latest` 缓存。失败、超时和格式异常均会回退到正常选轨请求，不会把侧栏卡在准备状态。
- 原生字幕解析和派生语句规则已落到 `lib/youtube-native.ts`：保留原始 cue，显示层合并不足 2 秒的片段，不做旧的 5 秒强拆分。
- 旧第三方字幕服务的生产入口、可选域权限、设置 UI、付费请求路由和旧实现文件已删除；后台仅保留一次性迁移，用于删除遗留存储和权限。对应安全回归仍保留，确保旧操作失败关闭且不会发起付费请求。
- 提交前验证记录：77/77 单元测试、61/61 生产 bundle 集成测试、TypeScript 类型检查和生产构建全部通过。
- 2026-09-02 11:02（Asia/Taipei），独立 Chrome for Testing 152 完成生产包真实数据回放，断言脚本输出 `ALL PASSED (100%)`，24/24 断言通过：
  - 脚本调用 `chrome.runtime.reload()`；记录旧 Worker `close`，关闭旧测试浏览器进程并以同一 Profile/加载目录重启，获得不同实例令牌的新 Worker，再额外等待 750ms。
  - 生产树 SHA-256：`A89A8ECD6CB49A4D9FC7B8AD81D6E96E82706470FBEF7A59DFFB7F477835D219`。
  - 运行时 `background.js`、`content-scripts/youtube.js`、`sidepanel.html` 的 source/package/running SHA-256 逐项一致；`youtube.js` 为 `66519CE62495C39EC1EEAE36AF180E65CF39B43B683A1D5163610E0E8537B815`。
  - `wKpqixrbb6E` 原生 JSON3 共 237257 字节，SHA-256 为 `441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`；最终 DOM 299 行，`data-display-mode=phrases`，`underTwoCountFromDom=0`，疑似错误小写续接为 0。
  - 核心反例回放结果为两行，其中完整出现 `And what if you were wrong about every single one?`；`single one?` 和 `wrong.` 的独立行计数均为 0，所有行时长均不少于 2000ms。
  - 点击 `A doctor, right before he lost everything.` 后播放器到达约 `10.579s`，控制台健康检查通过。
- 物证已随提交保存：
  - `artifacts/acceptance/test-browser-realdata-replay.png`
  - `artifacts/acceptance/test-browser-realdata-replay.png.json`
- 两张旧 `youtube-native-production-simulated-*.png` 没有纳入提交，已从仓库移到可恢复的临时备份目录：`C:\Users\alxanday\AppData\Local\Temp\youtube-language-helper-obsolete-simulated-20260902`。
- 2026-09-02 23:39 已全面重写 `README.md`、`design-qa.md` 及 `docs/` 中 5 份含旧路线的 Markdown；目标范围 8 个 Markdown 的旧服务名称/域名扫描结果为 0。
- 本轮文档清理前后 `lib/youtube-native.ts` SHA-256 均为 `BAB102B58F7B37ED4E8FA48CF295366D3034758DE0DE34FD24133154DC5D58DA`；`npm test` 实际输出 77/77 PASSED、0 failed。

## 3. 卡在哪里

- 当前最高证据等级是 `test-browser real-data replay`，不是用户当前 Chrome 的 `installed-real`，也不是 live timedtext 网络请求。Chrome for Testing 没有把原生 Side Panel 暴露为 Playwright page target；脚本虽调用 `chrome.sidePanel.open()`，仍只能在真实生产 `sidepanel.html` 页面完成 DOM/交互回放。
- 分支存在尚未推送的本地提交；准确数量以当前 `git status` 为准。本轮不自动推送。

## 4. 下一步计划

1. 在可自动控制用户当前 Chrome 原生 Side Panel 时，用同一构建、同一哈希和同一 DOM 断言补做 `installed-real` 验收；在此之前不得升级证据等级。
2. 若继续验证实时网络字幕，记录 timedtext 完成、后台捕获、标签页收到消息和侧栏首行渲染四个时间点。
3. 用户明确要求后再推送 `codex/initial-design`；推送前复核提交列表、远端和干净工作区。

## 5. 碰到哪些问题

- 早期实现把授权兜底放在正常字幕读取前，并轮询“所选轨正文缓存”而不是已经捕获的 `pot/potc`，导致网页已有授权时仍可能固定等待约 2.1 秒。现在改为选轨读取与授权捕获并行，授权出现即重试。
- 后台曾经只缓存并广播 `captured`，内容脚本没有消费；`latest` 也没有用于首屏。当前提交已补齐实时消费、重连查询及失败回退测试。
- 自动重载验证连续遇到三个基础设施限制：Playwright Worker 没有 `waitForEvent()`；命令行解压扩展在 `runtime.reload()` 后同进程不会自动注册新 Worker；测试页成为活动标签会让面板按安全绑定逻辑断开 YouTube。最终用 Worker `close` 事件、测试浏览器进程级重启和保持 YouTube 为活动标签解决。
- `wKpqixrbb6E` 的真实全文不包含用户截图里的 `And what if...`。为避免伪造真实数据结论，断言脚本把真实全文回放与用户四行 JSON3 核心反例分成两个明确数据场景。
- 提交后仍显示两项更改，直接原因是两张旧模拟截图为未跟踪文件。它们与本轮真实验收要求冲突，已移到临时备份；当前不应把这类文件混入最终物证。

## 6. 如何避免再次出现

- 每次提交后必须同时执行 `git status --short`；“代码已提交”与“工作区干净”必须分别核对，不能只报告提交哈希。
- 截图和 JSON 证据必须标出提交/构建、环境、数据来源、是否真实网络、是否用户当前安装环境及采集时间；文件名继续使用 `simulated`、`test-browser`、`installed-real` 等明确等级。
- Service Worker 重载证据必须包含旧实例关闭、新实例令牌、进程重启时间、稳定等待时间和运行时文件 SHA-256；只比较磁盘文件不算运行证据。
- 浏览器 DOM 门禁必须等待稳定状态，同时断言 `status=loaded`、`data-display-mode=phrases`、预期行数、所有节点时间存在、`underTwoCount=0` 和核心反例不存在独立碎片。
- 字幕速度分析必须记录网页 timedtext 完成、后台捕获、标签页收到 `captured`、侧栏首行渲染四个时间点；没有时间线就不能用“网络慢”或“缓存早晚”解释。
- 产品代码、测试、README、设计和验收文档必须在同一变更中做过期路线扫描。生产入口删除后仍需保留最小迁移/失败关闭测试，但不得让历史文档继续表现为当前路线。
