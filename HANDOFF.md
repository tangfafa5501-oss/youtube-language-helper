# Video Language Helper 交接记录

更新时间：2026-09-03（Asia/Taipei）

仓库：`D:\github\youtube-language-helper`

分支：`codex/initial-design`
提交前基线：`6bb3c03c223e9714e266614f5c8533b7033af2fb`（最终归档提交以本文件所在 Git HEAD 为准）

任务状态：`[SUCCESS] 2026-09-02 用户现场 installed-real 终极验收通过，全功能完美闭环`

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站字幕学习侧栏。任务 `01a05fd6-e836-7553-af51-f5786f1967cf` 已把播放控制统一为 `Auto`、`Manual`、`Shadowing` 三态，并保留取消“低于 2 秒必须合并/延长”后的自然语言分句逻辑。

本轮根据用户真机反馈只特化 YouTube：YouTube ASR 的最终派生 phrases 若与下一句前向重叠，则把当前 `endMs` 截到下一句 `startMs`；YouTube 控制器使用 250ms 提前刹车，刹车时同时尝试隔离世界的 `movie_player.pauseVideo()`、通过 MAIN-world 桥再次调用该 API，并由共享控制器执行 `video.pause()` 与静态时钟校准。B站内容脚本未修改，继续使用共享默认 30ms 提前量。

用户已在真实安装环境对 YouTube 与B站完成全线肉测，确认句尾刹车稳定、Shadowing 留白循环流畅。维护边界仍需保留：YouTube ASR 的尾部并不保证一定是静音，250ms 是本次验收通过的经验补偿；12ms `setInterval` 也是浏览器调度目标而非操作系统硬实时承诺。

## 2. 完成了什么

- `lib/playback-machine.ts` 增加每个平台可配置的 `brakeLeadMs` 和 `pauseAtBoundary` 钩子。共享默认仍为 `BRAKE_LEAD_MS=30`，唯一轮询器仍固定 12ms；触发后先销毁轮询器，再调用平台钩子和 `video.pause()`，最后把静态媒体时钟校准到 canonical `endMs`。Shadowing 留白仍严格使用未扣补偿的 `phrase.endMs - phrase.startMs`。
- `lib/youtube-native.ts` 的 `nativeDisplayPhrases(cues, kind)` 只对 `kind === 'asr'` 的最终派生 phrases 执行相邻句前向截断；原始 JSON3 cues、人工字幕轨以及字幕文本/顺序均不改写。真实 Dr Jekyll 重叠夹具已从 `10560–17080 / 14160–20600` 收敛为 `10560–14160 / 14160–20600`。
- `entrypoints/youtube.content.ts` 锁定 `YT_BRAKE_COMPENSATION=250`，构建标记升级为 `youtube-brake-v5`，并写出 `data-ylh-yt-brake-compensation-ms="250"`。句尾钩子直接尝试 `ytPlayer.pauseVideo()`，同时向 MAIN-world 发送绑定当前 video/session 的 `pause-video` 请求。
- `entrypoints/youtube-main.content.ts` 新增会话校验后的 `pause-video` 桥接分支，在 YouTube 页面主世界调用真实 `movie_player.pauseVideo()`；缺少 API 或会话过期会失败关闭，元素级 `video.pause()` 仍是兜底。
- 本轮没有修改 `entrypoints/bilibili.content.ts`；修改前后 SHA-256 均为 `4FEC4D650495B1A453159F6FAD8F01392DB90F741A5394190B0A6F6AFA41D5AB`。用户报告 B站 installed-real 已通过；本轮本地生产包回放中的 B站 24 项也继续通过。
- 2026-09-03 06:41 +08:00 最终门禁：
  - 静态检查：`npm run typecheck` 通过，`git diff --check` 无空白错误（只有既有 LF/CRLF 提示）。
  - 单元测试：`npm test`，88/88 通过；包含 YouTube 250ms 正例、共享 30ms 反例、ASR 截断与人工轨不截断反例、原始 cues 不变断言。
  - 生产 bundle 集成：`npm run test:integration`，64/64 通过；生产 YouTube bundle 已断言 250ms 阈值、`pauseVideo()` 被调用、ASR 派生 overlap 截断且 raw cues 不变、最终时钟漂移 `<=20ms`、Shadowing 等长留白，B站回归同时通过。
  - 最终生产构建：`wxt build` 成功，输出 17 个文件，构建标记 `youtube-brake-v5`。
  - 部署资产集 SHA-256（相对路径排序后的逐文件 SHA-256 清单再散列）：`031AA6A28954B7E249F7B444BA3C1C9101B47C6F7C65B85755AB61660EE8682D`。
  - Chrome Profile 2 的 `Secure Preferences` 再次确认扩展 `fkmlglnhecdppjdpanlngheoaaagfden` 登记路径正是 `D:\github\youtube-language-helper\.output\chrome-mv3`（location 4）。最终构建直接全量写入该登记目录，无第二份待复制产物。
  - 最终证据等级：`installed-real PASSED`（用户现场反馈，YouTube/B站双平台通过）。本地自动化证据仍独立记录为 88/88 单元测试和 64/64 生产 bundle 集成测试，未混淆证据来源。

