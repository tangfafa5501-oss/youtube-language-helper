# Video Language Helper 交接记录

更新时间：2026-09-04 04:29 +08:00

仓库：`D:\github\youtube-language-helper`

分支：`codex/initial-design`

验证基线：`56d4921c4f02cddda45b6a6dbb18ba4dfe3ab991`。本轮 B站网络/快捷键修复按明确文件列表单独提交，最终提交标识以 `git log -1` 为准，不把基线哈希当作新提交。此前图标依赖瘦身保留在工作区，排除出本次代码提交；不推送远端。

任务状态：`[98 UNIT + 72 INTEGRATION PASSED / CDP EXTENSION RUNTIME VERIFIED / REAL REFERER OBSERVED / LIVE SUBTITLE BLOCKED BY HTTP 412]` 独立临时 Chrome 已加载真实扩展并验证原生键盘桥接；没有操作用户日常 Chrome。真实 B站页面成功打开，但字幕相关元数据接口返回 412，不能报告真实字幕端到端成功。下方旧图标裁剪数据不代表本轮重新测量空间。

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站字幕学习侧栏。本轮按用户最新指令对后台下载、A/S/D/E 焦点修复与重试交互进行 CDP 验证并提交。禁止截图识别地址；使用调试协议读取 URL/DOM/请求事件。保留先前工作树改动和字幕/播放状态机，不引入新 npm 依赖，不恢复 OCR。

YouTube 继续使用原有 timedtext 获取和播放状态机。本轮没有修改 YouTube content scripts、`lib/youtube-native.ts` 或 YouTube API 路由。

此前的整套原生迁移方向已被最新“定点裁剪”指令取代。TypeScript/WXT/React 不是所有浏览器扩展的必需品，但属于当前 TSX 工程的开发工具链；不能把它们称作缓存直接删除，也不能把 node_modules 大小当成实际浏览器加载包大小。

## 2. 完成了什么

### 最新闭环验证卡片（2026-09-04 04:19—04:29 +08:00）

| 项目 | 结果与证据等级 |
| --- | --- |
| 真实扩展加载 | Chrome 152.0.7977.65、Windows、Playwright 1.62.1；全新临时用户目录，CDP 监听 127.0.0.1:9222。由官方 `Extensions.loadUnpacked` 加载 `.output/chrome-mv3`，`Extensions.triggerAction` 打开真正的侧栏。证据是 **独立 test-browser**，不是用户日常 installed-real。 |
| 运行代码身份 | 扩展 ID `fkmlglnhecdppjdpanlngheoaaagfden`。Debugger.getScriptSource 核对后台、B站 MAIN/content、侧栏与共享 UI 共 5 个脚本，均与本地构建逐字节 SHA-256 一致。 |
| Referer 真实网络 | 从实际扩展 isolated world 调用后台诊断请求，`Network.requestWillBeSentExtraInfo` 捕获 `/x/web-interface/view` 实发 `Referer: https://bilibili.com`，规则 47001 由 Chrome 成功安装。服务器仍返回 **HTTP 412**；此物证只覆盖元数据请求，不能冒充字幕 CDN 正文下载成功。 |
| 真实 B站页面 | `https://www.bilibili.com/video/BV1YQiCBPEEG/` 后续导航 HTTP 200，标题正确。字幕选轨接口 412；真实侧栏显示“字幕获取失败 / B站接口请求失败：HTTP 412 / 重试 B站字幕”，未卡在提取中。 |
| 原生按键与策略 | **真实临时扩展 + 显式模拟网络数据** 的 10 项断言通过：AI-only 正文只由后台请求并渲染 3 条；原生 CDP D/A/S 各产生一个绑定的 next/previous/replay 指令；E 切到跟读；按钮焦点 D 生效；输入框 E 不触发控制；人工与 AI 并存时只请求人工正文。未伪造 Chrome API、未手工灌侧栏 State。 |
| 全套回归 | 本轮重新运行 `npm run verify:bilibili-ocr`，**退出码 0**：98/98 单元、72/72 构建包仿真集成、typecheck、build 全部通过。数据不是生产 API；含 YouTube 回归。 |
| 构建与隔离 | 18 个文件、482,629 内容字节；集合 SHA-256 `64e67f274f066545967b0f32ceefe4421bbd1124b62e29f3092ff06e7c4b34a8`。YouTube content/MAIN/native/playback-machine 源码无 diff；youtube.js 仍为 `d9d6923dcab6047f655e5f59a3ad362b449416bad16dee1da59b0c26d55897b1`。 |

