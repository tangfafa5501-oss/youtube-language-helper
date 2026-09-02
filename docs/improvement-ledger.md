# 当前有效防护台账

更新时间：2026-09-02。旧阶段的供应商路线、过期测试数字和已撤销实现不再作为当前改进项保留；本表只登记仍由代码或自动化证明的有效防护。

| 编号 | 有效改进 | 证据 |
| --- | --- | --- |
| 1 | YouTube 只接受同源 `/api/timedtext`，校验视频 ID、语言、轨道类型和 URL 长度 | `tests/youtube-native.test.ts` |
| 2 | 捕获正文按视频、语言和人工/自动轨隔离 | 单元测试 + 生产集成 |
| 3 | 会话缓存限制为最多 8 个唯一轨道和 750 万字符 | `tests/youtube-native.test.ts` |
| 4 | `captured` 到达后立即推送并渲染，不等待旧轮询结束 | `tests/integration/bridge.test.mjs` |
| 5 | 重连时优先读取 `latest`，拒绝、超时和畸形数据均能继续正常请求 | `tests/integration/bridge.test.mjs` |
| 6 | 选轨请求与授权捕获并行，授权出现后立即重试 | `tests/integration/bridge.test.mjs` |
| 7 | JSON3 控制事件不伪装成字幕，非法结构和超大正文显式失败 | `tests/captions.test.ts` + `tests/youtube-native.test.ts` |
| 8 | 原始 cue 保留文本、顺序、时间问题和原始对象 | `tests/captions.test.ts` |
| 9 | 显示语句忽略布局换行事件，但不删除原始事件 | `tests/youtube-native.test.ts` |
| 10 | 句间长静音不会被跨越拼接 | `tests/youtube-native.test.ts` |
| 11 | 显示行不足 2000ms 时向后合并或延长，DOM 中不得出现短行 | 单元测试 + 24/24 浏览器门禁 |
| 12 | 不设固定最长拆分上限，完整疑问句保持为一行 | 核心反例断言 |
| 13 | `And what if you were wrong about every single one?` 完整出现 | 真实数据回放 JSON + DOM 断言 |
| 14 | `single one?` 和 `wrong.` 不得独立成行 | 真实数据回放 JSON + DOM 断言 |
| 15 | Side Panel 派生视图明确输出 `data-display-mode=phrases` | 24/24 浏览器门禁 |
| 16 | 每个 DOM 字幕节点都具有可解析时间 | 24/24 浏览器门禁 |
| 17 | 点击字幕定位到对应开始时间 | 集成测试 + 浏览器门禁 |
| 18 | 主字幕和第二字幕独立，副轨不改主轨时间 | 单元测试 + 生产集成 |
| 19 | B站默认英语主轨配网站手工简体中文轨 | 单元测试 + 生产集成 |
| 20 | SPA、分 P、快速切轨和多标签页使用会话隔离 | 生产集成 |
| 21 | 连续播放、逐句跟读和手动继续不会遗留旧计时器 | 单元测试 + 生产集成 |
| 22 | 下拉菜单文字、勾选标记、Portal 主题和层级均经过常规/窄视口验证 | `design-qa.md` |
| 23 | 未开放能力不会申请权限或伪装成功 | 生产集成 + UI 验收 |
| 24 | Service Worker 重载记录旧实例关闭和新实例令牌 | 浏览器门禁 JSON |
| 25 | 生产源、加载包与运行时关键文件 SHA-256 一致 | 浏览器门禁 JSON |
| 26 | 每次代码交付必须报告测试环境、数据来源和证据等级 | `HANDOFF.md` + 项目规则 |
| 27 | 每次提交后单独核对提交状态与工作区是否干净 | `HANDOFF.md` |

最新基线：77/77 单元测试、61/61 生产 bundle 集成测试、TypeScript 类型检查、生产构建和 24/24 测试浏览器真实数据回放通过。后续数字只能由新一轮完整命令输出刷新。
