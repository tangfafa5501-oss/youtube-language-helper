# 字幕空响应：项目对比与待确认修复

后续状态：用户已选择直接移植 digest，而非新增 webRequest。现已移植其 Supadata 提交/轮询流程，主按钮切换到 Supadata，旧网页直读降为实验功能。下文是变更前诊断记录；其 webRequest 计划暂不实施。最新实现与验证见 m0-validation.md、HANDOFF.md。

日期：2026-08-31。范围：只读对比 youtube-digest 源码、Enjoy Echo 已安装发布包和本项目源码。未读取其他扩展的存储、Key 或 Cookie，未修改其文件。本轮仅更新诊断和交接文档，没有改变运行代码或权限。

## 结论与证据边界

用户最新错误精确命中本项目 `lib/captions.ts:24` 的 JSON3 空正文检查。这表明本次已进入网页直读响应解析阶段，不再是之前的页面未连接错误，也不是 Supadata 返回的错误。不能据此断言其他连接场景全部通过或 Supadata Key 有效。

确认的实现缺口：本项目把播放器轨道 `baseUrl` 加上 `fmt=json3` 就直接 fetch，没有捕获播放器实际字幕请求，也没有补充客户端上下文或动态参数。Enjoy Echo 有这两层处理。此前提示“开启字幕后重试”不充分：本项目没有观察开启字幕后产生的新请求，重试仍从播放器轨道重新取得 baseUrl。

缺少动态请求参数是目前有证据支持的主要原因假设，而不是已经完成同一浏览器、同一轨道的请求对照实验。不能宣称特定 pot 参数一定是本次唯一原因，也不能宣布已修复。

## 三方实际链路

| 实现 | 实际行为 | 对本次问题的意义 |
| --- | --- | --- |
| youtube-digest，D:/github/youtube-digest，HEAD 5462cae | background.js 的 handleFetchTranscript 直接调用 Supadata /v1/transcript，text=false、lang=en、mode=native，并处理异步任务 | 由远端服务提取，不依赖本机自行拼接 timedtext；不是缺少某个本地 SDK 环境 |
| Enjoy Echo 0.7.5 发布包 | background.js 使用 webRequest.onCompleted 观察 timedtext 请求，缓存动态 pot/potc，并重新请求实际 URL、解析与缓存字幕；content-scripts/content.js 从页面客户端配置补充 c/cver 等参数，查询动态参数缓存，必要时触发 CC 后等待参数 | 并非只有“播放器响应 → baseUrl → fetch”，此前分析遗漏了关键辅助链路 |
| 本项目网页直读 | lib/captions.ts 的 captionUrl 只追加 fmt=json3；entrypoints/youtube-main.content.ts:60–65 请求该 URL，credentials=include | 带 Cookie 不等于补齐实际播放器请求参数；当前空正文错误由这条路径产生 |
| 本项目 Supadata | lib/supadata.ts 已有与 digest 同类 native 调用；entrypoints/sidepanel/main.tsx 的手动备用按钮触发 | 填写 Key 不会改变“读取原字幕”按钮的路径；备用入口折叠，容易造成已经调用 API 的误解 |

Enjoy Echo 样本目录：`C:/Users/alxanday/AppData/Local/Google/Chrome/User Data/Profile 2/Extensions/hiijpdndbjfnffibdhajdanjekbnalob/0.7.5_0`。这是已安装静态发布包，不是完整原工程，许可未确认，不复制实现。

可复核的静态标记：`background/youtube-timedtext-interceptor.ts`、`providers/youtube/helpers/timedtext-auth.ts`、`TRANSCRIPT_GET_TIMEDTEXT_AUTH`。客户端辅助函数 Bn 读取 INNERTUBE_CONTEXT 等页面配置；Gn 组合 URL、查询缓存、等待动态参数再请求。

样本 SHA256：

- content-scripts/content.js：2C5FF36B8F9D3B2CA7CC8E296FC39D33385351E0299DCAF6899455E708C3A077
- background.js：7104B559161F46AC4782C00C97759951F767BB317A8722B6238BC1EE3C85250F

独立 HTTP 获取 X627czLUsGY 的页面元数据，发现 a.en 自动轨与 .en-GB 人工轨，两条 baseUrl 都没有 pot、potc、c。只记录存在性，没有记录签名 URL。独立 HTTP 不继承用户 Chrome 上下文，此证据不替代真实页面请求对比。

外部佐证：[yt-dlp issue 13075](https://github.com/yt-dlp/yt-dlp/issues/13075) 中报告移除实际字幕请求的 pot 或 c=WEB 会得到空正文。它支持排查方向，但不是本视频实测结果。

## 成熟方案与取舍

- 保留 WXT/React 工程，使用 Chrome 标准 [webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest) 观察限定字幕请求；不增加 npm 依赖。只监听，不阻断、不修改请求。该 API 提供请求事件而非响应正文，不能把监听事件当作已经拿到字幕，仍需验证内容获取。
- yt-dlp 是成熟开源提取工具，可作为兼容性研究参照，但引入 Python/本地进程不适合当前纯浏览器扩展 M0，增加部署成本。
- 已接入的 Supadata 是托管服务而非开源库，实施成本较低，但依赖 Key、网络、额度，供应商条目还需与网站原轨对照。继续作为用户明确点击的备用，不自动付费回退。

建议独立实现小型字幕请求适配层，不复制 Enjoy Echo、不引入通用下载器、不生成令牌或模拟挑战。网站接口仍会变化，真实网页请求可用也不保证扩展重请求一定成功，必须实测后验收。

## Change Plan：等待权限确认

1. wxt.config.ts 增加 webRequest 权限；后台只过滤 https://www.youtube.com/api/timedtext 请求，并仅处理当前绑定学习标签页。视频、会话、轨道身份均匹配后才使用页面实际请求 URL；不把不同轨道的参数随意拼接，不扩大到其他站点。
2. 实现有界获取与临时缓存，防止扩展自身请求触发递归；不记录、持久化或向第三方发送签名 URL/动态参数，不采集 Cookie。导航、会话结束、过期时清除；保留超时、大小限制和迟到响应隔离。若没有捕获匹配请求，明确报告该阶段，不能冒充无字幕或反复盲重试。
3. 明确显示“网页直读”和“Supadata”两个来源，替换误导性的空响应重试提示；补充请求来源、轨道匹配、循环保护、导航隔离测试，并验证至少 20 分钟视频的真实字幕和前中后定位。原始条目规则不变。

上述修改涉及核心权限和多个模块，按用户 AGENTS.md Level 2，等待明确确认后实施。可选替代是只使用现有 Supadata 按钮验证云路径，但这不修复网页直读。当前不要求用户购买服务或再提交 Key。