证据目录：`D:\github\youtube-language-helper\test-results\bilibili-cdp-20260904`（已由现有 `.gitignore` 排除，不提交截图/响应/日志）。主要产物：

- `runtime-hashes.json`：5 个实际运行脚本与磁盘哈希。后台 `cd9920f1bcfe58f2d94ed49ec0fc078e77a744bef891208694368f0c8557c495`；B站 content `98730c9bfa4f642db5b80a28717d35fdad726beeb1114dd77e381b58e5b6c4b7`。
- `test-browser-live-relay.json`：真实 Referer 与 HTTP 412。只保存需要的请求头，未导出 Cookie/认证字段。
- `test-browser-live-inspection.json`、`test-browser-live-panel-dom.txt`、`test-browser-live-panel.png`：真实网络失败状态，不能当作字幕成功证据。
- `test-browser-simulated-runtime-results.json`、`test-browser-simulated-ai-dom.txt`、`test-browser-simulated-ai.png`：10 项运行态夹具断言与明确写有“模拟验证”的字幕。
- `verify-bilibili-ocr.log`：本轮完整回归日志。`scripts/` 保存 CDP 连接、临时启动、真实网络采集、运行态夹具、哈希检查脚本；依赖宿主已有 Playwright，无 npm 安装。重放顺序：`launch.mjs` → `inspect-live.mjs` → `probe-relay.mjs` → `verify-runtime-fixtures.mjs` → `hash-runtime.mjs`。脚本采用本机绝对路径，换电脑需调整 Chrome/Playwright/仓库位置；临时 profile 默认创建到系统 TEMP。

验证范围须保留：上述构建与侧栏运行哈希来自包含先前图标瘦身的工作树。本次提交不包含图标替换、包清单、样式及依赖裁剪测试，所以不能把整个构建集合哈希标为“只含本次提交的干净 checkout 产物”。B站修复代码与图标改动已按 index 分开；没有恢复重型依赖。

本轮未增加或修改生产逻辑，只补运行态证据与交接。临时 Chrome 已通过 CDP 关闭，9222 不再监听；删除自建临时 profile 的请求被工具拒绝，故 `C:\Users\alxanday\AppData\Local\Temp\ylh-cdp-verify-781a6916b67848fd88159ac721e4773d\profile` 仍保留，未改用其他路径强删，也未触碰日常 Chrome 配置。

### 本轮 B站后台网络与全局快捷键修复（2026-09-04 03:26 +08:00 检查点）

