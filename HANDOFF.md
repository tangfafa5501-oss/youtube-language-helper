# Video Language Helper 交接记录

更新时间：2026-09-02 10:33（Asia/Taipei）
仓库：`D:\github\youtube-language-helper`
分支：`codex/initial-design`
提交前基线 HEAD：`fdad802 fix: keep settings dropdowns above content`

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站学习侧栏。当前核心目标是让 YouTube 字幕像用户实测的 Enjoy Echo 一样，在网页同一次刷新中随画面立即出现，不要求用户点击连接、重新读取或执行额外刷新。

用户最新固定要求：

- 放弃 Supadata 产品路线，不再提供付费字幕接口、Key、备用按钮或自动调用。
- YouTube 只使用网页原生 `timedtext` 字幕；B站继续使用网站官方字幕。
- 分句保留“不足 2 秒向后合并”；取消 5 秒拆分，长句不再因为超过 5 秒被强制切开。
- 字幕一到就自动显示；不能把 Enjoy 的最长约 2 秒冷启动兜底误说成正常速度。

## 2. 完成了什么

- 只读检查了本机已安装的 Enjoy Echo 0.7.5 发布包（不是完整原始仓库，也没有复制其代码）：
  - `C:\Users\alxanday\AppData\Local\Google\Chrome\User Data\Profile 2\Extensions\hiijpdndbjfnffibdhajdanjekbnalob\0.7.5_0\content-scripts\content.js`
  - 同目录 `background.js` 与 `manifest.json`
- 已确认 Enjoy 的发布逻辑：后台 `webRequest.onCompleted` 监听 `/api/timedtext`，捕获 `pot/potc`、重新读取正文并向侧栏发送 `TRANSCRIPT_PARSE_RAW`；没有授权参数时，内容脚本才以 150ms 间隔做最长约 2 秒的异常兜底。
- 已定位本项目的主要算法错误：它轮询“所选字幕轨正文缓存”，而不是轮询 `pot/potc`。网页先请求自动轨、侧栏选人工轨时，授权参数已经可用，但轨类型缓存不匹配，代码仍会白等 14 × 150ms。
- `entrypoints/youtube.content.ts` 已改为：所选轨读取从第 0ms 启动；授权捕获与直接请求并行；每 150ms 检查授权参数，一出现就立即重试所选轨，不再等待同轨正文缓存跑满。
- `tests/integration/bridge.test.mjs` 已加入两项针对上述错误的生产 bundle 回归：直接请求必须先于授权查询；冷启动授权出现后必须在 700ms 内重试，不能等待旧 2.1 秒循环。
- 原生字幕基础设施已存在：`webRequest` 监听、会话缓存、主/第二字幕轨、原生 JSON3 解析、只合并不足 2 秒行且不做 5 秒拆分。
- Supadata 退出工作已开始：
  - `wxt.config.ts` 已移除 Supadata 可选域权限。
  - 设置页已移除 Key、连接测试、备用服务和删除 Key UI，字幕语言改为普通本地设置。
  - 侧栏已移除 Supadata 失败回退按钮及调用函数。
  - 后台已移除付费 transcript/test 路由，使用 `settings-v2`；首次迁移只保留语言/主题/显示模式，并删除旧 `supadata-v1` Key 与权限。
  - YouTube 内容脚本已删除 Supadata 消息、解析和词级校准路径；协议来源已移除 `supadata`。
- 最新静态状态：`npm run typecheck` 通过；`git diff --check` 无错误（只有 Git 的 LF→CRLF 提示）。
- Supadata 清理及短句候选源码已从已验证工作树逐文件迁入当前分支；本目录重新验证为 77/77 单元测试、61/61 生产 bundle 集成测试、TypeScript 类型检查和生产构建全部通过。
- 2026-09-02 10:31，独立 Chrome for Testing 152 的全自动真实数据回放门禁打印 `ALL PASSED (100%)`，24/24 断言通过：
  - 自动脚本先写入 `chrome.storage.session`，调用 `chrome.runtime.reload()`，确认旧 Worker `close`；由于命令行解压扩展在同进程内不会重新注册，随后关闭旧测试浏览器进程并以同一 Profile/加载目录重启，取得不同实例令牌的新 Worker。
  - 新 Worker 实际读取的生产 `background.js`、`content-scripts/youtube.js`、`sidepanel.html` SHA-256 与 `D:\github\youtube-language-helper\.output\chrome-mv3` 及测试加载目录逐项一致。
  - `wKpqixrbb6E` 原生 JSON3（237257 字节，SHA-256 `441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`）最终渲染 299 行，`data-display-mode=phrases`，DOM `<2 秒` 数量 0，疑似小写续接 0；`A doctor, right before he lost everything.` 和 `His name was Dr. Jekyll, and this is his story.` 完整出现。
  - 点击第一句后播放器到达 `10.578988s`；用户现场四行 JSON3 反例另行回放为 `And what if you were wrong about every single one?` 与 `Think about that. Every match completely wrong.`，`single one?` / `wrong.` 独立行数为 0。
  - 物证：`artifacts/acceptance/test-browser-realdata-replay.png` 及同名 `.json`。这是 `test-browser real-data replay`，不是 `installed-real`，也不是 live timedtext。

## 3. 卡在哪里

