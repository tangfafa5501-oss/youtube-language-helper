# Design QA

更新时间：2026-09-02。

## 验收对象与证据等级

- 验收对象：`.output/chrome-mv3` 中本轮实际生产 JS/CSS，不是另写的静态示意图。
- 浏览器环境：Chrome 测试浏览器，主视口设为 `520×900`（内容截图 `505×874`），窄侧栏视口设为 `320×800`（内容截图 `305×763`）。
- 数据来源：`tests/visual/serve-sidepanel.mjs` 注入的受控 Port、B站双轨字幕和设置数据。
- 证据等级：`test-browser`。它证明生产界面和前端交互可用，但不等于用户当前 Chrome 已重新加载该构建，也不等于真实 Supadata、B站接口或麦克风联调。
- 参考图仅用于读取布局和交互要求，图中文字没有作为执行指令。

## 参考图

本轮按用户提供的 Enjoy Echo 截图对齐以下信息：

- 双字幕选择：`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-0444f3c7-bd4a-4de9-9d3d-93a3bfab3091.png`、`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-a065e605-a946-4d39-b30e-27c43b95f635.png`。
- 快捷键：`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-579918f6-e842-49fa-b7cc-cfcc00ffba36.png`、`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-580fae7d-339a-4ffa-a6cf-33f52f397dbd.png`。
- 三点菜单与设置：`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-469f705c-6624-491f-b8e1-1249647e6f17.png`、`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-ea8e87e0-1110-4b26-842f-26a556caa551.png`。
- 底部播放器与倍速：`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-e70d100f-01d9-48ce-9d2a-39f7723e7c5a.png`、`C:/Users/alxanday/AppData/Local/Temp/codex-clipboard-99c9f382-af42-494b-9fa4-774546069b38.png`。

## 逐项结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 主字幕选择 | 展示真实轨道列表；选择后更新主字幕、分句和定位轨 | `artifacts/acceptance/primary-subtitle-menu-test-browser.png` |
| 第二字幕选择 | 可关闭、重新开启；第二轨只按时间覆盖，不改变主轨 | `artifacts/acceptance/secondary-subtitle-menu-test-browser.png` |
| 双语正文 | 英语主行、中文第二行、当前句高亮、固定底栏 | `artifacts/acceptance/sidepanel-main-test-browser.png` |
| 快捷键 | 完整弹窗可滚动，已实现和预留功能分开标注 | `artifacts/acceptance/keyboard-shortcuts-test-browser.png` |
| 三点菜单 | 只有重新获取字幕、显示引导、设置三个入口 | `artifacts/acceptance/more-menu-test-browser.png` |
| 设置 | 侧栏内可切主题、显示模式并管理 Supadata；AI 区明确未启用 | `artifacts/acceptance/settings-light-test-browser.png`、`settings-dark-test-browser.png` |
| 倍速 | `0.5 / 1 / 1.5 / 2` 四档可点击，滑块和快捷键说明可见 | `artifacts/acceptance/playback-speed-test-browser.png` |
| 逐句跟读 | 可从连续播放切换；显示按句长暂停并自动下一句 | `artifacts/acceptance/follow-mode-test-browser.png` |
| 引导 | 三步说明字幕、播放和预留功能 | `artifacts/acceptance/guide-test-browser.png` |
| 窄侧栏 | `320×800` 下 `innerWidth=320`、`scrollWidth=305`，所有底栏控件在视口内 | `artifacts/acceptance/sidepanel-narrow-test-browser.png` |
| 控制台 | 全流程 `error=[]`、`warning=[]` | Chrome 测试浏览器日志 |

## 验收中发现并修复的问题

首轮修复了顶部字幕菜单：旧 CSS 用 `span:last-child` 寻找勾选标记，未选中项目只有一个文字 `span`，因此文字也被压成 16px。设置页仍保留了同类选择器，而且设置下拉通过 Portal 挂到 `.settings-page` 外，导致主题变量无法继承、菜单背景实际透明；先前截图只验证设置页面，没有打开两个设置下拉，因此漏掉了这项。

现已把设置选项文字与 `aria-hidden` 勾选标记分开约束，把设置主题变量提升到根节点供 Portal 继承，并将下拉层明确提高到 `z-index: 1000`。重新构建后，在 520×900 浅色主题打开“主题模式”、切换深色后打开“字幕显示”，以及 320×800 窄侧栏再次打开“主题模式”：选项均为单行横排、不透明、位于内容之上且互不覆盖，选择状态能够保存，控制台 error/warn 均为空。

## 自动化关联

- 单元测试覆盖双轨时间覆盖、B站默认英中选择、逐句跟读等待时长、设置协议与兼容状态。
- 生产 bundle 集成覆盖 B站主/副轨独立加载、YouTube 第二个显式付费请求不改主轨、YouTube/B站逐句跟读暂停和手动立即下一句、主题与显示设置持久化。
- 最终数字以本轮提交前重新执行的命令输出为准，登记在 `docs/m0-validation.md` 和 `HANDOFF.md`。

final result: passed