- 新增 `lib/bilibili-network.ts` 请求桥及 `lib/bilibili-background.ts` 后台路由。字幕正文只能由 worker 请求；MAIN 页面仍负责带网页登录态的选轨，页面网络失败时可交后台补取元数据。请求绑定发送扩展、主 frame、tab、BV/p；限制为已校验的 B站/hdslb HTTPS 地址，禁止凭据 URL/额外端口/重定向，原始 RawCue 与 from/to 毫秒保留。单请求 12 秒截止，客户端 15 秒兜底，支持取消和导航后丢弃。
- 仅新增 Chrome `declarativeNetRequestWithHostAccess` 权限；惰性安装自有 session rule 47001，把本扩展发出的 B站/hdslb GET 的 Referer 设为 `https://bilibili.com`，不匹配 YouTube 或网页发出的请求。依据 Chrome 官方 network-requests、declarativeNetRequest 文档，而不是给普通 Fetch 填一个不可靠的 forbidden header。当前尚未在已安装扩展实际验证规则。
- `lib/shortcuts.ts` 纯原生解码；B站 window 捕获可信键盘事件，绑定当前视频/字幕会话，仅转发给一个已连接侧栏。侧栏用稳定监听器和最新回调复用原状态机；A/S/D/E 不再被 toolbar button 焦点整体吞掉。保留 Space 的原生按钮激活，忽略编辑区、组合输入、系统组合键、重复键及过期会话。
- B站空视频元数据错误仍保留 `source=bilibili`；重试按钮显示“重试 B站字幕”，发送 refresh，不再误入 YouTube load。YouTube 获取和 250ms 播放刹车源码未改。
- `npm run verify:bilibili-ocr` 本次最终退出 0：typecheck、98/98 单元、72/72 生产包仿真集成（Windows / Node 26.3.0 / npm 11.16.0）。新增测试运行真正的构建后台与内容脚本，不在请求桥直接伪造成功；页面世界直接 Fetch 字幕被强制拒绝，后台成功后才产生字幕。含人工优先、AI-only 保底、Referer 规则范围、非法中转拒绝、取消/导航、错误后重试及页面键盘桥接断言。首轮测试夹具漏了 TextEncoder 导致后备元数据测试失败，补齐浏览器标准全局后重跑通过，未通过削弱断言规避。
- 本次构建报告 482.63 kB。独立 Chrome 152.0.7977.65 无头测试浏览器，560×1100 及 390×844，2026-09-04 03:25:22 +08:00 的 **20 项模拟界面断言通过**：按钮焦点 A/S/D/E、Space 单次激活、速度键、绑定/过期 runtime 事件、帮助弹窗屏蔽、metadata/subtitle 两种 B站错误文案及重试、YouTube 单次 native load、无横向溢出。应用 JS 异常为 0；测试服务 `/favicon.ico` 404 仍如实记录，不算 console 全零。
- 界面证据与可重复脚本在仓库外：`C:\Users\alxanday\AppData\Local\Temp\ylh-bilibili-network-qa-b201aa6e04b848b1b4d8d7e2eaf0cbfa`。启动 `YLH_VISUAL_PORT=4188` 的 `tests/visual/serve-sidepanel.mjs` 后运行该目录 `verify-ui.mjs`。未安装 Playwright；使用 Codex 捆绑版本。数据/API 模拟，不是真实 B站成功截图。

### 本轮依赖裁剪（2026-09-04 02:42—02:53 +08:00）

