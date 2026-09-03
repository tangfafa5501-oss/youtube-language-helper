# Video Language Helper 交接记录

更新时间：2026-09-04 01:43 +08:00

仓库：`D:\github\youtube-language-helper`

分支：`codex/initial-design`

基线提交：`874871a986aea58399d2f1b1dc96397cfa94ed7a`（本轮改动尚未提交）

任务状态：`[CODE + AUTOMATION COMPLETE / INSTALLED-REAL BLOCKED]` B站已改为“人工字幕绝对优先、无人工时自动回退 AI”；本地 Python OCR 已物理移除。当前 Chrome 尚未重载新构建，因此不能宣称 installed-real 完成。

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站字幕学习侧栏。本轮只重构 B站字幕选择：从 B站官方 `subtitle.subtitles` 中优先选择经元数据确认的人工轨；当没有可用人工轨时，直接选择 AI 轨，经现有 Fetch、`RawCue`、语段和侧栏 State 管道加载。

YouTube 继续使用原有 timedtext 获取和播放状态机。本轮没有修改 YouTube content scripts、`lib/youtube-native.ts` 或 YouTube API 路由。

## 2. 完成了什么

- 新增纯函数选择器 `lib/bilibili-ocr.ts`。人工轨必须满足规范化 `is_ai === false` 且 `lan_doc` 不含 AI；人工轨存在时只返回人工轨。人工轨为零时，返回 `is_ai=true/1`、历史 AI 字段、`ai-*` 语言或 AI 标签命中的轨道。
- `lib/bilibili.ts` 先校验字幕 URL 为 B站/hdslb HTTPS 地址，再执行优先级选择。无人工轨时把选中轨标记为 `asr`，随后沿原有 `biliCues → biliPhrases` 链路加载。
- `entrypoints/bilibili-main.content.ts` 与 `entrypoints/bilibili.content.ts` 只传递 `usedAiFallback` 状态；不存在 OCR 启停、Canvas 抽帧、SRT 注入或 Native Messaging 调用。
- 已从后台、协议、侧栏和 manifest 清除 OCR/Native Messaging。当前生产 manifest 权限仅为 `sidePanel, storage, webRequest`。
- 已停止遗留 OCR host 进程，删除当前用户注册项 `com.alxanday.youtube_language_helper.ocr`，并物理删除约 282 MiB 的未跟踪 `native/ocr-service` 及空父目录；该目录不能从 Git 恢复。
- 新增可重复门禁 `npm run verify:bilibili-ocr`。2026-09-04 本机结果：类型检查通过；单元测试 92/92；生产 bundle 集成测试 65/65，退出码 0。
- 两条核心 Mock 物证：混合人工+AI 列表只暴露并请求人工轨；AI-only 列表自动请求一次 AI JSON、生成 RawCue、进入 loaded 状态，且没有 `bilibili-ocr` source 或 OCR State。
- 17 个生产输出文件的确定性集合 SHA-256：`CD5AF8E6FBAFF709322CBA7DC685C74B2BB86F02D2B1F5DA82A98A7EFF699BFC`。其中 `youtube.js` 为 `D9D6923DCAB6047F655E5F59A3AD362B449416BAD16DEE1DA59B0C26D55897B1`，与重构前记录一致。

## 3. 卡在哪里

- 当前 computer-use 能控制真实 B站网页，但不能打开 Chrome 的扩展管理内部页，因此没有执行“重新加载未打包扩展”。页面仍可能运行旧 Service Worker/content script。
- 因未完成重载，不能产出用户要求的 installed-real 侧栏截图，也不能把生产 bundle 仿真或当前 B站网页快照冒充 installed-real。
- 命令行真实网络尝试因没有浏览器登录 Cookie，B站 WBI 密钥接口返回异常；这不影响带网页登录态的扩展路径，但该次尝试不能算真实网络成功证据。

## 4. 下一步计划

1. 在当前 Chrome 的 `chrome://extensions/` 对 Video Language Helper 点击一次“重新加载”，确认加载目录为 `D:\github\youtube-language-helper\.output\chrome-mv3`。
2. 刷新当前 BVID `BV1YQiCBPEEG`，打开 Video Language Helper 侧栏；核对不再出现“正在提取/本地 OCR”，并显示 `中文 (AI)` 轨及真实字幕行。
3. 记录 installed-real 截图、采集时间和资产哈希；若页面数据与 Mock 不同，保存脱敏后的原始 `subtitle.subtitles` 形状再补回放测试。

## 5. 碰到哪些问题

- 初次递归删除时，遗留 Python OCR host 正占用 ONNX/OpenCV `.pyd`。先精确确认可执行文件位于目标 `.venv`，停止 PID 10256，再逐文件删除剩余 18 个锁定文件，最终目录和注册项均不存在。
- 需求中的“网络 Fetch 后 10ms 内显示文本”不是可验证的网络时延保证；实现保证选择完成后立即发起 Fetch、响应后立即发布 State，不通过固定延迟或禁用按钮制造等待。
- B站“关闭播放器字幕”只控制画面叠加层，不改变后台字幕数组；选择依据必须是轨道元数据，不能读取播放器开关。
- AI 标记可能同时来自 `is_ai`、`lan_doc`、`ai_status`、`ai_type` 或 `lan=ai-*`。单看数组非空或单一字段都会误分流。

## 6. 如何避免再次出现

- B站轨道选择固定遵守三态：verified manual、verified AI、unknown。unknown 永远不冒充人工轨；只有没有可用人工 URL 时才允许 AI fallback。
- 两条核心断言必须长期保留：混合列表不请求 AI URL；AI-only 必须进入 `loaded` 且产生 RawCue。任何 B站字幕路由修改都运行 `npm run verify:bilibili-ocr`。
- 仓库不得重新加入 Python、ONNX、Paddle/PyTorch、Canvas 视频抽帧、Native Messaging 或 OCR 服务，除非先重新评估并取得明确授权。
- YouTube 与 B站入口保持文件级隔离。验证时单独核对 YouTube 源文件无 diff、YouTube 生产 bundle 哈希和完整 YouTube 集成回归。
- 证据继续分级：静态检查、单元测试、生产 bundle 仿真、真实网络回放、test-browser、installed-real。未重载的 Chrome 和普通网页截图不能升级为 installed-real。
