# Video Language Helper · M0

独立的 YouTube / Bilibili 字幕学习侧栏。界面与播放流程参考本机 Enjoy Echo 发布包，但不依赖 Enjoy 账号、品牌、图标或受保护接口。

## 当前功能

- YouTube：Supadata native 标点字幕与 YouTube 自动轨词级时间对齐，生成可独立定位的朗读语段。
- Bilibili：读取网站官方 WBI 字幕轨，复用网页登录态；不调用 Supadata。
- 网站双语：B站已有单条双语轨时直接使用；若网站提供英语主轨和中文副轨，则按真实 cue 时间组合为“网站双语”，不自行翻译。
- 本地分句：SBD 1.0.19、用户朗读停顿规则及 `≤2 秒`向后合并。原始文字、顺序和时间保留。
- 播放：点击定位、上一句、下一句、单句播放、500 ms 间隔循环、连续播放、0.75/0.8/0.9/1 倍速、Space/方向键/R 快捷键和播放中高亮。
- 跟读：本地麦克风录音与回放；没有语音评分或云端上传。

不包含 Netflix、无字幕语音识别、新翻译服务、AI 评分、Enjoy 账号同步或商店发布。

## 时间与原始数据

YouTube 的自然语段使用自动轨词级时间；无法可靠对齐的语段不会伪造时间。B站只提供 cue 级 `from/to`，句界落在单 cue 内时保留该 cue 时间，不按字符比例估算。

B站双语组合以英语为上行、中文为下行。分段不同的两轨按实际时间覆盖聚合，起止时间取参与 cue 的真实最小/最大边界；原始对象保存在 `raw.primary` 和 `raw.secondary`。

## Supadata 设置

YouTube 字幕使用用户自己的 Supadata Key。打开扩展选项页，保存 Key 与语言代码并执行账户测试。Key 只保存在 `chrome.storage.local`；字幕请求由用户触发，不自动重复提交。固定使用 `mode=native`、`text=false`，异步任务最多轮询 60 次。

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

- 50/50 单元检查通过。
- 26/26 生产 bundle 集成检查通过。
- TypeScript 类型检查和 Chrome MV3 生产构建通过。
- YouTube 真实 21 分钟视频已验证前、中、20分钟后定位、单句/循环/连续、倍速和同视频双标签页隔离；SPA A→B→A 仍只有生产脚本模拟覆盖。
- B站生产 bundle 已验证页面登录桥、网站双语、快速切轨、单句/循环/连续、SPA 切换、多标签页隔离，以及 20 分钟后时间边界。
- B站真实登录页面已确认网站菜单存在中文、英文与双语开关，画面同时显示中英文；当前扩展是否已重载到最新包无法确认，因此扩展侧栏的真实 B站播放仍未标记为通过。

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

本仓库没有远程仓库，当前改动未提交、未推送、未发布。继续工作前先读 [HANDOFF.md](HANDOFF.md)、[设计稿](docs/design.md) 和 [M0 验证记录](docs/m0-validation.md)。