- `components/icons.tsx` 只保留播放、暂停、上一句、下一句、设置 5 个内联 SVG；其余 16 个装饰图标采用文本字符，无图标字体或外部图标库。保留所有按钮名称、事件、焦点行为；调整两个页面的图标尺寸选择器。复制形状的 ISC 许可保留在 `public/licenses/lucide.txt`，随生产包分发。
- 从 package.json 和 package-lock.json 移除 lucide-react 0.479.0。实际运行 `npm prune --no-audit --no-fund`，输出 `removed 1 package in 770ms`，物理目录已删除。仅移除可从旧锁文件重装的包，没有删除业务源码或 Git 历史。随后离线 dry-run 报 added/changed/removed 全为 0，`npm ls --depth=0` 无缺失或多余包。
- 物理空间：本机 GNU du，裁剪前 node_modules **137,028,608 字节**，裁剪后 **98,302,976 字节**；差额 **38,725,632 字节 = 36.93 MiB = 28.26%**。最后复测时间 **02:53:15 +08:00**，`du -sh node_modules` 原始输出为 **94M**。前后均为同一 GNU du 口径，不与 Windows 属性或文件 Length 混算。
- 剩余大项（GNU du）：TypeScript **23,970,816 字节 / 22.86 MiB**，@rolldown **20,959,232 字节 / 19.99 MiB**，lightningcss-win32-x64-msvc **9,507,840 字节 / 9.07 MiB**，react-dom **7,400,448 字节 / 7.06 MiB**。`npm explain` 确认 TypeScript 由根项目 typecheck 使用；两个原生构建工具合计 **29.06 MiB**，由 WXT → Vite 引入。Vite 的本地源码直接导入 rolldown，不能删除后仍声称构建链可用。这些不是全都属于 TypeScript 本体，也不是绝对不可替代；要继续大幅下降需另行批准框架/构建链迁移。
- 五个 devDependencies 均有用途：typescript 运行 `tsc --noEmit`；wxt 执行开发、构建、打包及类型生成；@wxt-dev/module-react 在 wxt.config.ts 中注册；@types/react 和 @types/react-dom 为当前 TSX 类型检查服务。没有发现 Python/OCR、Playwright、Jest 等测试残留包，测试本来使用 Node 内置 test/assert/vm。网络请求已用 fetch，状态未额外引入 Axios/Redux 等库。
- 只读对比：youtube-digest 的 package.json 没有 dependencies/devDependencies，实际无 node_modules，直接开发原生 JS/HTML/CSS；bilibili-digest 只有 driver.js 1.8.0、morphicons 1.7.1，node_modules **423,936 字节（414K）**，其 sidepanel-guide.js、sidepanel-icons.js、sidepanel.html 直接引用这两个包，不是零依赖。两个参考项目均未修改。
- 自动化：新增 `tests/dependencies.test.ts` 3 条约束，阻止全量图标包回流、约束 5 个 SVG 与装饰性无障碍属性、限制开发工具清单。`npm run verify:bilibili-ocr` 本輪实际退出 0：类型检查通过、单元测试 **95/95**、生产 bundle 仿真集成 **65/65**（包含 B站人工优先/AI 保底及 YouTube 回归）。环境 Windows，Node **26.3.0**，npm **11.16.0**；数据为单元/生产包仿真，无真实视频 API。
- 本轮构建 **18 个文件、475,596 内容字节（475.60 kB）**；前基线为 477,400 字节。生产目录 GNU du 为 516,096 字节。生产文件集合 SHA-256：`004655170ff15f67d6df654e8ddfd28ef69c6be70d8b679fc9403168611285f4`；算法为按斜杠规范化相对路径排序，各行 `path + 空格 + 文件SHA256小写`，用 LF 连接后再计算 SHA-256（无末尾换行）。
- YouTube、B站及后台业务源文件没有 diff。构建前后 youtube.js SHA-256 均为 `D9D6923DCAB6047F655E5F59A3AD362B449416BAD16DEE1DA59B0C26D55897B1`，bilibili.js 均为 `ECB2BB66FDA5CC6D2343577A535321CF86412506888556FF614B3FBDE35E0A83`，background.js 均为 `F4DC07688C5E6C5A12C7AE6D8B5146CA5A93D4032AD85645C6AD7206E6BDB55C`。
- 界面证据等级 **simulated test-browser**：按前端验收技能，用已有 Playwright 1.62.1 + 系统 Chrome **152.0.7977.65** 的独立无头实例，不安装包，不访问真实 B站/YouTube API，不操作用户已安装扩展。2026-09-04 **02:51:19 +08:00**，430/320px 两个宽度均通过：8 行 B站模拟字幕、播放/暂停、上下句、跟读切换、速度、快捷键弹窗、引导、第二字幕切换、设置主题及返回；无横向溢出，播放按钮全部处于视口。YouTube 模拟页面均展示 8 行且只请求一次 native load。JS 异常为 0；430px 有一条基线也存在的 `/favicon.ico` 404，已记录来源，不能报告 console 零错误。
- 仓库外验收目录：`C:\Users\alxanday\AppData\Local\Temp\ylh-dependency-audit-1d0aa1f8861944dcabd52a0a853516e6`。包含 `verify-ui.mjs`、`after-simulated-test-browser-report.json`、`after-sidebar-430-simulated-test-browser.png` 等截图。重跑方式：先以 `YLH_VISUAL_PORT=4187` 启动仓库 `tests/visual/serve-sidepanel.mjs`，再用 Codex 已有 Node 24.19.0 执行该验收脚本。Browser plugin 不可用，按技能采用已有 Playwright 回退；不是实机扩展截图。
- 本輪为 11 个任务文件的未提交改动，其中 HANDOFF.md 在开始前已有上轮空间审计修改，已保留并补充；没有提交、推送、重新加载扩展或改写 Git 历史。验收后已关闭独立浏览器及本轮 4187 端口测试服务。