- “网页字幕截获后立即推送并渲染”尚未接完。后台已经向标签页发 `type: 'captured'`，但 `entrypoints/youtube.content.ts` 仍没有消费该消息。
- 后台刚加入 `type: 'latest'`，可返回当前视频最新原生缓存；内容脚本尚未在侧栏连接/页面刷新时使用它。正常首屏仍可能先走选轨请求，而不是直接显示网页刚截获的字幕。
- Supadata 清理尚未收尾：
  - `tests/integration/bridge.test.mjs` 仍保留多组旧 Supadata 测试，当前完整集成测试预计失败。
  - `tests/visual/serve-sidepanel.mjs` 仍有 `hasKey`、Supadata 指标和旧服务模拟。
  - `lib/supadata.ts`、`lib/vendor/digest-transcript.ts` 及其历史单元测试仍在仓库；它们已从生产运行入口断开，但是否删除需在清理时统一决定。
  - `docs/design.md`、`docs/m0-validation.md`、`docs/subtitle-diagnosis.md` 仍有大量已过时的 Supadata 主路线说明。
- 当前源码重建的 `.output\chrome-mv3` 已再次完成 24/24 `test-browser real-data replay`；生产树 SHA-256 为 `A89A8ECD6CB49A4D9FC7B8AD81D6E96E82706470FBEF7A59DFFB7F477835D219`，运行时 `youtube.js` SHA-256 为 `66519CE62495C39EC1EEAE36AF180E65CF39B43B683A1D5163610E0E8537B815`，三方一致。
- 本次候选已完成提交前验证，等待创建一个本地提交；不得把旧 `simulated` 截图混入最终物证，也不自动推送。
- Chrome for Testing 没有把原生 Side Panel 暴露为 Playwright page target；脚本调用了 `chrome.sidePanel.open()`，记录 `nativeSidePanelTarget=false` 后使用真实生产 `sidepanel.html` 做 DOM/交互回放。因此 24/24 只升级独立 test-browser 门禁，不覆盖用户当前 Chrome 的 installed-real 状态。
- 当前目录分支为 `codex/initial-design` / 基线 `fdad802`。已将通过门禁的候选源码从 `codex/youtube-native-subtitles` 工作树按 17 个现存文件的 SHA-256 逐项同步，并按候选提交删除 7 个旧 Supadata/reading-lines/timed-phrases 文件；本目录重建及 24/24 浏览器复验均已通过。

## 4. 下一步计划

1. 创建本地提交后核对提交内容与工作区，确认只剩明确排除的旧 `simulated` 图片或其他未提交用户文件；不自动推送。
2. 后续如能自动控制用户当前 Chrome 原生 Side Panel，再做同构建的 `installed-real` 验收；当前 test-browser 通过不得替代该层。
3. 统一清理仍含 Supadata 历史路线的设计/验收文档；此文档整理不得改变已经通过的生产行为。

## 5. 碰到哪些问题

- 之前把“Enjoy 可能更早预缓存”当作主要解释，但用户明确说明两个扩展始终一起刷新。该解释不符合现场条件，已撤回。
- 真正差异是算法顺序：Enjoy 正常路径接收网页同次刷新产生的字幕正文；本项目把截获结果只存缓存并发通知，却没有直接渲染，又在冷启动时轮询错误的对象。
- 旧实现把最长约 2 秒的授权兜底放到了正常读取前面，因此人为制造固定等待。
- 一次完整集成测试在输出 B站前半部分后没有取得最终汇总，不能记为通过。
- 历史文档中同时存在 5 秒硬拆分、6 秒建议和 Supadata 主路线等互相覆盖的旧决策，必须按本文件的最新用户要求统一清理。
- 自动重载脚本连续暴露了三个测试基础设施问题：Playwright Worker 没有 `waitForEvent()`；命令行加载的扩展在 `runtime.reload()` 后同进程不自动注册新 Worker；普通扩展测试页成为活动标签会让面板按安全绑定逻辑断开 YouTube。最终通过 Worker `close` 事件、测试进程级重启、保持 YouTube 为活动标签解决。
- `wKpqixrbb6E` 的真实全文不包含 `And what if...`，因此该句不能在这份真实全文里伪造覆盖；脚本把真实全文与用户截图四行反例明确拆成两个数据场景，并分别断言。

## 6. 如何避免再次出现

- 速度问题必须记录四个时间点：网页 `timedtext` 完成、后台缓存完成、标签页收到 `captured`、侧栏首行渲染。没有时间线就不能用“网络慢”“缓存早晚”解释。
- 明确区分 Enjoy 的正常即时推送与最长约 2 秒的异常授权兜底；不得把兜底时间当作产品目标。
- 同场刷新验收必须让两个扩展处于相同网页、相同字幕开关和相同刷新时刻；轨道语言/人工或自动来源也要记录。
- 自动/人工轨缓存必须按真实轨类型标记；为了快可以先显示网页实际轨，但 UI 必须同步显示真实选中轨，不能偷换来源。
- 不再让用户执行连接、重新读取或重复刷新来弥补代码链路；代理先完成可逆的构建、加载、导航、计时和截图。
- Supadata 退出后，manifest、生产 bundle、设置、错误文案、测试和文档都必须做零调用检查；仅保留旧 Key 的安全删除迁移，不保留可触发付费请求的入口。
- 浏览器门禁必须等待稳定双端状态，不能只等第一个 `.echo-cue`：内容脚本需同时为 `status=loaded / phraseCount=期望值 / underTwoCount=0`，Side Panel 需同时为 `data-display-mode=phrases / DOM 行数=期望值`。
- Service Worker 重载证据必须包含旧实例 `close`、进程关闭/重启时间、新实例令牌和新 Worker 运行时资源 SHA-256；只比较磁盘文件不算运行证据。
