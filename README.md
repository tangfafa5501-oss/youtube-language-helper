# Video Language Helper · M0

独立的 YouTube / Bilibili 字幕学习侧栏。项目使用网站自身可获得的字幕轨，不依赖外部付费字幕服务，也不复制参考扩展的账号、品牌、图标或受保护接口。

## 当前功能

- YouTube：捕获并读取网页原生 `/api/timedtext`，支持 JSON3/XML、人工轨和自动轨；字幕到达后立即推送到已连接侧栏，重连时优先读取会话缓存。
- Bilibili：通过网站 WBI 接口读取官方字幕轨并复用网页登录态。
- 双字幕：主字幕与第二字幕独立选择。第二轨只按时间覆盖显示，不改变主轨的文本、起止时间或点击定位。
- 自然语句：保留原始 cue，不修改网站正文和时间；显示层按句界组合连续语句，短于 2000ms 的行向后合并或延长到 2000ms，不设置固定最长拆分上限。
- 播放：点击定位、上一句、下一句、连续播放、逐句跟读、`0.5 / 1 / 1.5 / 2` 倍速、播放中高亮，以及 `Space / K / Shift+< / Shift+> / E / A / S / D` 快捷键。
- 设置：外观、自然语句/原始字幕和字幕语言；支持跟随系统、浅色和深色主题。
- 预留功能：听写、录音与评分入口会明确显示尚未开放，不申请权限，也不伪装成已实现。

不包含 Netflix、无字幕语音识别、新翻译服务、AI 评分、参考扩展账号同步或商店发布。

## 字幕与时间规则

YouTube 原始层完整保留每个文本事件，包括重复、空白、重叠和时间异常信息；控制事件不伪装成字幕。显示层忽略仅用于布局的换行事件，按开始时间稳定排序并恢复自然句。

句子分组只作用于显示层：

- 句末标点优先决定自然句边界。
- 相邻 cue 之间超过 1500ms 时分开处理，避免跨长静音拼接。
- 小于 2000ms 的显示行优先与下一行合并；无法可靠合并时只延长显示结束时间并标记为估算。
- 不以固定最长时长强拆完整句子。
- 原始 cue 始终可切换查看，播放定位仍可追溯到网站时间。

B站双语组合以主轨为时间基准，第二轨按真实时间覆盖；原始对象保存在 `raw.primary` 和 `raw.secondary`。

## 构建与加载

要求 Node.js 22+。

```powershell
cd D:\github\youtube-language-helper
npm ci
npm run typecheck
npm test
npm run test:integration
```

生产包位于：

```text
D:\github\youtube-language-helper\.output\chrome-mv3
```

重新构建后必须让测试浏览器或已安装扩展真正重新加载。覆盖磁盘文件不会自动替换已运行的 Service Worker 和 content script；验收时应记录旧 Worker 消失、新 Worker 上线，并核对运行时文件 SHA-256。

## 当前验证结果

- 77/77 单元测试通过。
- 61/61 生产 bundle 集成测试通过。
- TypeScript 类型检查和 Chrome MV3 生产构建通过。
- 独立 Chrome for Testing 152 的真实 JSON3 回放通过 24/24 断言，输出 `ALL PASSED (100%)`。
- 生产树 SHA-256：`A89A8ECD6CB49A4D9FC7B8AD81D6E96E82706470FBEF7A59DFFB7F477835D219`。
- `wKpqixrbb6E` 回放最终 DOM 为 299 行，`data-display-mode=phrases`，`underTwoCountFromDom=0`。
- 核心反例完整显示为 `And what if you were wrong about every single one?`；`single one?` 和 `wrong.` 均不存在独立行。
- 证据：[截图](artifacts/acceptance/test-browser-realdata-replay.png)和[断言结果](artifacts/acceptance/test-browser-realdata-replay.png.json)。证据等级为 `test-browser real-data replay`，不是用户当前 Chrome 的 `installed-real`，也不是实时网络字幕验收。

## 主要入口

- `entrypoints/background.ts`：原生 timedtext 观察、会话缓存和设置迁移。
- `entrypoints/youtube-main.content.ts`：YouTube 页面环境、视频与轨道元数据桥接。
- `entrypoints/youtube.content.ts`：字幕接收、主副轨、定位和播放边界。
- `entrypoints/bilibili-main.content.ts`：B站网页登录态、元数据和字幕轨获取。
- `entrypoints/bilibili.content.ts`：B站字幕解析、切轨、定位和播放边界。
- `entrypoints/sidepanel/`：双字幕侧栏、播放、快捷键和设置入口。
- `lib/youtube-native.ts`：原生字幕安全校验、缓存选择和显示语句派生。
- `tests/integration/`：生产构建脚本的受控集成验证。

## 许可与来源

- WXT、React、Radix UI 和 SBD 均按仓库锁定版本使用；第三方许可见 `public/licenses/`。
- 本机 Enjoy Echo 发布包只用于观察交互和公开可见的扩展行为，没有作为本项目源码复制。

继续工作前先读 [HANDOFF.md](HANDOFF.md)、[设计稿](docs/design.md)和[M0 验证记录](docs/m0-validation.md)。