### 先前 B站重构与空间审计记录（截至 02:28，非当前占用）

以下历史记录用于保留来源；其中旧输出哈希、目录大小、缓存状态及 Git 状态不代表本轮修改后的状态。

- 新增纯函数选择器 `lib/bilibili-ocr.ts`。人工轨必须满足规范化 `is_ai === false` 且 `lan_doc` 不含 AI；人工轨存在时只返回人工轨。人工轨为零时，返回 `is_ai=true/1`、历史 AI 字段、`ai-*` 语言或 AI 标签命中的轨道。
- `lib/bilibili.ts` 先校验字幕 URL 为 B站/hdslb HTTPS 地址，再执行优先级选择。无人工轨时把选中轨标记为 `asr`，随后沿原有 `biliCues → biliPhrases` 链路加载。
- `entrypoints/bilibili-main.content.ts` 与 `entrypoints/bilibili.content.ts` 只传递 `usedAiFallback` 状态；不存在 OCR 启停、Canvas 抽帧、SRT 注入或 Native Messaging 调用。
- 已从后台、协议、侧栏和 manifest 清除 OCR/Native Messaging。当前生产 manifest 权限仅为 `sidePanel, storage, webRequest`。
- 已停止遗留 OCR host 进程，删除当前用户注册项 `com.alxanday.youtube_language_helper.ocr`，并物理删除约 282 MiB 的未跟踪 `native/ocr-service` 及空父目录；该目录不能从 Git 恢复。
- 新增可重复门禁 `npm run verify:bilibili-ocr`。2026-09-04 本机结果：类型检查通过；单元测试 92/92；生产 bundle 集成测试 65/65，退出码 0。
- 两条核心 Mock 物证：混合人工+AI 列表只暴露并请求人工轨；AI-only 列表自动请求一次 AI JSON、生成 RawCue、进入 loaded 状态，且没有 `bilibili-ocr` source 或 OCR State。
- 17 个生产输出文件的确定性集合 SHA-256：`CD5AF8E6FBAFF709322CBA7DC685C74B2BB86F02D2B1F5DA82A98A7EFF699BFC`。其中 `youtube.js` 为 `D9D6923DCAB6047F655E5F59A3AD362B449416BAD16DEE1DA59B0C26D55897B1`，与重构前记录一致。
- 空间证据（本机 Windows，Git Bash 的 GNU du，真实本地文件系统，无 Mock/网络）：2026-09-04 02:27:51 +08:00，更新本交接文档之前，`du -B1 --max-depth=1 .` 报告 **155,645,952 字节 / 148.44 MiB**，`du -sh .` 为 **149M**；PowerShell 文件 Length 总和为 **140,544,162 字节 / 134.03 MiB**。computer-use 读取同一目录的 Windows 原生属性显示大小 **140,544,162 字节**、占用空间 **150,564,864 字节（界面显示 143 MB）**。保留两种工具的原始结果，不将 GNU du 与 Windows 属性的占盘口径混用；此前将 Length 总和称为物理占盘不准确。
- 同次 GNU du 排序：`node_modules` **137,024,512 字节 / 130.68 MiB**，是唯一超过 10 MiB 的根目录；`.git` **6,726,656 字节**，`.output` **4,872,192 字节**，`docs` **4,325,376 字节**，`artifacts` **2,064,384 字节**。除依赖外合计 **17.76 MiB**，包含历史库、输出、文档及测试物证，并非仅生产代码。
- 依赖大项的 `du -sh` 输出：`lucide-react` 37M、`typescript` 23M、`@rolldown` 20M、`lightningcss-win32-x64-msvc` 9.1M、`react-dom` 7.1M。`node_modules` 未被 Git 跟踪且已被忽略；没有为降低表面体积而删除开发依赖。
- 指定的 `.wxt`、`dist`、`node_modules/.cache` 及 `native/ocr-service` 均已不存在。本轮未重新删除文件，新增释放 **0 字节**；未重复运行构建以免重新生成缓存。
- Git 核验：`count-objects -vH` 显示 count=0、garbage=0、1 个 pack（6.24 MiB）；`git fsck --full --unreachable` 退出 0 且无输出；分支及 reflog 可达 blob 中超过 10 MiB 的对象为 0。没有发现所谓 282MB OCR 历史残留，因此本轮未清空 reflog、未改写历史，也未重复执行 aggressive gc。
- 本轮修改前 `git status --short --untracked-files=all` 为空；本交接刷新后只允许 `HANDOFF.md` 有文档差异。本轮没有改动业务代码，也没有将此前测试结果表述为本轮重跑结果。