## 3. 卡在哪里

- 功能、构建、部署与 installed-real 验收均无阻塞，本任务正式完成。
- 根目录仍有 6 个非产品的未跟踪提示词/`.agent.md` 文件；它们不属于本任务，不会提交到远端，也不会为制造 clean 假象而删除或隐藏。产品提交本身不包含这些文件。
- 250ms 是本次真实样本验收通过的固定补偿，并非所有未来 YouTube ASR 轨的普适真值；若后续内容出现过早截音，应依据 `data-ylh-brake-*` 诊断字段重新校准。

## 4. 下一步计划

1. 保留 `youtube-brake-v5`、部署资产哈希和 installed-real 反馈作为本任务的验收基线。
2. 若未来出现特定视频回归，先采集 `ylhBrakeTargetMs/DetectedMs/PausedMs/ActualMs/LeadMs`，再只调整 YouTube 平台补偿。
3. 本任务关闭，等待下一阶段安排；后续需求从当前远端 `codex/initial-design` 分支继续。

## 5. 碰到哪些问题

- YouTube 的 `movie_player` 方法属于页面主世界对象；隔离世界中直接读取 expando 方法并不可靠。最终采用“直接尝试 + 带 video/session 校验的 MAIN-world 桥 + HTMLVideoElement 兜底”三层暂停。
- ASR rolling events 的显示时段可以重叠，但原始 cue 既是审计证据也供其他功能使用。截断被限制在最终派生 phrases，避免污染原始 JSON3 时间线或第二字幕。
- 250ms 早刹后仍把暂停静态帧校准到 `phrase.endMs`；这能防止视觉落点进入下一句，但不等于能恢复被提前截掉的音频，真机必须同时听声音而不是只看 currentTime。
- 此前硬刹车的独立浏览器验证连续三次卡在真实 YouTube 字幕装载（空 timedtext、MV3 Worker 重载、Worker fetch 无法被页面路由接管），已按三击熔断停止。用户随后明确选择 installed-real 人工验收，本轮未重复 Playwright 尝试。

## 6. 如何避免再次出现

- 原始 YouTube cues 永远保持不可变；任何 ASR overlap 修正只作用于带 `kind='asr'` 的最终派生 phrases，并保留人工轨不截断的反例测试。
- 平台差异只能通过共享状态机的配置点注入：YouTube 250ms、B站默认 30ms；适配层不得另建第二个高频轮询器。
- 每次句尾触发顺序固定为：校验 owner/generation → 清除唯一 12ms poller → 调用平台暂停钩子 → `video.pause()` → 校准静态 `currentTime=endMs` → Manual waiting 或 Shadowing 留白。
- MAIN-world 播放器命令必须绑定当前 video/session 并失败关闭；SPA、切轨、Port 断开或扩展重载时清理旧 listener、timer 与 pending request。
- 构建后必须同时核对源代码行、bundle 字符串、资产集哈希和 Chrome 登记路径；生产包回放、test-browser 与 installed-real 始终分级记录。
- `setInterval(12)` 不是硬实时保证，250ms 也不是普适字幕真值。只有用户当前安装环境的声音、画面与诊断数据共同通过，才能宣称 YouTube 滞后已解决。
