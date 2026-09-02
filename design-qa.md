# Design QA

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
| 逐句跟读 | 当前句结束后按规则等待，再播放下一句 | `artifacts/acceptance/follow-mode-test-browser.png` |
| 引导 | 三步说明字幕、播放和预留功能 | `artifacts/acceptance/guide-test-browser.png` |
| 窄侧栏 | `innerWidth=320`、`scrollWidth=305`，底栏控件留在视口内 | `artifacts/acceptance/sidepanel-narrow-test-browser.png` |
| 控制台 | 全流程没有相关 error/warn | Chrome 测试浏览器日志 |

## 字幕 DOM 硬门禁

`artifacts/acceptance/test-browser-realdata-replay.png.json` 记录 24/24 自动断言：

- `chrome.runtime.reload()` 已调用，旧 Worker 已关闭，新 Worker 使用不同实例令牌上线。
- 运行时 `background.js`、`content-scripts/youtube.js` 和 `sidepanel.html` 与构建目录 SHA-256 一致。
- `wKpqixrbb6E` 的 JSON3 正文为 237257 字节，SHA-256 为 `441E43D463EBC449BBF4E9BFB70D8F0E19722A034420FAC6455C5DA742896CE0`。
- 最终 DOM：299 行、`data-display-mode=phrases`、所有行都有时间、`underTwoCountFromDom=0`。
- `And what if you were wrong about every single one?` 完整存在；禁止碎片不存在独立行。
- 点击目标句后播放器到达约 `10.579s`；相关控制台错误为空。

截图：`artifacts/acceptance/test-browser-realdata-replay.png`。

## 已修复的界面问题

字幕和设置下拉曾因宽泛的 `span:last-child` 选择器压缩文字，Portal 也无法继承设置区主题变量。当前实现已分开约束选项文字与勾选标记，把主题变量提升到根节点，并显式提高下拉层级。常规与窄视口复验均通过。

最终结果：passed。