## 3. 卡在哪里

- 当前真正未通过的是**生产 B站字幕端到端门禁**：全新匿名测试配置下，网页选轨及后台元数据接口返回 412；后台实发 Referer 正确也未改变结果。412 的具体触发条件尚未确证，不能仅凭状态码断言是登录问题或 CORS。
- 用户日常 Chrome 未操作；本轮按最新指令改用独立临时 Chrome。此前 GUI 无法可靠识别 URL 的限制没有被规避，本轮改用用户明确授权的可观测测试实例。
- 图标依赖瘦身仍为原有未提交工作，不能声称整个工作区 clean。该阶段 28.26% 减重而非腰斩的历史结论不变；本轮未重测空间。

## 4. 下一步计划

1. 如继续排查真实 412，在合法可访问的测试会话中核对接口条件，保留状态码和请求来源；不把正确 Referer 或成功夹具当作生产字幕成功，不复制用户登录凭据。
2. 若要求封存上轮图标瘦身，另行审核其包清单、样式、图标许可及测试并单独提交；本次只提交 B站修复相关文件，侧栏图标导入差异留在工作区。
3. 若要求发布或推送，先取得明确授权，核对待发布工作树范围，再构建并复核实际运行哈希；本次没有自动推送。

## 5. 碰到哪些问题

