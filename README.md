# Video Language Helper · M0

独立的 YouTube / Bilibili 字幕学习侧栏。项目使用网站自身可获得的字幕轨，不依赖外部付费字幕服务，也不复制参考扩展的账号、品牌、图标或受保护接口。

## 当前功能

- YouTube：捕获并读取网页原生 `/api/timedtext`，支持 JSON3/XML、人工轨和自动轨；字幕到达后立即推送到已连接侧栏，重连时优先读取会话缓存。
- Bilibili：通过网站 WBI 接口读取官方字幕轨并复用网页登录态；有人工轨时只加载人工轨，没有人工轨时自动回退 B站 AI 轨。
- 双字幕：主字幕与第二字幕独立选择。第二轨只按时间覆盖显示，不改变主轨的文本、起止时间或点击定位。
- 自然语句：保留原始 cue，不修改网站正文和时间；显示层只按自然句界和可证明的静音边界组合，不再对低于 2000ms 的完整短句做硬性合并或延时。
- 播放：提供明确的 Auto（连续播放）/Manual（逐句跟读）状态；上一句、下一句和重播会原子切换到 Manual，在句尾强制暂停，主动播放时只推进一条。另支持 `0.5 / 1 / 1.5 / 2` 倍速和快捷键。
- 设置：外观、自然语句/原始字幕和字幕语言；支持跟随系统、浅色和深色主题。
- 预留功能：听写、录音与评分入口会明确显示尚未开放，不申请权限，也不伪装成已实现。

不包含 Netflix、本地 OCR/语音识别、新翻译服务、AI 评分、参考扩展账号同步或商店发布。

## 字幕与时间规则

YouTube 原始层完整保留每个文本事件，包括重复、空白、重叠和时间异常信息；控制事件不伪装成字幕。显示层忽略仅用于布局的换行事件，按开始时间稳定排序并恢复自然句。

句子分组只作用于显示层：

- 句末标点优先决定自然句边界。
- 相邻 cue 之间超过 1500ms 时分开处理，避免跨长静音拼接。
- 完整短句保留自身 canonical start/end，不以持续时间为由拼接下一句或延长结束时间。
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
npm run verify:bilibili-ocr
```

生产包位于：

```text
D:\github\youtube-language-helper\.output\chrome-mv3
```

重新构建后必须让测试浏览器或已安装扩展真正重新加载。覆盖磁盘文件不会自动替换已运行的 Service Worker 和 content script；验收时应记录旧 Worker 消失、新 Worker 上线，并核对运行时文件 SHA-256。

### B站字幕优先级

YouTube 继续使用原有原生字幕链路，未接入这套选择器。B站字幕数组由 `lib/bilibili-ocr.ts` 执行严格优先级选择：

1. 只有 `is_ai === false`（或数值 `0`）且 `lan_doc` 不含 `AI` 的轨道可进入人工字幕层；只要存在人工轨，AI 轨全部隐藏且不会发起字幕 JSON 请求。
2. 完全没有人工轨时，选择器自动暴露明确标记为 AI 的轨道，并由现有网络下载、`RawCue`、语段和侧栏状态链路直接加载。
3. 标记缺失或结构异常的未知轨既不会冒充人工字幕，也不会被当作 AI 保底。项目不再包含 Python、ONNX、Native Messaging、Canvas 视频帧采集或 SRT 导出服务。

## 当前验证结果

- `npm run verify:bilibili-ocr` 是可重复运行的完整门禁：TypeScript 类型检查、92 项单元测试、Chrome MV3 生产构建和 65 项生产 bundle 集成测试。
- 单元仿真同时覆盖“人工 + AI 混合时只选人工”“AI-only 时成功回退 AI”“`is_ai=false` 但名称含 `AI`”和未知轨失败关闭。
- 生产 bundle 回放确认：AI-only 响应会请求一次选中的 AI 字幕 JSON 并进入 `RawCue → State`；混合响应不会公开或请求 AI 轨；YouTube 集成回归仍全部通过。
- 当前工作树已删除 OCR Native Messaging 注册项以及整个本地 Python/ONNX 服务目录；生产 manifest 不含 `nativeMessaging` 权限。

## 主要入口

- `entrypoints/background.ts`：原生 timedtext 观察、会话缓存和设置迁移。
- `entrypoints/youtube-main.content.ts`：YouTube 页面环境、视频与轨道元数据桥接。
- `entrypoints/youtube.content.ts`：字幕接收、主副轨、定位和播放边界。
- `entrypoints/bilibili-main.content.ts`：B站网页登录态、元数据和字幕轨获取。
- `entrypoints/bilibili.content.ts`：B站字幕解析、切轨、定位和播放边界。
- `entrypoints/sidepanel/`：双字幕侧栏、播放、快捷键和设置入口。
- `lib/youtube-native.ts`：原生字幕安全校验、缓存选择和显示语句派生。
- `lib/playback-machine.ts`：Auto/Manual 状态、精准 seek、句尾边界和监听器生命周期。
- `tests/integration/`：生产构建脚本的受控集成验证。

## 许可与来源

- WXT、React、Radix UI 和 SBD 均按仓库锁定版本使用；第三方许可见 `public/licenses/`。
- 本机 Enjoy Echo 发布包只用于观察交互和公开可见的扩展行为，没有作为本项目源码复制。

继续工作前先读 [HANDOFF.md](HANDOFF.md)、[设计稿](docs/design.md)和[M0 验证记录](docs/m0-validation.md)。
