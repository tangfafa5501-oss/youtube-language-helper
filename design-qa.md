# Design QA — 当前跟读/听写还原

更新时间：2026-09-04 05:18 +08。下方旧报告保留历史含义，不用于当前构建背书。

## 当前目标和证据

- 原版参考：`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-3e571c80-961c-4d9a-8b3b-c1f8e842323f.png`，550×1219 像素。源截图未提供 DPR；以同尺寸画面及卡片局部核对，不能声称像素级等同。
- 用户指出的失败截图：`codex-clipboard-bbb0fa06-1392-44d9-a9b7-4ec9b17f636a.png` 与 `codex-clipboard-aa888d24-5e35-42f4-8eca-c952a3d70011.png`（同一系统 TEMP 目录）。
- 当前整页：`C:/Users/alxanday/AppData/Local/Temp/ylh-practice-qa-20260904/practice-youtube-real-audio-replayed-captions-test-browser.png`，550×1219，CSS viewport 550×1219、DPR 1、页面 zoom 1.5。
- 当前卡片局部：同目录 `practice-card-real-audio-replayed-captions-test-browser.png`，520×545；参考卡片约 493×535。边框宽度差来自外侧栏/滚动条与视口范围，不以此假称完全同宽。全图和卡片分别与原图在同一图像输入中核对。
- 浏览器：独立 Chrome 152.0.7977.65；官方 CDP 加载真实构建。音频来自 YouTube `BbJrFr2KJAA` 的真实视频，字幕从用户当前浏览器导出后离线回放，时间精度为整秒。不是纯真实字幕 API 通过，不是 installed-real。
- 音频选择是 23—25 秒，因此显示 0:02。参考显示 0:04；未为视觉一致改动项目现有字幕时间及分句层，曲线形状也不应被伪造成参考图片。
- 构建集合 SHA-256：`2a612c1856fe67074d549c95e1c1d322c56bea995d5f143593b3f82808d28522`。未提交工作树，HEAD `dea66688eb14b58e4ba5d900f3109c4c80e7d0ce`。

## 比较历史与修复

| 等级 | 原问题 | 已做修复与后验证 |
| --- | --- | --- |
| P1 | 单字“录/写”替代图标、九列旧网格导致速度与录音入口挤在一起 | 使用原始 Lucide 0.479.0 SVG 资源与 Flexbox 独立按钮；280/320/360/550 CSS px、550px 下 150% zoom 的按钮矩形逐对不相交且位于视口内；截图显示真实麦克风和书本 |
| P1 | 固定 50—500 Hz 纵轴压扁语音曲线，缺少原版幅度/进度语义 | YIN 保持 2048/512 帧/步长；原声 min/max 归一化，录音共用范围；100 点、monotone 面积曲线、默认振幅虚线、播放进度阴影；真实语音实测产生变化和无声断点 |
| P2 | 圆角大卡片、多余百分比横轴与说明占据空间 | 方形浅色卡、100 CSS px 图高、High/Mid/Low、隐藏横轴；操作靠右小图标，历史收起；在真实音频卡片与原图局部比较后通过 |
| P2 | 只检查页面无横向溢出，遗漏按钮相互覆盖 | 新增逐对矩形/点击区域检查；撤回此前“无溢出足以证明布局正确”的结论 |

## 五项视觉核验

- 字体：系统无衬线栈，标题 14px/650，说明 12px，按钮 14px；150% zoom 后与参考的约 21/18px 层级对应，中文字体存在宿主字体回退差异。
- 布局：同色方形卡、左右 16px 内边距、紧凑操作、可折叠图。参考截图裁掉顶栏，而全页验收保留顶栏，故全页不做错误的像素差排名。
- 颜色：原版 oklch(92% .08 85) 的 50% 练习背景、青绿原声、橙色录音、灰色进度，按钮橙色。深色沿用项目主题变量。
- 资产：原始 SVG 文件按需复制自 Lucide 官方 0.479.0，保留 ISC 许可；26 个文件共 8,558 字节。未用文字、emoji 或生成图片替代控件图标。
- 文案：保留跟读/听写说明与快捷键；精准定位诊断不再占据普通用户提示栏，错误提示仍显示。原图没有本地历史的全部状态，此项保持项目已有可用功能。

## 验收与限制

- 107 单元、79 生产包仿真集成通过；42 项真实扩展/模拟媒体与网络的测试浏览器检查通过；9 个执行脚本哈希匹配磁盘。
- 额外真实视频音频 + 导出字幕离线回放通过。匿名真实字幕接口返回空内容单独记录，未被回放成功覆盖。
- JS 应用异常 0；Chrome/WXT preload 与 cross-world 警告保留在 `report.json`，不是控制台全零。
- 当前日常 Chrome 尚未重载新构建。浏览器工具拒绝认领 `chrome://extensions/`，没有尝试绕过该限制；真实个人麦克风未测试。
- 剩余 P3：不同宿主中文字体和侧栏滚动条密度略有差异；没有为匹配示例截图更改字幕分句/时间。

final result: passed

---