- 新版正式 Chrome 不再接受传统 `--load-extension` 流程；已有 Chrome 152 支持 `Extensions.loadUnpacked`。调试使用独立 user-data-dir、官方调试接口与 loopback 端口；没有安装新浏览器或依赖。
- `Extensions.triggerAction` 要求 **tab target**，不能传 page target；改为 `Target.getTargets` 显式包含 tab 后成功。网站登录提示遮挡测试点击，通过已识别的关闭控件正常关闭，未进行登录或绕过验证。
- 运行态测试必须等待本次唯一字幕标识出现，不能误读旧 DOM。临时 CDP 观察脚本曾有括号遗漏且未检查 exceptionDetails，修复采集器后确认原生按键正常；当前读取 CDP 求值结果会先检查异常。A 在第一句本就不应跳转，测试先通过真实控件定位到中间句，再逐键断言仅产生一个新指令。
- 本轮最初口头统计“24 种图标”不准确；按实际使用去重为 **21 种**，最终为 5 SVG + 16 字符。此前图标是按需导入并经打包处理，不是浏览器加载了整个 37M 图标目录；本轮主要改善开发磁盘占用，生产包只减少 1,804 字节。
- 前端验收首次启动发现 Playwright 自带无头内核未安装，改用已有系统 Chrome 后继续，没有下载新内核。两处测试选择器存在同名按钮歧义，依据 DOM 加 exact/头部范围后通过；未因此修改业务行为。临时脚本一次 patch 使用同文件删除加新增被拒，改为独立验收脚本，未影响仓库文件。
- 完整构建会正常重新生成 `.wxt` 等开发缓存；02:28 的“缓存不存在”是历史快照，不是禁止未来构建生成缓存的长期要求。
- 初次递归删除时，遗留 Python OCR host 正占用 ONNX/OpenCV `.pyd`。先精确确认可执行文件位于目标 `.venv`，停止 PID 10256，再逐文件删除剩余 18 个锁定文件，最终目录和注册项均不存在。
- 需求中的“网络 Fetch 后 10ms 内显示文本”不是可验证的网络时延保证；实现保证选择完成后立即发起 Fetch、响应后立即发布 State，不通过固定延迟或禁用按钮制造等待。
- B站“关闭播放器字幕”只控制画面叠加层，不改变后台字幕数组；选择依据必须是轨道元数据，不能读取播放器开关。
- AI 标记可能同时来自 `is_ai`、`lan_doc`、`ai_status`、`ai_type` 或 `lan=ai-*`。单看数组非空或单一字段都会误分流。
- 文件内容长度、磁盘分配空间和构建输出报告不是同一指标；小文件的磁盘分配会带来额外空间，本次用 GNU du 和 Windows 原生属性分别核对，不能用 Length 求和冒充实际占盘。
- computer-use 首次对纯文本属性快照执行点击时返回 `coordinate input geometry is unavailable`；重新查找真实窗口并采集含截图的状态后继续，不复用失效坐标。空间截图仅证明本机文件系统界面，不证明扩展运行验收。
- `git reflog expire` 会丢弃本地恢复入口，并不会重写仍被分支引用的历史文件；只有确认占用来自需要清理的不可达对象后才考虑使用，不能将其作为通用空间修复命令。

## 6. 如何避免再次出现

- Referer 必须区分“配置了规则”和“实际网络头已观测”，真实 HTTP 失败也要记录；API 返回成功后还须核对非空字幕及最终 DOM。真实临时扩展 + 网络夹具属于运行态模拟证据，不等于真实字幕成功。
- GUI 读地址不稳定时使用当前批准的临时 CDP 浏览器，不读取日常用户 profile/Cookie。浏览器 target、execution context 和源代码哈希必须由协议实际返回，不猜测或复用失效标识。
- 对混合工作树按明确文件与补丁暂存，提交前核对 cached diff；已有无关改动不删除、不回退、不顺手提交。测试报告须注明测试的是工作树还是仅提交的干净树。
- B站轨道选择固定遵守三态：verified manual、verified AI、unknown。unknown 永远不冒充人工轨；只有没有可用人工 URL 时才允许 AI fallback。
- 两条核心断言必须长期保留：混合列表不请求 AI URL；AI-only 必须进入 `loaded` 且产生 RawCue。任何 B站字幕路由修改都运行 `npm run verify:bilibili-ocr`。
- 仓库不得重新加入 Python、ONNX、Paddle/PyTorch、Canvas 视频抽帧、Native Messaging 或 OCR 服务，除非先重新评估并取得明确授权。
- YouTube 与 B站入口保持文件级隔离。验证时单独核对 YouTube 源文件无 diff、YouTube 生产 bundle 哈希和完整 YouTube 集成回归。
- 证据继续分级：静态检查、单元测试、生产 bundle 仿真、真实网络回放、test-browser、installed-real。未重载的 Chrome 和普通网页截图不能升级为 installed-real。
- 空间维护先排序再行动；删除仅限已解析且验证位于项目内的指定路径。通过 manifest/lockfile 移除依赖后执行 npm prune，不手工裁掉已安装库的内部文件，不迁移目录或用压缩伪造省下的空间。保留必要开发链与 Git 恢复记录，截图保存在仓库外。
- 以后只为已批准且不能合理用原生能力解决的需求增加依赖；内联图标保持 5 SVG 预算并保留许可。网络与状态工具不重复造依赖；依赖修改必须运行完整门禁和真实 du 复测。
