# Video Language Helper 交接记录

## 2026-09-04：录音条目切换、顶部留白与原声取消边界

阶段提交范围：用户已授权将本节与上一节的实现、测试及文档一起提交到本地 Git，不推送远程。共 28 个明确文件；提交保留 pre-commit 的源码一致性、单元、构建、类型检查与独立测试浏览器验收。确切提交号以包含本节的 Git 提交为准；新增钩子运行记录保存在 `artifacts/doctor/<运行时间>/`，不把下方既有验收时间混写为本次运行。

### 1. 我们在做什么

按用户“按这个方案执行”授权：三点菜单选择带编号录音，选择后由播放键试听，不下载、不跳转文件目录、不设置录音倍速；高亮靠上并保留一两行空白。纠正此前“居中”和“设置保存目录”的旧方向，以本节为当前需求。沿用 React、Radix、Dexie、Recharts 和原生音频，没有新增依赖、权限或本地服务。

### 2. 完成了什么

- `components/recording-player.tsx`：独立回放行，播放/暂停、进度、时长、三点录音列表。选择条目会停止旧音频、归零、切换对应 Blob，不自动播放；固定 1x，G 仍可控制。移除原生 audio controls 的下载/变速菜单及单独录音历史。保留删除，选中项删除后回退到剩余录音。
- `lib/practice-store.ts`：录音编号保存在原表的可选 take 字段；新增录音时为旧条目补编号，不改数据库版本、不覆盖旧音频。录音仍在停止时自动存入浏览器 IndexedDB，不增加文件目录设置。
- `components/shadowing-exercise-card.tsx`：所选录音决定橙色曲线；原声错误和录音分析错误分开，原声取消/失败不再遮住已有录音曲线，原声可单独重试。
- `components/use-cue-follow.ts` 替代先前未提交的 use-centered-cue：当前范围第一行在顶栏/提示条下约 32px，对选中行前实际加留白，不让上一句尾部占据空隙；兼顾首末行、范围调整、换行及缩放。手动滚动停止跟随，新的高亮变化再恢复。主侧栏仅改此 hook 的导入/调用。
- `lib/capture-audio.ts`：新增测试发现手动拖到片段末尾外时，结束轮询可能抢在 seeking/abort 前判成功。现在定位中不判采集完成，MediaRecorder 的异步 stop 回调仍检查取消信号，不把半段原声当成功返回。
- 进度条按参考图改为细浅色轨道/白色圆点，删除使用现有许可下按需加入的 [Lucide trash-2 原始 SVG](https://raw.githubusercontent.com/lucide-icons/lucide/0.479.0/icons/trash-2.svg)。未安装整个图标包。
- 保留已有未提交改动；未暂存、未提交、未推送。package/lock、两平台字幕库、后台与 `lib/playback-machine.ts` 本轮未修改。E 纯停顿循环、F 独立录音练习、Space 连续播放暂停语义不变。

#### 闭环验证卡片

- `npm run doctor` **Exit 0**：单元 **133/133**，构建/类型检查 Exit 0，扩展运行断言 **156/156**。当前编译产物的集成测试 **90/90**，Exit 0；`git diff --check` 通过。doctor 未执行额外源码修复。
- 本轮最终目录：`artifacts/doctor/2026-09-04T02-04-55-012Z/`，含 doctor.log、unit.log、build.log、typecheck.log、e2e.log、integration.log、doctor-report.json、browser-report.json。构建产物 `.output/chrome-mv3` 更新于 `2026-09-04T02:04:59.815Z`。
- HEAD `393c3ce256d922c70111f00ed6f3e6ba2fc6b133` 的未提交工作树构建。集合 SHA-256：`230c13723a3b46417b3722e1a0fce9708870d5e1ec4e9f9c327dbb30821e13c6`；main.tsx SHA-256：`fe01ee0ab60fdae0dc533be9bc7d4eb5c0d5a57ae1bff33d1f82fb8fed8bc47c`。14 条执行脚本哈希记录匹配磁盘，包含实际侧栏、后台、两平台内容脚本。
- 浏览器时间 `2026-09-04T02:05:01.733Z`—`02:06:37.823Z`；Windows / Node 26.3.0 / Playwright / Headless Chrome 152.0.7977.65，独立临时配置加载真实扩展。**字幕/API及 WAV 媒体是仿真，麦克风是 Chromium 虚拟设备**；媒体时钟、录音、IndexedDB、解码、按键和实际 DOM 真实执行。没有操作日常 Chrome，不是真实网络或 installed-real 验收。
- 两平台分别录三次，逐份核对播放 Blob 与 IndexedDB 音频 SHA-256 一致、三个 Blob 不同、切换后 paused/0秒/1x；橙色曲线随录音更新，删除回退、重开句子持久化、进度拖动及 320px 菜单边界通过。
- 非零 5—8秒片段正常采集；采集 3—5秒时主动拖至12秒取消，保留录音曲线/回放，再重试恢复原声。新增三项采集单测覆盖成功、结束轮询与 stop 之间取消、定位越过句末；补丁前两项反例失败，补丁后通过。
- 18 次顶部定位测量留白 **31.5—32.28125 CSS px**，最大偏差0.5px；额外断言上一项底部不侵入空隙。应用错误0，36条 preload/cross-world警告保留，不称控制台全零。
- 实际截图：本目录 `recording-menu-*-simulated-test-browser.png`、`recording-menu-narrow-*-simulated-test-browser.png`、`recording-fallback-*-simulated-test-browser.png`。最新 `artifacts/verification_latest.png` 对应 YouTube 三条录音菜单，身份保存在 verification_latest.json；已按截图对照流程检查普通、窄屏、取消态。

### 3. 卡在哪里

本轮约定的实现与独立测试浏览器验收已完成。用户原截图中的取消究竟由何种站点事件触发，单凭截图仍不能确定；非零定位未复现自取消，不能把本轮确认的取消竞态泛化为所有站点问题的唯一原因。真实人声、真实站点网络及用户当前安装扩展不在本轮已通过证据内。

### 4. 下一步计划

1. 按本次阶段提交授权明确暂存这 28 个相关文件；保留自动验证钩子，提交后核对完整工作树状态，不自动推送。
2. 录音后续改动继续检查 Blob 对应关系、非自动播放、删除/重开持久化及取消后的曲线可用性。
3. 如需真实站点/物理麦克风专项，单独记录环境和触发事件，不覆盖或升级当前仿真证据。

### 5. 碰到哪些问题

失败记录均保留：01-57-08 的新增按钮测试误用 title 作无障碍名称；01-58-44 暴露原声取消后误返回半段数据；02-00-57 中取消已正确返回，但水平 SVG 线的零高度被 Playwright 误判“不可见”，改为图表可见+实际路径数据+截图共同判断；02-02-34 在缩窄视口后过早读取弹出菜单位置，改为等待实际布局边界满足后记录。截图对照还发现上一句尾部侵入假留白，最终改为选中行前真实空白，并加前项边界断言。这些中间失败不能作为最终成功证据。

### 6. 如何避免再次出现

不再使用原生 audio controls 期待可定制的三点菜单。原声与录音是独立数据源，不能让一个错误清空另一个结果。录制结束是异步过程，取消检查必须覆盖最终 stop 回调。布局验证既量位置也看图片；“偏移32px”不等于“32px空白”。新增测试须等待语义状态/布局稳定，不能为绕过真实错误放宽断言。

---

## 2026-09-04：音高说明、F 跟读入口与高亮居中

### 1. 我们在做什么

按用户截图及 `go` 授权，调整 Enjoy 风格音高图/说明、麦克风悬停提示和 F 快捷键，并让当前字幕及练习范围居中。沿用 React、Recharts、Pitchfinder 和原生键盘事件，没有新增依赖。官方说明参考 [Enjoy 音高介绍](https://discuss.enjoy.bot/t/topic/28)，具体控件以用户两张截图为准；独立实现，没有提取 Enjoy 扩展代码。

固定边界：E 仍为“播放一句 → 停顿本句时长 → 自动下一句”，不录音；F 进入麦克风练习，片段播完停住、S 重播；普通播放/Space 恢复连续播放。没有照搬参考图的 E 或“普通播放重播”，避免覆盖用户已经确认的行为。

### 2. 完成了什么

- `components/pitch-curve.tsx`：青色原声、橙色录音；音高用不跨空白连接的线，底部填充及虚线对应相对音量；播放位置单独用竖线，不再把进度阴影描述为音量。沿用 High/Mid/Low、折叠及来源开关。
- `components/shadowing-exercise-card.tsx` / `components/hover-hint.*`：问号悬停显示截图中的“如何读懂图表”说明；麦克风显示真实开关状态、片段暂停、S 重播和 F。气泡支持键盘聚焦/Escape、自动避开视口边缘，不使用原生 title 或 alert。
- `entrypoints/sidepanel/main.tsx`、`lib/shortcuts.ts` / `protocol.ts` 与两平台内容脚本：F 接入原有 `togglePracticeMode`；只在扩展已连接并加载字幕、非输入区域时接管整个 F 按下/长按/松开，避免同时触发网站全屏；E/Space 原行为保留。
- `components/use-centered-cue.ts`：按真实可见区域中心定位当前高亮/选中范围，包含第一句、最后一句、范围扩缩及侧栏尺寸变化。人工滚动后不被媒体时钟持续拉回，下一次高亮变更继续居中。窄侧栏底栏已保持按钮不重叠、不越界。
- `lib/pitch.ts`：测试发现轻声低频会被现有 YIN 输入处理误判为超高频后过滤。修复为按采样率设置分析帧及归一化检测输入，保留原始音量；浏览器只对分析副本重采样到 16kHz，不改变录音文件或播放。16k/44.1k/48kHz 下的轻声 80/150/220Hz 回归均通过。
- README 和快捷键帮助同步更新。`lib/playback-machine.ts`、两平台字幕库、后台及 package/lock 无 Diff；doctor 未执行额外源码自愈。未暂存、未提交、未推送。

#### 闭环验证卡片

- `npm run doctor` Exit 0：单元 **130/130**，构建及类型检查 Exit 0，实际扩展浏览器断言 **114/114**；生产包集成 **90/90**，Exit 0。`git diff --check` 通过。
- 最终 doctor：`2026-09-04T01:04:43.974Z`—`01:05:49.134Z`；产物时间 `01:04:48.738Z`；输出 `.output/chrome-mv3`。Windows / Node 26.3.0 / Playwright / Headless Chrome 152.0.7977.65；Browser 插件不可用，复用项目现有 Playwright。
- 证据等级：**独立测试浏览器加载真实编译扩展；字幕/API及媒体内容为仿真，原生媒体时钟/键盘/音频分析实际运行；麦克风为 Chromium 虚拟设备**。未操作日常 Chrome、没有真实字幕网络 API 或物理麦克风验收，不能称 installed-real。
- HEAD `393c3ce256d922c70111f00ed6f3e6ba2fc6b133`（未提交工作树构建）。构建集合 SHA-256：`cbdcbf770797515afc7e215f02d6dc8520b3d9c496a272dd5f52ce00a4aa0701`；main.tsx SHA-256：`d23c5ad7167905333497e97c2e7f463934cca54ce2a2f3a7d312d8ac1ab3d1ce`。9 个实际执行脚本与磁盘哈希匹配。
- 两平台均通过 F 完整按键、输入保护、E 模式隔离、Space 松键保持暂停、两次等时停顿循环、音量/来源切换、问号聚焦/Escape、首末行及多句范围居中、320px 底栏和人工滚动检查。14 次居中测量最大偏差 **0.453125 CSS px**；0 应用错误，21 条预加载/跨执行世界 preload 警告保留，未声称控制台全零。
- 原始最终日志/报告：`artifacts/doctor/2026-09-04T01-04-43-973Z/` 下 doctor.log、unit.log、build.log、typecheck.log、e2e.log、doctor-report.json、browser-report.json。同构建的 90 项集成日志：`artifacts/doctor/2026-09-04T01-00-52-559Z/integration.log`。
- 两平台截图：上述最终目录中 `pitch-help-*-simulated-test-browser.png`、`microphone-help-*-simulated-test-browser.png`、`narrow-centered-*-simulated-test-browser.png`；已目视核对原图与实现。`artifacts/verification_latest.png` 对应本轮 YouTube 音高帮助截图，来源在 verification_latest.json。

### 3. 卡在哪里

本轮实现及指定自动验证完成，无代码阻塞。真实站点当前版本、实际人声及用户安装环境未验收；不能把本轮仿真测试结论扩大为这些环境已通过。参考图片的 DPR 未提供，不宣称未知密度下的逐像素一致。

### 4. 下一步计划

1. 后续提交时只暂存本轮明确文件，保留 doctor/pre-commit，不自动提交或推送。
2. 新增/调整快捷键必须继续验证完整按下、长按、松开及输入区域，保持 F/E/Space 分工。
3. 如进行安装态或真实语音专项，单独记录站点、音频来源和运行哈希，不覆盖本轮证据分级。

### 5. 碰到哪些问题

最初协议用例少了 F，已更新真实映射；浏览器测试页缺 UTF-8，导致中文输入框无法匹配，已修复 fixture；轻声低频漏检由实际音频与新增单测发现并修复；320px 练习模式多一个听写按钮，原底栏宽度会挤掉麦克风，已缩小窄屏控件并增加逐对矩形断言。初版音高截图没有完整卡片，最后等待异步滚轮结束再取景，并新增完整可见断言和截图前后几何记录；未改生产高亮逻辑来迁就截图。所有旧失败日志保留在本日 doctor 子目录中。

### 6. 如何避免再次出现

图表文案必须与数据层含义一致：线是音高、填充是音量，不能把播放进度说成音量。以真实低频/低音量数值测试检测器，不只断言图表容器存在。UI 验收同时检查几何、交互和图片，不能只看组件已挂载；居中取景与人工滚动查看练习卡是不同状态，要分开截图和断言。

---

## 2026-09-04 08:25 +08:00：README 功能说明修缮

### 1. 我们在做什么

按用户要求把 README 改为面向使用者的简洁指南：全面介绍当前功能模块、操作入口和快捷键；不保留无必要的研发过程、旧测试数量或 Enjoy 功能参考说明。

### 2. 完成了什么

- README 以 9 个模块说明字幕阅读、双语、播放、逐句停顿、录音、片段调整、音高、听写和设置，补全安装、快捷键、本地记录与重试方法。
- 纠正“录音/听写尚未开放”“Manual 等同逐句跟读”和并不存在的原始字幕切换入口；明确逐句模式纯停顿、麦克风模式独立练习，以及 Space 恢复连续播放。
- 删除 Enjoy 参考说明和旧实现细节，仅保留第三方许可入口及实际使用的 Pitchfinder/YIN GPL 说明。已核对本地依赖源码的 aubio/GPL 声明与 GNU 官方条款；不修改任何许可证文件，不擅自为自有代码新增许可证。
- 文档静态断言 56/56、`npm test` 128/128、`git diff --check` 均通过。日志：`artifacts/readme-check.log`、`artifacts/readme-unit.log`。
- 证据：Windows / Node 本地文档检查与单元测试，基于 HEAD `4c5a7f9fa35b59b44bda031c113bc5e1ba71c48c`。157 个受跟踪的非 Markdown 文件聚合 SHA-256 前后均为 `0e46eadfa971fad89cf9006b0e282fcb67d6a72ecd39ca79e77874809f40eb67`；仅修改 README 和本交接文档。文档修缮阶段未重新构建或验收浏览器；后续提交阶段仍由现有 pre-commit 运行 doctor，日志另存于 `artifacts/doctor/`，不代表日常浏览器安装态验收。

### 3. 卡在哪里

文档修缮无阻塞；用户随后授权本地提交，本节随 README 一并保存，准确提交身份以 `git log -1` 为准。没有远程推送授权。README 的简短许可说明不替代实际分发时的许可证遵循，现有版权及许可文本均保留。

### 4. 下一步计划

1. 核对两份文档的本地提交与工作树状态；仅在用户另行要求时推送。
2. 后续新增功能时同步更新模块表与快捷键，避免将已实现功能仍写成预留。
3. 使用现有 doctor 做功能改动验收，保持 README 不夹带易过期的测试数量和机器路径。

### 5. 碰到哪些问题

原 README 落后于已提交的功能，且夹杂调试、内部状态和架构细节。不能只增加录音介绍：需要同时纠正两个模式、播放键语义与当前实际设置入口。实际依赖的许可义务也不能因移除功能参考品牌而一并遗漏。

### 6. 如何避免再次出现

功能描述以当前按钮、事件与状态代码为准；文档修改机械验证快捷键、命令、链接、模式边界和源码零改动。测试与实现细节留在交接/验收记录，不堆进用户入门说明。

---

## 2026-09-04：本地 Git 提交快照

### 1. 我们在做什么

用户确认任务基本完成，授权将当前已完成成果提交到本地 Git；没有授权推送远程。本节与功能源码一起提交，准确提交身份由本仓库 `git log -1` 查询，不在文件中嵌入其自身提交哈希。

### 2. 完成了什么

提交范围：逐句等时停顿与独立录音/听写/音高练习、YouTube 空格松键修复、本地图标、项目规则、自愈/独立浏览器验证与 pre-commit 门禁，以及相关测试和依赖锁定。最近完成的同源码验证为 128 项单元、88 项生产包集成、72 项独立浏览器断言；完整来源和构建身份见下方 07:25 卡片。提交时由现有 pre-commit 再运行 doctor，不绕过钩子。

### 3. 卡在哪里

无已知提交阻塞。真实网络、物理麦克风和用户安装态验证边界保持不变；不将“基本完成”扩写为已完成这些额外验收。`artifacts/delivery/` 下的 4 个旧源码导出文件保留在本地，不纳入本次源码提交，也不删除或新增忽略规则。

### 4. 下一步计划

1. 提交成功后核对提交哈希、暂存区和完整工作树状态。
2. 后续改动继续运行现有自动验收，保持两个模式独立及完整空格按键周期测试。
3. 只有用户另行要求时才推送远程。

### 5. 碰到哪些问题

工作树同时包含此前尚未提交的整套练习功能和本轮修复，不能只提交 YouTube 脚本而遗漏它导入的新模块。源码导出包是另一类交付文件，不能为追求“干净”而混入或删除。

首次暂存检查发现两份新增许可证文本尾部多一个空行；仅清除该空行，未修改任何许可条款，然后重新检查暂存区。

### 6. 如何避免再次出现

按明确文件清单暂存，并由提交钩子检查索引与实际受测源码一致。分别报告本地提交、远程推送和未跟踪文件状态；下方历史记录中的“未提交”仅指当时状态。

---

## 2026-09-04 07:25 +08:00：YouTube 空格松键回播修复

### 1. 我们在做什么

用户反馈：YouTube 按住 Space 暂停、松开却恢复；B站按一次暂停、再按一次播放正常。此次仅修复 YouTube 按键事件配对，不改逐句等时停顿、独立录音模式、字幕下载或 UI。复用原生 DOM 事件捕获，不增加依赖。

### 2. 完成了什么

- `entrypoints/youtube.content.ts:421`：只对已接管的 Space 按下记录归属；长按不重复切换，配对的 keypress/keyup 只拦截、不再次播放；blur 清理归属。输入框、组合键、未连接状态及其他按键仍保留原行为。
- `tests/integration/bridge.test.mjs:436`：新增 5 个回归用例，覆盖 auto/manual/shadowing/practice、松键保持暂停、长按、再次播放、焦点/修饰键变化、断开及失焦。先在旧编译包上得到 5 个失败，再应用补丁全部通过。
- `scripts/verify-extension.js:234`：测试播放器焦点下真实键盘 down/repeat/up，两平台各验证两轮。YouTube 测试页增加明确标注的“网站 keyup 再切换”仿真，防止旧测试再次漏检。
- 本轮生产修改仅 YouTube 内容脚本；B站内容脚本、main.tsx、共享播放控制器的修改前后 SHA-256 完全一致。无暂存、提交或推送，其他工作树修改保留。

#### 闭环验证卡片

- `npm run doctor` Exit 0：128/128 单元测试、构建、类型检查、72/72 浏览器断言通过；另行运行生产包集成测试 88/88，Exit 0。doctor 未修写其他源码；`git diff --check` 通过。
- 运行时间 `2026-09-03T23:24:36.941Z` 至 `2026-09-03T23:25:32.681Z`；Windows / Node 26.3.0 / Playwright / Headless Chrome 152.0.7977.65。Browser 插件不可用，沿用项目 Playwright 与一次性独立浏览器。
- 证据等级：独立测试浏览器实际加载编译扩展，原生媒体时钟与键盘事件；字幕/API/媒体内容及网站 keyup 处理是仿真，不是真实 YouTube 站点实现回放。未操作日常 Chrome，未调用真实字幕 API，非 installed-real。
- YouTube 两轮按下/松开后的媒体时间分别保持 `8.311777 → 8.311777`、`8.515335 → 8.515335` 秒且 paused=true；再次按下并松开后恢复播放至 `8.514352`、`8.716884` 秒。每轮均长按重复 3 次，松开后再等待 350ms；仿真网站松键处理触发 0 次。B站两轮同样通过。
- 逐句等长等待、E 切换、录音模式隔离与音高曲线回归通过；0 应用错误、18 条预加载/跨执行世界预加载警告保留在报告。截图已目视检查：松键后底栏显示播放图标，逐句按钮仍在原位置，无错误遮罩。
- HEAD `dea66688eb14b58e4ba5d900f3109c4c80e7d0ce`（工作树构建）；构建 SHA-256 `09f3f195ece75b423d0df53e34487ad702810cd2b52c110e81307b0601890245`；YouTube 源码 SHA-256 `04831fe37b741519b09c75cdf2a838f11cdbf2913c41d60a4db956a4a6a058e6`。运行中侧栏/后台/两平台脚本与构建哈希一致。
- 原始失败日志 `artifacts/space-keyup-before-fix.log`；成功日志与时间线 `artifacts/doctor/2026-09-03T23-24-30-377Z/`，含 doctor.log、unit.log、build.log、typecheck.log、e2e.log、integration.log、browser-report.json。
- 松键截图 `artifacts/doctor/2026-09-03T23-24-30-377Z/space-release-youtube-simulated-test-browser.png`；另有 B站同名截图及两模式回归截图。`artifacts/verification_latest.png` 仍为本轮逐句模式截图，其来源见 verification_latest.json。

### 3. 卡在哪里

源码修复与自动化验证完成。真实 YouTube 具体原生监听路径和用户当前安装版本尚未独立采集；上述仿真及测试浏览器证据不能替代安装态验收。

### 4. 下一步计划

1. 后续键盘回归必须包含完整按下/长按/松开，不只测试 keydown。
2. 如进一步验收真实站点，另记加载路径、运行哈希、焦点及原生按键时序。
3. 如用户要求提交，只审查并暂存明确文件清单，保留其他未完成修改。

### 5. 碰到哪些问题

原代码只拦截 keydown，配对 keyup 可以交给网站处理。此前 57 项浏览器测试虽发送完整键盘动作，但测试页面没有网站松键切换逻辑，无法发现本次冲突；撤回其足以证明真实 YouTube 空格行为正常的含义，其他已验证模式结果不受影响。

### 6. 如何避免再次出现

一次已接管的按键动作只能发一个播放命令，释放事件只清理与阻断；不应全局拦截所有 Space 松键。保留未接管输入、失焦清理和两平台对照回归。截图只证明可见状态，保持暂停必须由键盘/媒体时间线断言证明。

---

## 07:10 的模式分离记录（空格验收边界以上文为准）

更新时间：2026-09-04 07:10 +08:00。本轮在 `D:/github/youtube-language-helper` 分离“逐句跟读”和麦克风“跟读”功能；HEAD 仍为 `dea66688eb14b58e4ba5d900f3109c4c80e7d0ce`，未暂存、未提交、未推送，既有工作树保留。

## 1. 我们在做什么

用户最新定义：**逐句跟读只做等时停顿后自动下一句，不包含录音；右侧麦克风的跟读模式是独立的录音练习功能。** 沿用现有 React 状态和共享播放控制器，新增独立 `practice` 模式值，不增加任何依赖，不改变录音组件、音高曲线组件或 CSS。

## 2. 完成了什么

- `shadowing`：专属“逐句跟读”按钮/E 控制；只显示字幕和黄色模式条。句末暂停本句同等时长后自动下一句。没有录音卡、听写按钮或麦克风请求。
- `practice`：仅由麦克风“跟读模式”按钮进入；保留录音、音高曲线、听写和片段范围。片段结束后停留在本句，不启动定时下一句。进入任一模式时退出另一个模式，两个按钮不再共用点击函数或激活条件。
- `main.tsx` 使用 `toggleShadowing` 与 `togglePracticeMode` 两个入口；两平台播放消息支持独立 practice 范围，录音相关快捷键仅在 practice 转发；音频 RPC 在非 practice 模式明确拒绝，不再抢占逐句停顿。
- 普通播放/暂停和 Space 保持原先语义。字幕下载、原始时间轴、录音/曲线组件源码和全部样式未在本轮修改。doctor 模板和项目规则同步两个模式的边界。
- 撤回上一轮“两个入口已经独立”的含义：07:00 的截图仍有录音卡，39 项浏览器断言没有覆盖两个入口隔离，只能证明定时循环，不能证明本轮要求。

### 闭环验证卡片

- `npm run doctor`：Exit 0，**128/128 单元测试、构建、类型检查、57/57 浏览器断言通过**。另跑生产包集成测试 **83/83，Exit 0**，包括两平台纯停顿不转发录音键、不接受音频采集的断言。
- 时间：`2026-09-03T23:08:22.695Z` 至 `2026-09-03T23:09:15.135Z`；Windows / Node 26.3 / Playwright / Headless Chrome 152.0.7977.65，侧栏 430×900。Browser 插件未提供，使用项目已有 Playwright。
- 来源与等级：**独立测试浏览器，实际加载编译扩展，模拟字幕/API，原生媒体时钟**。录音回归只使用 Chromium 虚拟麦克风与一次性测试配置，不访问真实麦克风。未访问真实字幕 API，未操作用户日常 Chrome，不是 installed-real。
- 两轮无输入停顿：B站 **3007.4ms / 2001.8ms**，YouTube **3008.0ms / 2010.0ms**，对应 3 秒/2 秒字幕；该阶段麦克风请求为零。
- 另行点击麦克风后：R 启动/停止虚拟音源录音，生成并保存可播放音频；原音高曲线实际渲染；H 听写可用。切回逐句跟读后录音卡消失，R/H/P 不再激活录音功能。
- 页面身份、非空字幕、按钮位置、模式状态、无框架错误遮罩、截图与交互检查通过。0 应用错误，21 条预加载/扩展跨执行世界预加载警告原样保存在报告，不宣称 0 warning。
- 构建 SHA-256：`2c007b9aca1ea3177143eac63847dee6f214ec47ecd8c1c68f2154cd5e34f6a6`；main.tsx SHA-256：`c779ac8901ad949abe4906edf435292f1ba54f227cfa0ed4c3e41b8a2af0842a`。执行中的侧栏、后台、两平台内容脚本与构建哈希一致。
- 日志目录：`artifacts/doctor/2026-09-03T23-08-16-103Z/`，含 doctor.log、unit.log、build.log、typecheck.log、e2e.log、integration.log 和 browser-report.json。
- 逐句停顿截图：同目录 `shadowing-{bilibili,youtube}-simulated-test-browser.png`；独立录音模式截图：`recording-{bilibili,youtube}-simulated-test-browser.png`。`artifacts/verification_latest.png` 是最新 YouTube 纯停顿截图，来源记录在 verification_latest.json。

## 3. 卡在哪里

本轮自动化门禁已通过，无未解决的功能阻塞。物理麦克风、真实平台网络和用户当前安装环境未验证，不能用模拟音源或独立测试截图替代这些证据。

## 4. 下一步计划

1. 后续 doctor 必须同时验证“纯停顿无录音”和“麦克风练习无自动跳句”，不能只看按钮存在。
2. 如继续进行安装态验收，记录实际加载路径和运行哈希，单独注明真实网络/设备范围。
3. 如用户要求提交，只暂存确认过的任务文件，保留其他工作树内容。

## 5. 碰到哪些问题

原来的文字按钮与麦克风共用了 `toggleShadowing`/`playMode === 'shadowing'`，导致只想停顿却挂载整个录音练习区；已从状态、渲染、快捷键、RPC 四层拆开。首轮测试授权指定 chrome-extension origin 被 Chrome 视为 opaque origin 而拒绝；该轮明确失败。改为仅在一次性测试浏览器上下文授权虚拟麦克风后，全流程通过，未修改日常浏览器权限。

## 6. 如何避免再次出现

以用户描述区分“逐句跟读”和“跟读”，不要凭名称相近复用模式。保留现有 React 条件渲染和惰性加载：只有用户进入麦克风模式时才挂载练习组件。验收既要测存在，也要测不该出现的录音区、麦克风请求和快捷键确实不存在。

---

## 07:00 前的记录归档；以上述两模式定义与最新验收为准

更新时间：2026-09-04 07:00 +08:00。当前仓库 `D:/github/youtube-language-helper`；HEAD `dea66688eb14b58e4ba5d900f3109c4c80e7d0ce`，本轮为未提交工作树修复，没有暂存、提交或推送，保留既有修改。

## 1. 我们在做什么

以用户最新对话为唯一功能标准，不再追查旧记录：逐句跟读 = 播放一句 → 停顿本句 `endMs - startMs` 的时长 → 自动播放下一句，持续循环。停顿按字幕持续时间，不随播放倍速缩短。独立的逐句跟读按钮/E 控制此模式；普通播放/暂停仍共用按钮和 Space，按播放进入连续播放。技术栈沿用 WXT / React / TypeScript / Playwright，本轮没有新增依赖。

## 2. 完成了什么

- `lib/playback-machine.ts`：恢复可取消的等长等待循环，暂停时保留本句末帧，到期精准定位下一句再播放；重复 timeupdate 不重复创建循环。最后一句停住。普通播放取消跟读，切句、录音暂停、断开、替换媒体和销毁不会被旧计时器抢播。队列跳过已经包含在扩展练习范围内的句子，不改原始字幕。
- `entrypoints/sidepanel/main.tsx`：真实 `toggleShadowing` 绑定保留；按钮始终可见“逐句跟读”且按模式高亮；播放按钮统一发送 `playback-toggle`，不再重播当前句；修正帮助文案。布局、CSS、Recharts、麦克风及字幕下载逻辑均未在本轮修改。
- `entrypoints/youtube.content.ts`：为等待页面元数据的定位请求增加独立代次，新播放或模式操作取消旧定位，避免快速切换后状态回跳。独立于字幕加载的 gate，不更改字幕网络管道。
- doctor 修复模板、单元/集成/浏览器断言、AGENTS.md 与 .cursorrules 已同步此行为，不再把“无限等待手动重播”当作正确功能。
- **明确撤回此前的验收结论**：下方旧记录及 `artifacts/doctor/2026-09-03T22-38-13-517Z/` 的 117 项单测、23 项浏览器断言和截图只验证了错误的“句末无限停住/手动重播”契约，不能证明用户要求已恢复。它们不再作为当前验收证据。

### 闭环验证卡片

- `npm run doctor`：Exit 0；125/125 单元断言、构建、TypeScript 检查、39/39 扩展浏览器断言均成功。
- `node --test tests/integration/*.test.mjs`：Exit 0，81/81 成功，含延迟定位请求取消的两条新增回归断言。完整输出保存于下面的 integration.log。
- 运行时间：浏览器 `2026-09-03T22:58:59.333Z` 至 `2026-09-03T22:59:28.313Z`；Windows、Node 26.3、Playwright、独立 Headless Chrome `152.0.7977.65`，侧栏视口 430×900。Browser 插件不可用，使用项目已有 Playwright。
- 证据等级：**独立测试浏览器加载真实编译扩展 + 模拟页面/字幕/API + 原生 HTMLVideoElement 媒体时钟**。没有调用真实 B站/YouTube 字幕 API，没有操作或验收用户日常 Chrome 安装态。
- 两轮循环期间没有点击、按键或修改媒体时钟；B站 3 秒句实际停顿 **3008.4ms**，2 秒句 **2010.5ms**；YouTube 对应 **2999.9ms / 2003.7ms**。误差来自浏览器事件/定时调度，不能宣称零误差。随后自动选中第三句，按钮、黄色提示、Space、页面 E、侧栏 E 和连续播放均通过断言。
- 页身份、非空字幕列表、按钮原位置、无错误遮罩、交互状态及截图已检查；0 应用错误、0 alert。9 条浏览器预加载/扩展跨执行世界预加载警告仍保留在报告中，并非 0 warning。
- 产物：`.output/chrome-mv3`；本轮构建 SHA-256 `6197ce87810b9ff745aff0bbe49e79044a805a1e472f592488c23c6a36d23c86`；运行中的侧栏、后台和两平台内容脚本均与该产物逐文件哈希一致。
- 源码 SHA-256：main.tsx `a4a01625542ce00e67ea7ff2232ed066f657b3ea1170b7ec772e12957f2803f4`；playback-machine.ts `b10a45acc0a67fabcbf3afbc4a4695c01b416f7199342272a671be9e58155fd2`；youtube.content.ts `789817ed684456d7c2a6b75331b20744a90208c404e0f83a34454f04be90a55d`。
- 日志：`artifacts/doctor/2026-09-03T22-58-53-349Z/doctor.log`、`unit.log`、`build.log`、`typecheck.log`、`e2e.log`、`integration.log`、`browser-report.json`。
- 截图：`artifacts/doctor/2026-09-03T22-58-53-349Z/shadowing-bilibili-simulated-test-browser.png` 与 `shadowing-youtube-simulated-test-browser.png`。最新别名 `artifacts/verification_latest.png` 对应 YouTube，来源与构建标识在 `artifacts/verification_latest.json`。

## 3. 卡在哪里

本轮规定的源码、构建、自动化行为验收无阻塞。用户日常浏览器的实际加载版本、真实平台播放器内核、后台标签页节流和真实网络波动未纳入本轮独立浏览器验收，不能用此截图冒充 installed-real。仓库仍有之前的未提交修改，不宣称工作树干净。

## 4. 下一步计划

1. 后续涉及播放行为的修改先运行 doctor，保留“两句不同时长、无输入自动续播”的断言。
2. 如继续进行安装态验收，单独记录所加载目录、运行哈希、真实平台和时间，不复用本次 simulated-test-browser 标识。
3. 如用户要求提交，审查明确文件清单并运行 pre-commit 门禁；不要顺手提交其他未完成修改。

## 5. 碰到哪些问题

- 原实现和原测试一起把功能误定义成无限暂停。先按用户描述更换断言，得到 4 个失败，再修正代码使其通过。
- 首轮浏览器运行 `2026-09-03T22-56-43-549Z` 的两轮等长循环已成功，但快速 E/按钮切换超时，整轮明确失败，未当作成功。随后用集成仿真复现“延迟 info 回应使新操作后又倒退到旧句”的两个失败，增加独立定位代次后通过；最新 doctor 全流程成功。
- Git 的 LF/CRLF 转换提示不是构建/测试失败；`git diff --check` 通过。当前 Git diff 包含既有工作，不可将整份 diff 的行数归为本轮新增。

## 6. 如何避免再次出现

- 用户明确功能描述优先于历史版本、旧自愈模板和旧测试；“逐句暂停”不能自行简化为“永久暂停”。
- 专属模式与普通播放按钮职责分离，真实 UI 事件继续接业务状态，不增加占位符或新焦点依赖。
- 采用现有 React 状态/事件处理方式，计时器由单一控制器拥有；所有新操作必须取消旧循环及迟到的定位。保持现有按需加载与麦克风/音高曲线模块不变。
- screenshot 只能证明当时可见状态；计时行为必须用原生媒体事件时间线和连续两轮断言证明。模拟数据与用户安装环境始终分开记录。

---

## 以下为历史归档，不代表当前功能标准或当前验收结论

更新时间：2026-09-04 06:42 +08:00。仓库 D:/github/youtube-language-helper；HEAD dea66688eb14b58e4ba5d900f3109c4c80e7d0ce。本次已固化全局规则、核对Git历史并重新构建和验证工作树；未暂存、未提交、未推送，保留此前所有改动。

## 1. 我们在做什么

固化跨项目持续交付规则，并按Git历史复核逐句跟读真实绑定及项目级 doctor、自愈回归、独立浏览器验证和 pre-commit 门禁。技术栈为现有 WXT / React / TypeScript；Playwright 仅为开发测试依赖，不进入扩展包。

## 2. 完成了什么

- 本轮全局协议写入 C:/Users/alxanday/.codex/AGENTS.md，保留原有规则并加入自动验收、禁止生产占位、Git历史优先、分级证据要求；修正旧条款对已授权任务重复等待go的冲突。全局文件11357字节，无AGENTS.override.md遮挡，未更改config.toml或系统权限。按官方发现机制在使用此CODEX_HOME的新运行跨项目加载；不是当前所有会话热重载或其他主机同步的声明。
- 通过 git log -S "逐句跟读" -p -n 5 及 git show 核实来源 commit 874871a986aea58399d2f1b1dc96397cfa94ed7a。历史包含 toggleShadowing、echo-toast 与 enforceBoundary/video.pause；但还包含等长等待后自动跳下一句，与当前等待/同句重播行为不同，未盲目整段回退。
- main.tsx:440–455 的占位 alert 上一轮已移除，本轮确认无回退、无新增生产代码Diff。onClick={toggleShadowing}（452行），aria-pressed、动态文字和橙色激活背景都由现有 playMode 派生。保留下一句与重播之间的位置；顶部415行原有黄色模式条与同一状态联动。
- 原有 PrecisePlaybackController.enforceBoundary 的句尾暂停守卫正常，未再次改写控制器。真实扩展中两平台第一句均在原生 video.currentTime=3 秒时 paused=true；等待、同句重播、连续播放和页面/侧栏 E 切换通过。
- scripts/doctor.js：TypeScript AST 定位按钮、提示条、句尾方法与 timeupdate 绑定；只修复已知局部结构，改前备份，重复运行不再改动健康源码，遇到歧义拒绝覆盖。随后运行单元、构建、类型检查和扩展 E2E。
- scripts/verify-extension.js：使用已安装 Chrome 的独立临时配置加载最新实际扩展，提供模拟字幕/API和合成 WAV，但运行原生 HTML 媒体时钟与真实扩展消息。验证实际侧栏，不用伪造的 React 预览替代扩展；不接触日常 Chrome。
- package.json 已注册 doctor / verify；安装 Playwright 1.62.1 开发依赖及其锁定记录，没有下载额外浏览器。AGENTS.md 和 .cursorrules 已写入启动自检与证据规则。
- .githooks/pre-commit 已创建，仓库本地 core.hooksPath=.githooks。通过 git hook run pre-commit 实测拒绝未暂存源码，退出1；这次是预期拒绝，不是提交成功。脚本不会自动暂存、提交或推送。
- tests/doctor.test.ts 的9项回归覆盖删除按钮、alert占位、缺失提示条/句尾守卫/timeupdate、注释不能伪装可执行暂停、重复/未知结构拒绝及提交索引不一致。修复用内存故障样本，不破坏用户工作树。

### 闭环验证卡片

- 最终命令：npm run doctor，进程退出0。本轮采集开始：2026-09-04 06:38:13 +08:00，准确结束时间见该轮 doctor-report.json；Git/全局规则审计：06:40:59 +08:00。
- 环境：Windows / Node v26.3.0 / Chrome 152.0.7977.65；WXT 0.21.4 / Vite 8.2.2。
- 结果：117/117 源码单元、build退出0、tsc退出0、23/23扩展E2E；侧栏应用错误0，预加载/cross-world警告9条保留在 browser-report.json。
- 证据等级：独立测试浏览器实际安装新扩展；页面、字幕API与媒体数据为模拟，无生产网络字幕验收，不是 installed-real。未测试真实麦克风、音高采集或录音。
- 扩展产物：.output/chrome-mv3；sidepanel.html 更新时间 2026-09-03T22:38:15.438Z。构建集合 SHA256：8922efdd864ce24a4ffe9687154b9440c294362db4c17980f468ece54717d063（生产源码未变，因此新构建内容哈希相同）。
- main.tsx SHA256：14e1276d958cfe2b241f5723f322b6624ab97c1b2548eddfca3f8898dd065cf1。实际执行的侧栏、后台与两平台内容脚本 SHA256 均与本次磁盘产物一致；运行中产物未变。
- 完整原始日志：D:/github/youtube-language-helper/artifacts/doctor/2026-09-03T22-38-13-517Z/doctor.log。该目录还保存 unit.log、build.log、typecheck.log、e2e.log、doctor-report.json、browser-report.json。
- 同目录历史凭证：git-history-pickaxe.log、git-history-pause.log、history-to-working-tree.diff、history-audit.json。history-to-working-tree.diff 是旧commit对当前工作树的差异，包含前序改动，不能冒充本轮新修复。global-AGENTS.before.md、global-rules.diff 保存全局规则修改前原文和真实差异；全局文件当前SHA256：dddf53946867ecd1da1607b75a750461780ff83c27e1d7d21c94914059dbe3c9。
- 最新截图：D:/github/youtube-language-helper/artifacts/verification_latest.png；同名 JSON 保存证据来源与构建标识。对应规范命名原图：上述最终目录的 shadowing-youtube-simulated-test-browser.png；B站原图为 shadowing-bilibili-simulated-test-browser.png。截图430×900，逐句模式黄色条、文字按钮和原有麦克风均可见。
- 钩子预期阻断日志：artifacts/doctor/2026-09-03T22-23-31-280Z/doctor.log。首次失败日志：artifacts/doctor/2026-09-03T22-23-32-342Z/doctor.log；没有把该失败轮次当作验收通过。

## 3. 卡在哪里

- 本次交付门禁全部通过；日常 Chrome 未重载，不声明用户当前安装环境已更新。生产网站字幕网络及真实录音仍是单独的验收层级。
- 原有工作树包含多项未提交及未跟踪文件。钩子会拒绝提交旧索引；需要审阅并显式暂存本来就应该提交的文件，doctor 不替人选择或吞掉其他改动。
- 浏览器存在9条预加载警告，本次不扩大为无关加载优化。当前截图只确认430px侧栏，不沿用历史360px测试作本次证据。

## 4. 下一步计划

1. 恢复/退化先只读核对Git历史，再运行可能写回的 npm run doctor；普通自检直接doctor。查看当轮原始日志和最新证据JSON，不沿用旧成功截图。
2. 获得提交指令后，审阅本次及前序文件边界，显式暂存相关文件；由已安装钩子再次检验暂存区与工作树一致性。
3. 如需生产网络或用户安装环境验证，单独记录其环境、当前运行脚本哈希、视频来源与采集时间；不将本次模拟数据扩展测试冒充该级证据。

## 5. 碰到哪些问题

- 首次独立浏览器等待后台失败。只读对照历史成功脚本并做独立启动对照后，确认当前 Chrome 的 --disable-extensions-except 参数阻止了 CDP 加载扩展的后台。移除该旧白名单参数，保留全新隔离配置、--load-extension 和官方 Extensions.loadUnpacked 确认后通过。
- Windows 通过 shell 调用 npm.cmd 会产生 Node DEP0190 警告；doctor 已改为直接用 Node 执行 npm-cli.js，避免 shell 参数解释。
- 用户要求自愈不能等于无条件覆盖：脚本先解析并计划所有修改，再局部备份写回；未知结构、重复按钮及语法错误都会非零退出。
- 本轮一次只读PowerShell摘录把数字写成 seventy，命令退出1、未修改文件；更正为数值范围后成功。与构建/E2E退出0分开记录。
- 官方AGENTS.md文档确认全局读取的是Codex home下的AGENTS.md/AGENTS.override.md，而非任意.codex_rules；截图必须配合行为断言，不能单凭静态图证明暂停发生。生产占位禁令不应误杀隔离的正规测试夹具。

## 6. 如何避免再次出现

- 维护单一 toggleShadowing/playMode 和原有播放控制器；保护独立文字按钮与麦克风，禁止用 alert 或另一套状态机冒充接线。
- 所有修复包含反例、幂等断言与运行态检查。钩子发现自愈改动后必须拒绝提交旧暂存内容，绝不自动 git add。
- 新验收开始先归档旧截图，只在实际扩展测试通过后刷新 latest。产物哈希、执行脚本哈希和实际媒体暂停断言与截图同轮保存。
- 本轮未修改 CSS、音高曲线、麦克风组件或字幕管道；不要把相对HEAD的历史未提交修改误算成本轮变更。
- 根目录AGENTS.md和.cursorrules已对齐“Git历史先于恢复写入”，避免本地旧规则遮蔽新的全局协议。全局规则是持久用户指导，不是不可覆盖的系统规则或常驻执行服务。官方依据：https://learn.chatgpt.com/docs/agent-configuration/agents-md。

---

# 历史交接（截至2026-09-04 05:59；已被上方当前构建记录取代）

更新时间：2026-09-04 05:59 +08:00。HEAD dea66688eb14b58e4ba5d900f3109c4c80e7d0ce。保留原有工作树；本轮未打包、未提交、未推送。

## 1. 我们在做什么

按两张参考截图定点恢复底栏“逐句跟读”文字按钮和语言选择器下方黄色模式提示；不修改音高曲线、右侧麦克风、播放控制器、快捷键或其他既有功能。

## 2. 完成了什么

- 唯一生产文件 entrypoints/sidepanel/main.tsx：在“下一句”和“重播当前句”之间补回橙色圆角边框按钮，复用 toggleShadowing() 和已有 E 键入口。aria-pressed 与 playMode 同步，未新增键盘监听或模式状态。
- 黄色提示条使用已有 echo-toast 样式；临时提示为空时根据 playMode 显示模式，重播/暂停清空提示不会再让状态条消失。现有错误/操作消息仍优先显示。两处跟读提示统一为“逐句跟读已开启 (E)”。
- 使用前端调试与 React 规范：局部源码渲染验收、由已有状态派生提示、不添加监听器和第三方依赖。按钮样式限定在新 JSX 上，所有 CSS 文件未变。
- 2026-09-04 05:58—05:59 +08:00，Windows / Node v26.3.0：108/108 源码单元与直接 tsc --noEmit 退出0；14项独立 Chrome 源码测试页检查通过，应用错误/警告0。检查了按钮顺序/样式、初始与切换提示、点击/E、当前源码控制器句尾暂停、同句重播、连续播放、麦克风 DOM 不变、430px/360px底栏不重叠。
- 证据等级：Vite按需源码预览 + Playwright独立无头Chrome；媒体时钟、字幕、扩展消息均为模拟，不是已安装扩展或真实视频/API。Browser plugin不在当前技能列表，使用既有bundled Playwright，未安装依赖。没有生成扩展包。
- 对编辑前313文件快照核对，只有 main.tsx 变化；其余312文件内容及时间戳不变，包含 Recharts/音高组件、所有CSS、Mic资源、控制器、两平台入口、快捷键、依赖配置、.output/.wxt。main.tsx SHA256：88045e6e074be479252bc5debd88d31a28c97fe1a00240e759adcf8096f9b343。

证据目录：C:/Users/alxanday/AppData/Local/Temp/ylh-shadowing-button-20260904/。bottom-bar.patch 为本轮起点到补丁的独立Diff；verification-card.json、unit.log、typecheck.log、report.json、dom.txt、scope-proof.json、before.json、main.before.tsx 保留可重复验证。截图 shadowing-button-{430,360}-simulated-test-browser.png 与脚本 qa.mjs、finish.mjs 均在仓库外。

## 3. 卡在哪里

- 按要求未打包，已安装扩展未重载，旧 .output 不包含本次按钮或上一轮50ms拦截补丁。不能用源码测试页冒充真机扩展成功。
- 本轮只验收430/360px侧栏，未宣称所有更窄宽度均通过。真实网络字幕错误与音高/麦克风运行态不属于本轮验证。

## 4. 下一步计划

1. 审阅 bottom-bar.patch，避免把相对HEAD的前序未提交改动误认为本轮改动。
2. 若未来获得打包授权，再更新扩展并核对源码/运行脚本身份。
3. 在真实视频中复核按钮/E切换与句尾等待；当前不扩大功能或改写播放控制器。

## 5. 碰到哪些问题

- 缺失的是独立文字入口；E和麦克风原有切换函数仍在。只恢复入口，不复制另一套暂停状态机。
- 临时预览首次未归一化Windows换行、未提供WXT的browser别名，造成夹具启动错误；只修正仓库外夹具。第二次交互全通过但测试页favicon返回404，补测试页内联favicon后14项全部通过；首次404报告单独保留。

## 6. 如何避免再次出现

- 专属文字按钮与麦克风各自保留；用按钮相邻关系和麦克风DOM断言保护位置与原有控件。
- 模式状态提示从playMode派生，临时提示被清空不应删除核心模式可见性。
- 局部UI还原只改目标JSX，构建禁令期间通过仓库外源码预览检查，不改生产构建或依赖配置。

---

# 历史交接（截至2026-09-04 05:48）

更新时间：2026-09-04 05:48 +08:00。仓库 D:/github/youtube-language-helper；HEAD dea66688eb14b58e4ba5d900f3109c4c80e7d0ce。保留全部原有未提交工作；本轮未提交、未推送、未打包。

## 1. 我们在做什么

按最新“定点单函数补丁”要求，只在 lib/playback-machine.ts 的 enforceBoundary() 中补充跟读句尾拦截。沿用现有 TypeScript 播放控制器、timeupdate 与 12ms 轮询，不修改 UI、CSS、字幕数据或其他函数。

## 2. 完成了什么

- 只读审计确认暂停主体仍存在；模板的 endTime 对应当前控制器的 segment.endMs（毫秒），控制器没有字幕 text 字段。
- 时间更新/轮询的 shadowing 分支按句尾前 50ms 判断；在 pause() 前写入已有 waiting 状态防重复进入，同句重播沿用原有状态复位，不给原始字幕添加 _hasPaused。
- 暂停后输出 [SHADOWING_PAUSE_SUCCESS]，记录真实 start/time/end（秒）。不虚构 text；保留原有边界校准、平台暂停钩子和 onBrake 报告。
- auto/manual、arm 入口的原有平台提前量、Space/练习/录音、两平台适配均未修改。arm 保留原阈值，避免其已有提前 return 分支失去播放/轮询。
- 2026-09-04 05:47 +08:00，Windows / Node v26.3.0，源码单元 108/108、额外定向断言 5/5、直接 tsc --noEmit 均退出 0。模拟媒体事件覆盖 30/250ms 配置下的 50ms 跟读拦截、重复事件、同步重入、同句重播、auto/manual 不变及 arm 原行为。无真实网络/API、无浏览器或已安装扩展验收。
- 与本轮编辑前快照对比：仅 enforceBoundary() 内有生产代码变化；另外 312 个受保护文件的内容哈希和修改时间完全不变，包括 UI/CSS、入口、测试、依赖配置、.output 与 .wxt。没有运行 build、zip、wxt prepare 或隐含构建的 verify:bilibili-ocr。
- 当前控制器 SHA256：0cc373c0dc11245076c33f1121647d8630fd890877737ee37ec9666dc97dfcd3；编辑前：808a3780ef3ad2d4345c0aae0d6b8941c9f8226e065688a6a226dea8141583c1。源码位置：lib/playback-machine.ts:334（函数）、340（拦截）、378（日志）。

证据目录：C:/Users/alxanday/AppData/Local/Temp/ylh-shadowing-guard-5aa1a68d09a8469a88e172c047714afc/。verification-card.json、guard.log、unit.log、typecheck.log 记录本轮源码验证；scope-proof.json、before.json、playback-machine.before.ts、single-function.patch 证明范围。可重复运行 verify.mjs 和 scope.mjs verify；测试脚本位于仓库外，未更改现有测试文件。

## 3. 卡在哪里

- 按用户禁令未打包；当前 .output 仍是下方 05:32 记录中的历史构建，不包含本次单函数补丁。源码单元通过不能当作当前浏览器已生效或物理暂停精度实测。
- 工作树已有大量前序变更，均保留；本轮不处理字幕网络错误或任何 UI 问题。

## 4. 下一步计划

1. 后续先查看本轮 single-function.patch 与源码验证记录，避免与相对 HEAD 的前序整轮改动混淆。
2. 只有收到新的打包授权后才生成包含本补丁的扩展，再核对运行脚本身份和实际媒体暂停位置。
3. 若仍有跟读异常，先采集 mode/phase、segment、ylhBrake 与成功日志，再定位实际调用路径；不扩大到布局或字幕时间重写。

## 5. 碰到哪些问题

- 用户模板的字段名、秒单位和文本不适用于现有边界控制器；已在单函数内适配，没有修改协议或字幕对象。
- 暂停可能触发重入事件；先设置 waiting 防抖，重复时间更新不会再次暂停或重复日志，新一轮重播仍可暂停。
- 现有综合验证脚本隐含打包，本轮刻意仅执行源码测试和无输出类型检查。

## 6. 如何避免再次出现

- 保持单一播放状态机，复用 waiting 而不是给字幕添加跨重播残留标记。
- 小补丁也保留可重复断言与编辑前快照；明确区分源码验证、构建模拟和用户安装环境。
- 未经授权不打包，不把旧构建或历史浏览器截图用作本轮证据。

---

# 历史交接（截至2026-09-04 05:32；以下构建不包含本次单函数补丁）

# Video Language Helper 交接记录

更新时间：2026-09-04 05:32 +08:00。仓库 D:/github/youtube-language-helper；分支 codex/initial-design；HEAD dea66688eb14b58e4ba5d900f3109c4c80e7d0ce。含此前工作的未提交工作树；本轮未提交、未推送。

## 1. 我们在做什么

本次仅修复逐句跟读的播放拦截，沿用 WXT / React / TypeScript 和共享 PrecisePlaybackController。用户最新明确要求句尾暂停后可以用空格重播；因此当前句处于 shadowing 时，Space 保留范围并重播，取代此前“Space 一律退出到 auto”的旧要求。E 仍切换跟读模式，S 与专用播放按钮仍可重播；auto/manual 的空格行为不变。

## 2. 完成了什么

- 先只读追踪 timeupdate、两平台消息桥与侧栏快捷键。实际不是监听器被删除：toggle() 暂停时 invalidate() 丢失 segment，恢复时进入 auto；waiting 状态遇到原生 play 也没有重新进入 playing，因此绕过边界。
- 唯一生产源码改动 lib/playback-machine.ts：toggle() 对活动 shadowing 调用已有 togglePractice()；startBrakePoller() 对原生恢复的 shadowing/waiting 重新启用原有 enforceBoundary()。保留原有 state.mode/segment.startMs/endMs，无重复开关或时间变量。
- 跟读句中空格暂停/原位继续，句尾空格从同句起点重播；原生播放不再越过句尾；原生回拖后播放也重新拦截。保留 seeked 校验、12ms 轮询、YouTube 250ms/B站30ms提前刹车、边界校准与录音暂停逻辑。
- 新回归先出现两个预期失败（旧代码丢失范围、原生播放逃逸），修复后通过。测试文件：tests/playback-machine.test.ts、tests/integration/bridge.test.mjs、tests/integration/bilibili.test.mjs。同本轮开始快照相比，components/entrypoints/lib/public 中另外84个文件哈希完全不变：包括 Flex、SVG、Recharts、音高算法、B站/YouTube适配、快捷键、存储。
- Windows / Node v26.3.0；2026-09-04 05:28—05:31 +08:00：npm run verify:bilibili-ocr 退出0，类型检查、108/108单元、79/79生产包模拟集成通过。数据为测试夹具，无真实API。
- Chrome/152.0.7977.65 独立浏览器，真实加载新扩展，1200×950媒体页/360×850侧栏，22项通过，应用错误0项。YouTube与B站页面/API/正弦波媒体为模拟，实际运行HTML媒体、可信Space、扩展消息桥和侧栏DOM；不是用户安装环境。16条运行脚本记录（10个不同文件）与磁盘SHA256一致。已有preload/cross-world警告9条单列保留。
- 当前构建58文件、1199540字节，集合SHA256 e7f463c65207785703c568a5a825b5c9b61464aed267f7ce9bbd1633ffc69a75；控制器SHA256 808a3780ef3ad2d4345c0aae0d6b8941c9f8226e065688a6a226dea8141583c1。集合算法：相对路径en排序，path + 空格 + 文件SHA256，LF连接且无末尾换行后散列。

证据目录：C:/Users/alxanday/AppData/Local/Temp/ylh-sentence-loop-20260904/。包括 unit-before.log、verification.log、verification-card.json、protected-before.json、playback-machine.before.ts、verify.mjs、report.json、report-first-run.json、browser.log 与 sentence-loop-{bilibili,youtube}-simulated-test-browser.png。先前 artifacts/delivery/ 中完整源码包是05:20历史快照，不含本次控制器补丁；当前应以工作树和新构建为准。

## 3. 卡在哪里

- 日常Chrome的已安装扩展尚未重载，不能报告 installed-real 通过。本次无真实麦克风或生产字幕API测试。
- 旧任务的YouTube匿名字幕空响应/B站412与本次控制器修复分开记录，未声称解决。
- 保留全部原有未提交工作，仓库不是clean。

## 4. 下一步计划

1. 日常Chrome重新加载当前开发扩展后，在已有视频中确认逐句模式的空格行为；此为用户安装环境剩余验收。
2. 若出现平台特有越界，先采集当前构建与ylhBrake诊断、句子范围、media事件，不修改UI或原始字幕时间。
3. 若后续要求提交/重新打包完整源码，按本次一个生产文件加三个测试文件及交接记录审查范围，保留此前工作并更新历史交付包标识。

## 5. 碰到哪些问题

- 旧Space“自动播放”合同与最新“跟读同句重播”要求冲突；本次仅对活动shadowing采用最新合同，并同步两平台回归断言。
- 首次浏览器运行的20项交互都通过，但末尾采集运行脚本时B站页面已导航离开，缺失B站脚本身份，故整次报告标记失败。改为每个平台导航前采集后重跑通过；没有为此改生产代码。首轮失败报告保留。
- Chrome已有资源预加载警告仍存在，不把无应用错误写成控制台全零。

## 6. 如何避免再次出现

- 学习模式暂停不能无条件invalidate；模式、当前句和等待阶段必须一起保留。原生播放和快捷键都要回归，不只测专用按钮。
- 保护原有字幕/平台适配/算法，先对本轮起点快照核验，不能用相对Git HEAD的整轮差异误判本轮范围。
- 验收同时覆盖句中暂停、句尾重播、原生恢复、原生回拖、退出模式与旧owner/seek取消；区分模拟数据浏览器实测和用户安装环境。

---

# 历史交接（截至2026-09-04 05:20；下文Space合同与构建标识已被上文取代）

# Video Language Helper 交接记录

更新时间：2026-09-04 05:20 +08:00。仓库 D:/github/youtube-language-helper；分支 codex/initial-design；HEAD dea66688eb14b58e4ba5d900f3109c4c80e7d0ce。当前是含已有图标/Space 工作的未提交工作树，未提交、未推送。

状态：[IMPLEMENTED / TEST-BROWSER VERIFIED / INSTALLED-REAL NOT RELOADED]。

## 1. 我们在做什么

按用户“全面沿用 Enjoy Echo 方法”实现跟读、听写、录音及音高，并按最新截图反馈修复图标重叠与曲线还原。项目保持 WXT / React / TypeScript 架构。Enjoy Echo 0.7.5 的本机压缩发行包只读分析；实际音高路线是 Pitchfinder YIN + Recharts monotone Area，非用户模板描述的 Canvas 贝塞尔。

最新保护区：B站播放器监听/选择器、句尾控制器、既有快捷键及存储逻辑冻结，以本次用户最后提出保护区时的工作树为快照；不得以替换 UI 为由覆盖这些模块。本次最后交付阶段只整理代码与文档。此前整轮已有控制器改动，不把“最后阶段零改动”误写为相对 Git HEAD 从未改动。

## 2. 完成了什么

- 跟读句尾停住、按钮同片段重播；听写 H、录音 R、音高 P、本地回放 G、取消 Esc 和原有快捷键继续工作。Space 按此前明确规则暂停/恢复 auto；专用播放按钮走 practice-toggle，保留练习范围。04:55 的并行 Space 冲突已通过分离入口解决。
- Recorder MP3 16kHz/16kbps、独立麦克风授权页、真实音量/计时、2分钟上限；Dexie 保存录音与听写历史，按视频/轨道/文本/范围隔离。切句、导航、关闭时取消资源，不回写过期播放位置。
- 原声沿用 video.captureStream + MediaRecorder，播放采集后恢复；YIN 2048/512，RMS .01、50—500Hz 有效频段。原声音域归一化，录音复用此范围，100点、High/Mid/Low、振幅虚线和播放阴影；无声断开。恒定单音采用中线而不生成 NaN。
- 按用户最新反馈移除“录/写”单字图标；26 个官方 Lucide 0.479.0 SVG 资源仅 8,558 字节，保留许可、不安装整套图标包。底栏由残留九列 Grid 改为 Flexbox；练习卡改为原版方形浅色、紧凑100px曲线与折叠历史。
- 2026-09-04 05:14—05:18 +08，Windows / Node26.3.0 / Chrome152.0.7977.65 / Playwright1.62.1：类型检查、107 单元、79 生产包仿真集成通过。42 项独立真实扩展 + 模拟音频/API 浏览器检查通过，包括280/320/360/550px及550px的150%缩放按钮边界、权限页、MP3解码、持久化、取消和YouTube/B站入口；9个执行脚本SHA-256与磁盘相同。
- 额外真实视频 BbJrFr2KJAA 的23—25秒原声采集通过，生成真实语音曲线。字幕来自用户当前页面导出的字幕并离线回放，时间为整秒；不冒充真实字幕接口通过。
- 生产包：58文件、1,199,026内容字节（1.20MB），集合SHA-256 2a612c1856fe67074d549c95e1c1d322c56bea995d5f143593b3f82808d28522。算法：规范化相对路径按en排序，各行 path + 空格 + 文件SHA256，LF连接且无末尾换行后散列。包括许可。Git diff --check通过，仅有Git换行提示。

证据：C:/Users/alxanday/AppData/Local/Temp/ylh-practice-qa-20260904/ 下 verification.log、verification-card.json、report.json、real-audio-report.json、live-report.json、verify.mjs、real-audio.mjs、截图及 protected-current-snapshot.json。源代码/构建身份来自未提交工作树。设计比较见根目录 design-qa.md；旧报告已明确隔离为历史。

## 3. 卡在哪里

- 日常 Chrome 新构建未重载，个人真实麦克风未测。CUA拒绝认领 chrome://extensions/，未绕过；独立实例不等于 installed-real。
- 匿名测试浏览器对实际YouTube字幕API返回空内容，故额外音频验证采用当前浏览器导出的真实字幕回放；生产B站412仍是先前独立问题。两者均不因本轮UI/音高成功而消失。
- 工作树原有图标与Space改动仍保留，不能声称Git clean。没有提交或推送授权。

## 4. 下一步计划

1. 日常Chrome对当前已安装的开发扩展点一次重新加载，核对本机源码/构建身份与新的麦克风、听写入口。
2. 在用户已有视频/字幕环境复核真实个人麦克风授权、录音回放及切句，不用测试浏览器的假麦克风证据替代。
3. 若用户之后要求提交，按任务文件/补丁确认暂存范围，保留旧工作；字幕API空响应和B站412单列排查。

## 5. 碰到哪些问题

- 用户反馈揭示此前“页面无横向溢出”的验收不充分：九列旧网格残留，文字图标与倍速重叠；现改成真实SVG资源+Flex并检查按钮两两边界。
- 首版采用固定Hz轴、默认隐藏幅度与额外说明，偏离原版；已按实际bundle中pitch-service/use-pitch-contour/pitch-contour-section/PitchContourChart逐段核对并修正。先前模拟正弦波截图只证明算法/链路，不能证明语音曲线观感。
- 真实YouTube测试首次原生字幕空响应；离线回放导出字幕后又遇到播放器初始化期间过早seek。最终夹具先确认video.readyState>=2和有效duration再操作，真实音频采集成功；未为测试成功更改生产播放器。
- 应用JS异常0；Chrome/WXT preload与cross-world警告如实保留，不能写成控制台全零。官方样例音频错误路径404未用于最终验证，最终只用目标视频。

## 6. 如何避免再次出现

- 以真实参考代码与同状态截图核验，明确虚线振幅、实线音高；不得再凭印象把图表改为另一种算法。
- 视觉验收要检查每个常驻按钮的矩形、图标资源、缩放和窄宽度；不能只看scrollWidth。包体积优化不能用汉字冒充功能图标。
- 原始字幕时间、B站监听器、逐句控制、快捷键/存储为保护区；UI组件通过PracticeSegment/currentTimeMs/request回调接入，不复制另一套播放器状态机。
- Space与跟读专用按钮的语义分别测试；捕获音频必须绑定视频会话、可取消并丢弃过期结果。
- 继续区分静态/单元/生产包模拟/真实数据回放/独立测试浏览器/日常安装实测。不得将旧构建hash或旧截图冒充当前。

---

# 历史交接（截至2026-09-04 04:55；其中“当前/阻塞”均为当时状态）


更新时间：2026-09-04 04:55 +08:00

仓库：`D:\github\youtube-language-helper`

分支：`codex/initial-design`

当前 HEAD：`dea66688eb14b58e4ba5d900f3109c4c80e7d0ce`（此前 B站网络/快捷键修复提交）。本轮 Space 行为修复尚未提交、未推送；先前图标依赖瘦身仍保留在工作区。当前验证针对混合工作树，不能冒充只含 HEAD 的干净构建。

任务状态：`[BLOCKED BY CONCURRENT PLAYBACK EDIT / CURRENT SPACE REGRESSION FAILED]` 本轮 Space 修复的 04:50 构建曾通过 101 单元、76 集成和 23 项临时浏览器检查；**04:53:42 同一个播放控制器又出现非本轮执行的录音/跟读改动**，新增 shadowing 恢复分支与“恢复即 auto”冲突。04:54 后重新对当前源码运行 Space 定向测试，2/3 通过、1/3 失败：实际 shadowing，预期 auto。因此撤回“当前工作树已完成 Space 修复”的结论，保留此前构建证据但不升级为当前通过。不覆盖并行代码、不提交，等待协调。此前真实 B站 HTTP 412 仍未解决；日常 Chrome 未重载。

## 1. 我们在做什么

项目是 WXT 0.21.4 + TypeScript + React 19 的 Chrome MV3 YouTube/B站字幕学习侧栏。本轮按用户明确补充的规则统一 Space：播放时暂停；暂停时恢复并进入自动模式；移除 K，而不是恢复之前的跟读模式。先完成只读调用链审计，再按用户确认修复；不新增依赖，不恢复 OCR，不改字幕获取或原始时间轴。

截至 04:52 已验收快照，YouTube 继续使用原有 timedtext 获取。此次仅给 YouTube content script 增加受会话/焦点保护的 Space 播放入口，复用共享播放控制器；B站保留原有侧栏消息桥。该快照的 `lib/youtube-native.ts`、两个 MAIN scripts、后台下载、B站选轨与 manifest 无 diff；YouTube 250ms / B站 30ms 句尾刹车不变。不能声称此次 YouTube content bundle 哈希未变，也不能将该范围核验用于 04:53 后的并行修改。

此前的整套原生迁移方向已被最新“定点裁剪”指令取代。TypeScript/WXT/React 不是所有浏览器扩展的必需品，但属于当前 TSX 工程的开发工具链；不能把它们称作缓存直接删除，也不能把 node_modules 大小当成实际浏览器加载包大小。

## 2. 完成了什么

### 已验证构建卡片：Space 暂停/自动播放（2026-09-04 04:50—04:52 +08:00；不是并行改动后的工作树）

| 项目 | 当前结果、来源与范围 |
| --- | --- |
| 核心代码 | `lib/playback-machine.ts:249` 以真实 `video.paused` 决策；暂停取消旧句界/跟读任务，恢复先进入 auto 再 play，不跳句首。`entrypoints/sidepanel/main.tsx:285` 始终发送一个 toggle，图标跟随 playing，不再因字幕空档转成 seek。 |
| 空格与焦点 | `lib/shortcuts.ts:13` 移除 KeyK，只捕获 Space 重复事件以阻止浏览器原生按钮再次激活；三处监听器不重复执行播放命令。`entrypoints/sidepanel/main.tsx:332`、`entrypoints/bilibili.content.ts:236`、`entrypoints/youtube.content.ts:428`；编辑框/对话框保留原键盘操作。未屏蔽视频网站自身的 K 功能。 |
| 单元与构建包回归 | 2026-09-04 04:50:13—04:50:57 +08:00，Windows / Node 26.3.0，`npm run verify:bilibili-ocr` **退出码 0**：typecheck、101/101 单元、build、76/76 集成。数据是模拟，不访问生产 API。新增 auto/manual/shadowing 三态切换、恢复不定位、重复 Space、两平台页面/消息桥断言；原字幕与刹车回归继续通过。 |
| 临时浏览器运行态 | 2026-09-04 04:52:02—04:52:11 +08:00，Chrome 152.0.7977.65 / Playwright 1.62.1 / 360×854 侧栏，官方 CDP 加载真实 `.output/chrome-mv3` 扩展，**23 项通过**。页面、字幕 API 和 60 秒静音媒体均为明确模拟夹具；使用真实 HTML 媒体、可信 CDP 按键、真实 runtime/Port，没有伪造 chrome API 或注入侧栏 State。不是 live / installed-real。 |
| 实际交互 | 两平台均验证字幕空档 Space 不跳句首；manual/shadowing 正在播放时图标显示暂停；页面 Space 暂停，K 无扩展动作，再按 Space 自动播放并越过旧句尾；聚焦下一句按钮、长按 Space 只暂停一次；鼠标按钮来回切换；输入框输入空格；对话框空格正常关闭且不控制视频；文案仅 Space。 |
| DOM / 控制台 | URL/标题由协议读取；3 条模拟字幕可见，无空白/错误覆盖层/横向溢出；JS 异常为 0。Chrome 的既有共享 settings-view modulepreload warning 出现 2 次，单独保存在 console 数组；不把它隐藏为 console 全零，运行源码哈希另证该模块已执行。 |
| 运行身份 | 扩展 ID `fkmlglnhecdppjdpanlngheoaaagfden`；Debugger.getScriptSource 共采集 9 条记录、对应后台、两个平台 content/MAIN、侧栏、共享 UI 的 **7 个不同脚本**，与磁盘 SHA-256 全部一致。侧栏 `85fc09165cef3ad780f2b177470ac9370a2724557120b27306d344d244229aa7`。 |
| 构建标识 | 18 文件、483,735 内容字节（不是物理占盘）；按路径排序的 `{path,bytes,sha256}` 清单 JSON 的 SHA-256 为 `4f48f0079df721aca416474a0bb29e08e30b6cbd37b88bdd906d9ed690f9838a`。含先前未提交图标瘦身。 |

仓库外证据目录：`C:\Users\alxanday\AppData\Local\Temp\ylh-space-qa-3e8a574082694645801cbc32196f1021`。

- `verification-card.json`、`verify-bilibili-ocr.log`：真实命令、退出码、构建清单和工作树说明。
- `test-browser-simulated-space-report.json`：23 项运行态检查、7 个哈希、真实媒体事件、控制台与模拟请求来源。
- `test-browser-simulated-bilibili-space.png` / `test-browser-simulated-youtube-space.png` 和同名前缀 `-dom.txt`：真实临时扩展 UI、模拟字幕，文件名明确分级。
- 重跑：该目录 `run-checks.mjs` → `verify-space.mjs`；使用本机既有 Node / Playwright / Chrome，不安装任何依赖。浏览器脚本引用上次 `test-results/bilibili-cdp-20260904/scripts/cdp.mjs` 的连接助手。Browser plugin not available，按前端调试技能使用已有 Playwright。临时实例已关闭，日常 Chrome 未操作。

### 历史闭环验证卡片（2026-09-04 04:19—04:29 +08:00，非当前 Space 构建）

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

- 最新阻塞是同 checkout 的并行写入：`lib/playback-machine.ts` 新增 `captureVideoAudio`、capture/pause API，移除原等长等待并增加 `shadowing` 专用 toggle 分支；同时出现非本轮创建的 `lib/capture-audio.ts`、`lib/pitch.ts`、`lib/practice-store.ts`、`lib/practice.ts`。新 toggle 暂停后仍恢复 shadowing，与用户此次明确要求冲突，不能直接覆盖它们。
- 当前源码的 `Space pauses shadowing playback once, then resumes in auto without seeking` 断言失败（`tests/playback-machine.test.ts:150`：actual `shadowing`, expected `auto`）；auto/manual 两个同组断言仍通过。04:50 全套和 04:52 浏览器通过记录只证明并行改动之前的构建。先协调写入和两项需求，再合并、重跑；不将旧截图或哈希冒充新工作树。
- 用户日常 Chrome 未重载，因此不能宣称 installed-real 已应用。此次没有收到新的提交/推送指令，Space、并行跟读和原有图标改动都未提交。
- 当前真正未通过的是**生产 B站字幕端到端门禁**：全新匿名测试配置下，网页选轨及后台元数据接口返回 412；后台实发 Referer 正确也未改变结果。412 的具体触发条件尚未确证，不能仅凭状态码断言是登录问题或 CORS。
- 用户日常 Chrome 未操作；本轮按最新指令改用独立临时 Chrome。此前 GUI 无法可靠识别 URL 的限制没有被规避，本轮改用用户明确授权的可观测测试实例。
- 图标依赖瘦身仍为原有未提交工作，不能声称整个工作区 clean。该阶段 28.26% 减重而非腰斩的历史结论不变；本轮未重测空间。

## 4. 下一步计划

1. 先协调并行跟读/录音改动的写入，确认以本轮“Space 恢复即自动播放”为准合并，避免双方继续覆盖同一个控制器；保留新录音代码，不自行回退。
2. 合并后重跑 Space 定向断言、完整门禁及两个平台临时扩展按键流程，重新采集运行哈希；只有新构建通过才能更新日常安装态和交接结论。
3. 如随后要求提交，按明确文件/补丁区分 Space、录音/跟读和旧图标瘦身，不自动推送。B站真实 412 仍单独排查，不能用模拟成功覆盖该阻塞。

## 5. 碰到哪些问题

- 收尾 diff 发现控制器从本轮 16 行差异扩大为约 145 行、mtime 为 04:53:42，并插入与已批准 Space 规则冲突的新分支。立即停止修改生产代码，只读复核与定向断言，明确撤回当前树通过结论；不把来源未确认的并行工作删掉或回退。
- 本轮先将旧行为写成失败断言：manual/shadowing 播放时 Space 不暂停、K 仍绑定、按钮焦点吞空格，共 4 项失败；修复后通过。真实临时浏览器进一步复现长按 Space 的 repeat 漏到原生“下一句”按钮，引起额外 pause/seek；现在重复事件只拦截不执行。
- 本轮验收夹具修正：Playwright launch 连接未枚举浏览器侧栏，改用 CDP 实际 target + 新连接发现；YouTube 假页面须有真实选择器 `#movie_player video.html5-main-video`；对话框有两个“关闭”按钮，选择带 aria-label 的按钮。未为通过测试改写生产 DOM/API，也未将夹具错误当作网站故障。
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

- Space 的固定语义：真实播放中则暂停，真实暂停中则原位自动播放；不要重新把“退出跟读”做成额外按一次才能暂停的分支。按钮与 Space 共用入口，K 不再由扩展绑定。
- React 侧栏保留单个稳定键盘监听和最新回调 ref（按 React 技能核对）；重复键必须同时防重复命令和浏览器默认按钮行为。输入框/对话框保护与长按、聚焦非播放按钮的真实按键测试必须保留。
- Referer 必须区分“配置了规则”和“实际网络头已观测”，真实 HTTP 失败也要记录；API 返回成功后还须核对非空字幕及最终 DOM。真实临时扩展 + 网络夹具属于运行态模拟证据，不等于真实字幕成功。
- GUI 读地址不稳定时使用当前批准的临时 CDP 浏览器，不读取日常用户 profile/Cookie。浏览器 target、execution context 和源代码哈希必须由协议实际返回，不猜测或复用失效标识。
- 对混合工作树按明确文件与补丁暂存，提交前核对 cached diff；已有无关改动不删除、不回退、不顺手提交。测试报告须注明测试的是工作树还是仅提交的干净树。
- B站轨道选择固定遵守三态：verified manual、verified AI、unknown。unknown 永远不冒充人工轨；只有没有可用人工 URL 时才允许 AI fallback。
- 两条核心断言必须长期保留：混合列表不请求 AI URL；AI-only 必须进入 `loaded` 且产生 RawCue。任何 B站字幕路由修改都运行 `npm run verify:bilibili-ocr`。
- 仓库不得重新加入 Python、ONNX、Paddle/PyTorch、Canvas 视频抽帧、Native Messaging 或 OCR 服务，除非先重新评估并取得明确授权。
- YouTube 与 B站字幕入口保持文件级隔离。仅做 B站网络修改时核对 YouTube 无 diff；明确批准共享播放修改时单列 YouTube 的播放差异与新哈希，并保留字幕源码无 diff 和完整回归，不沿用旧“哈希未变”结论。
- 证据继续分级：静态检查、单元测试、生产 bundle 仿真、真实网络回放、test-browser、installed-real。未重载的 Chrome 和普通网页截图不能升级为 installed-real。
- 空间维护先排序再行动；删除仅限已解析且验证位于项目内的指定路径。通过 manifest/lockfile 移除依赖后执行 npm prune，不手工裁掉已安装库的内部文件，不迁移目录或用压缩伪造省下的空间。保留必要开发链与 Git 恢复记录，截图保存在仓库外。
- 以后只为已批准且不能合理用原生能力解决的需求增加依赖；内联图标保持 5 SVG 预算并保留许可。网络与状态工具不重复造依赖；依赖修改必须运行完整门禁和真实 du 复测。