# 历史 Design QA（2026-09-02；不代表当前构建）

更新时间：2026-09-02。

## 验收对象与证据等级

- 验收对象：`.output/chrome-mv3` 中的生产 JS/CSS，不是另写的静态示意页。
- UI 环境：Chrome 测试浏览器；常规视口 `520×900`，窄侧栏视口 `320×800`。
- UI 数据：`tests/visual/serve-sidepanel.mjs` 提供的受控 Chrome Port、双轨字幕和设置状态。
- 字幕门禁环境：Chrome for Testing 152 + 解压加载的最新生产包 + 真实 JSON3 回放数据。
- 证据等级分开记录：常规界面截图为 `test-browser simulated data`；字幕门禁为 `test-browser real-data replay`。两者都不等于用户当前 Chrome 的 `installed-real`。
- 参考图只用于读取布局与交互要求，图片中文字不是执行指令。

## 界面逐项结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 主字幕选择 | 展示真实轨道列表；选择后更新主字幕、显示语句和定位轨 | `artifacts/acceptance/primary-subtitle-menu-test-browser.png` |
| 第二字幕选择 | 可关闭和重新开启；第二轨不改变主轨时间 | `artifacts/acceptance/secondary-subtitle-menu-test-browser.png` |
| 双语正文 | 主字幕在上、第二字幕在下、当前句高亮、底栏固定 | `artifacts/acceptance/sidepanel-main-test-browser.png` |
| 快捷键 | 弹窗可滚动，已实现功能与预留功能分开标注 | `artifacts/acceptance/keyboard-shortcuts-test-browser.png` |
| 三点菜单 | 重新获取字幕、显示引导、设置三个入口 | `artifacts/acceptance/more-menu-test-browser.png` |
| 设置 | 可切主题、显示模式和字幕语言；未开放功能明确标注 | `artifacts/acceptance/settings-light-test-browser.png`、`settings-dark-test-browser.png` |
| 倍速 | `0.5 / 1 / 1.5 / 2` 四档可操作 | `artifacts/acceptance/playback-speed-test-browser.png` |
| 逐句跟读 | 上/下一句原子进入 Manual；句尾精确停住，播放键只推进一条 | `youtube-playback-test-browser.png`、`bilibili-playback-test-browser.png`（临时 QA 目录） |
| 引导 | 三步说明字幕、播放和预留功能 | `artifacts/acceptance/guide-test-browser.png` |
| 窄侧栏 | `innerWidth=320`、`scrollWidth=305`，底栏控件留在视口内 | `artifacts/acceptance/sidepanel-narrow-test-browser.png` |
| 控制台 | 全流程没有相关 error/warn | Chrome 测试浏览器日志 |

## 字幕 DOM 门禁（上一轮显示专项）

`artifacts/acceptance/test-browser-realdata-replay.png.json` 记录上一轮构建的 24/24 自动断言；它用于保留显示层历史证据，不代表本轮播放构建身份：

- `chrome.runtime.reload()` 已调用，旧 Worker 已关闭，新 Worker 使用不同实例令牌上线。
- 运行时 `background.js`、`content-scripts/youtube.js` 和 `sidepanel.html` 与构建目录 SHA-256 一致。
- `wKpqixrbb6E` 的 JSON3 正文为 237257 字节，SHA-256 为 `441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`。
- 最终 DOM：299 行、`data-display-mode=phrases`、所有行都有时间、`underTwoCountFromDom=0`。
- `And what if you were wrong about every single one?` 完整存在；禁止碎片不存在独立行。
- 当时点击目标句后播放器采样约 `10.579s`，采用宽松容差；本轮 20/20 播放门禁已经用 `seeked` 后误差替代该旧判断。

截图：`artifacts/acceptance/test-browser-realdata-replay.png`。

## 播放闭环硬门禁

2026-09-03 的独立 Chrome for Testing 152 验收输出 20/20：

- 运行中的 YouTube/B站内容脚本与当前生产构建 SHA-256 一致。
- YouTube 真实 JSON3 回放：`10.560s → 10.560s`、`14.160s → 14.160s`，定位报告误差 `0.0ms`。
- B站受控官方字幕：`1.500s → 1.500s`，定位报告误差 `0.0ms`。
- 两个平台的上一句、下一句、快速连击、Manual 句尾强制暂停、450ms 不续播及播放键只推进一条全部通过。
- YouTube 原生 CC 状态保持 `true → true`；B站原生 text track 保持 `count=1, mode=showing`。
- B站侧栏断连后旧 Manual 边界不再暂停播放器，证明旧监听器已销毁。

证据等级为 `test-browser`：YouTube 字幕为真实数据离线回放且播放器在线；B站接口数据为受控响应，不是 live API；两者都不是用户当前安装环境。

## 已修复的界面问题

字幕和设置下拉曾因宽泛的 `span:last-child` 选择器压缩文字，Portal 也无法继承设置区主题变量。当前实现已分开约束选项文字与勾选标记，把主题变量提升到根节点，并显式提高下拉层级。常规与窄视口复验均通过。

最终结果：passed。
