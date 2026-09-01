# Video Language Helper · M0

独立的 YouTube / Bilibili 字幕学习侧栏。界面与播放流程参考本机 Enjoy Echo 发布包，但不依赖 Enjoy 账号、品牌、图标或受保护接口。

## 当前功能

- YouTube：Supadata native 标点字幕优先与 YouTube 自动轨词级时间对齐；对齐不可用时按 Supadata cue 时间生成明确标记为估算的可点击语段。
- Bilibili：读取网站官方 WBI 字幕轨，复用网页登录态；不调用 Supadata。
- 网站双语：B站已有单条双语轨时直接使用；若网站提供英语主轨和中文副轨，则按真实 cue 时间组合为“网站双语”，不自行翻译。多个中文候选同时存在时优先网站的简体中文轨。
- 本地分句：SBD 1.0.19 先确定句号、问号和感叹号边界；YouTube 每个学习语段严格为 `2–5 秒`，不足 2 秒向后合并，超过 5 秒继续拆分，完整句界优先。原始字幕文字、顺序和 cue 数据不改。
- 播放：点击定位、上一句、下一句、单句播放、500 ms 间隔循环、连续播放、0.75/0.8/0.9/1 倍速、播放中高亮，以及 `Space/K/Shift+<>/E/H/A/S/D` 快捷键。
- 跟读：本地麦克风录音与回放，支持 `R/G/Esc`；没有语音评分或云端上传。
- 工作流：保存 Key 后，每个新 YouTube 视频会话自动读取一次字幕；三点菜单可显式重新获取、打开引导或设置。B站自动读取网站字幕且不调用 Supadata。

不包含 Netflix、无字幕语音识别、新翻译服务、AI 评分、Enjoy 账号同步或商店发布。

## 时间与原始数据

YouTube 的自然语段优先使用自动轨词级时间。词级轨缺失或无法可靠对齐时，使用 Supadata 原 cue 的起止时间在 cue 自身单词间做确定性估算，并以 `youtube-estimated` 标记；这是用户要求的 2–5 秒硬回退，不冒充精确词时间。B站仍只使用网站 cue 级 `from/to`，不沿用该 YouTube 估算路径。

B站双语组合以英语为上行、中文为下行。分段不同的两轨按实际时间覆盖聚合，起止时间取参与 cue 的真实最小/最大边界；原始对象保存在 `raw.primary` 和 `raw.secondary`。学习视图会去掉滚动字幕相邻 cue 的重复前缀，并在已有真实 cue 边界处把派生语段控制在 6 秒以内；原始视图不去重、不改写时间，单个 cue 超过 6 秒时也不会伪造句内起点。

## Supadata 设置

YouTube 字幕使用用户自己的 Supadata Key。打开扩展选项页，保存 Key 与语言代码并执行账户测试。Key 只保存在 `chrome.storage.local`；每个新视频会话自动提交一次，之后只有用户从三点菜单选择“重新获取字幕”才会再次提交。固定使用 `mode=native`、`text=false`，异步任务最多轮询 60 次。

B站不使用 Supadata Key，也不产生 Supadata 调用次数。

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

在 Chrome 的扩展管理页加载该目录。重新构建后必须对解压扩展执行一次“重新加载”，再刷新视频页面；覆盖磁盘文件不会自动替换已经运行的 content script。

## 当前验证结果

- 98/98 单元检查通过。
- 56/56 生产 bundle 集成检查通过。
- TypeScript 类型检查和 Chrome MV3 生产构建通过。
- YouTube 真实 21 分钟视频已验证前、中、20分钟后定位、单句/循环/连续、倍速和同视频双标签页隔离；SPA A→B→A 仍只有生产脚本模拟覆盖。
- B站生产 bundle 已验证页面登录桥、网站双语、快速切轨、单句/循环/连续、SPA 切换、多标签页隔离，以及 20 分钟后时间边界。
- B站真实登录 Chrome 已加载此前提交 `b75bb75` 的生产包：网站语言下拉、双语字幕、点击定位、单句/循环/连续、0.8×、上/下一句、同视频双标签页和第 1 P→第 2 P→第 1 P 状态重建均通过。真实样本每个分 P 不足 5 分钟，因此 B站 20 分钟轴仍明确标记为模拟；整体 ≥20 分钟真实定位由 YouTube 21 分钟样本覆盖。

本轮最新生产包另以真实 JS/CSS 加模拟 Port/数据完成浏览器交互和窄侧栏验收；这不等于 Chrome 已重新加载最新版，也不等于真实 Supadata 调用。100 项有效改进及逐项证据见 [改进台账](docs/improvement-ledger.md)。

自动化中的 B站官方响应为受控模拟，不能替代登录态真实网页验收。完整边界见 [M0 验证记录](docs/m0-validation.md)。

## 主要入口

- `entrypoints/youtube-main.content.ts`：YouTube 页面环境与词级字幕请求。
- `entrypoints/youtube.content.ts`：YouTube 状态、定位和播放边界。
- `entrypoints/bilibili-main.content.ts`：复用 B站网页登录态获取元数据与字幕轨。
- `entrypoints/bilibili.content.ts`：B站字幕解析、切轨、定位和播放边界。
- `entrypoints/sidepanel/`：Enjoy 式侧栏、字幕与播放/录音控件。
- `entrypoints/options/`：Supadata 设置。
- `lib/bilibili.ts`：B站轨道、网站双语和 cue 时间处理。
- `tests/integration/`：针对生产构建脚本的受控集成验证。

## 许可与来源

- SBD 1.0.19：MIT，见 `public/licenses/sbd.txt`。
- YouTube Digest 字幕链路移植：MIT，见 `public/licenses/youtube-digest.txt`。
- Bilibili Digest WBI/字幕链路移植：MIT，见 `public/licenses/bilibili-digest.txt`。

本仓库没有远程仓库；已有本地提交，未推送、未发布。继续工作前先读 [HANDOFF.md](HANDOFF.md)、[设计稿](docs/design.md) 和 [M0 验证记录](docs/m0-validation.md)。
