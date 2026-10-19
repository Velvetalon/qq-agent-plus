# Social 表情附带文字的发送前审核修复

日期：2026-10-19，Asia/Hong_Kong。基线：`188ba2232d78b4613000c015ecada0f782d3d23f`。
本计划由主协调者亲自阅读最新交接、完整 Social 设计/验收、接管契约及关键实现后确定；不委派架构分析或开发方向判断。

## 1. 目标、事实和边界

最新交接为 [云环境交付记录](../delay/schedule/2026-10-19-cloud-handoff-delivery.md)。B07 语义复读、R06/B10 无来源经历和视觉/身份正反例的最终真实模型回归仍开放；SC8、真实 QQ 和生产操作仍暂停。

已确认的本地缺口：`tools-core.js` 的 `send_face` schema 和实现支持 `text`，OneBot 会将该字段作为原样文字段与表情一起发出；`plugins/context.js` 仅在 `sendTextBatch` 调用 `beforeTextBatch`。因此同一 Replyer 可以用表情文字绕过当前语义审核、审核预算及无可接受草稿审计。

编码前用真实 messaging facade、拒绝型审核回调与合成 sender 复现：`reviews=0, syntheticSends=1, realRequests=0`。首次 PowerShell 内联脚本因原生参数引号被剥离报语法错误；改用 stdin 脚本后完成上述有效复现。没有连接模型、OneBot 或生产数据。

本轮修复该本地硬边界，不以黑名单替代语义判断，不重设人物卡或模型，不关闭全部文字或全部表情，不宣称解决真实模型语义失败。

## 2. 主协调者确定的接口和实现方案

1. 复用宿主 `beforeTextBatch`，增加只由宿主 facade 提供的第三参数 `{ kind: 'face' }`；原文字路径仍为默认 `text`，不改模型工具参数。Social 宿主按 `face` 审核附带文字的协议实际文本，不走 Markdown 去除或 QQ 文本分片；仅复用现有 `escapeCqText` 将 `[CQ:` 规范化为 `[CQ：`，与 OneBot 一致，`rawDrafts` 仍保存原始输入。
2. messaging facade 的 `sendFace` 在 caption 非空白且存在审核回调时，先审核、再检查取消，最后调用原 Sender。审核拒绝或失败不得调用 Sender、创建 chain 或建立 outbox。纯表情/全空白 caption 不增加语义模型调用；旧模式没有审核回调时保持原行为。
3. caption 与 options 在异步审核前快照，避免调用方在等待时改写未审核文字。把完整审批 `parts` 通过现有 `reviewedTextParts` 内部字段交给 Sender。Sender 在入队前比较审批与经现有 `escapeCqText` 规范化的 caption，且固定入队后的 caption，不能在等待期间替换。
4. 保留统一 `deliveryGuard`、run/signal/chat 绑定、unknown 防重放、可见动作数及现有 Sender/Outbox 所有权。一个 caption+face 是一条物理消息，不能因 `hardSplitAt` 变成多条。成功回执适配为现有审核的一个已投递批次，不把原协议结果改变成文字批次。
5. `send_face` 工具像 `send_message` 一样保留 `SocialDraftReviewError.result` 的预检拒绝元数据与有限修订反馈，防止把 0 次外发误记成失败写入。纠正工具 description 与既有可选 text schema 的矛盾，不新增工具能力。

## 3. 文件所有权及非目标

主协调者是本轮唯一实现写入者：

- `src/plugins/context.js`：face caption 预检、快照、回执适配。
- `src/core/orchestrator.js`：按宿主提供的发送类型准备待审核文字。
- `src/onebot/sender.js`：face 审批一致性检查与队列 caption 快照。
- `src/tools/tools-core.js`：预检错误元数据及工具说明一致性。
- `test/social-face-review.test.mjs`：本轮独立单元/集成回归。
- 本计划及 `delay` 接管进度记录/索引。

不修改 OneBot 协议 API、数据库 schema、事件版本、审核模型选择、调用预算、启用状态或既有真实回放 fixture。依赖不变，不重装依赖，不接触未跟踪的 `NEED_HELP.md`。

## 4. 验收标准

- 拒绝 caption：0 Sender 调用/队列/outbox；经工具执行器仍为 `preflightRejected`，不产生外发失败记账。
- 正例 caption：审核收到与 OneBot 发送完全一致的原文（含 Markdown、空白和 CQ 字面量），一条物理消息，审批成功批次记录 delivered=1。
- 有限修订：真实 Orchestrator/PluginManager/工具/facade/Sender/SQLite 链中，首个无依据 caption 被拒，第二个修订 caption 重新审核后才可投递；实际审核与 token/call 审计一致。
- 第二次拒绝、审核失效/异常或共享预算耗尽不能通过换用 `send_face` 绕过；无可接受草稿不是自然沉默或成功修订。
- 审核等待时取消或权限改变：0 后续发送。审批 parts 与 caption 不一致：入队前原子拒绝。
- 调用方在审核/排队时修改原 options 不会改变已审核/已排队 caption。
- 纯表情不增加审核调用；没有审核回调的旧模式继续支持原样 caption。
- 现有 draft-review、plugin-tool-context、social-runtime、delivery/unknown 重点回归及完整离线门禁保持通过。Windows/浏览器环境限制单列，不能删断言或冒充真实模型效果。

## 5. 执行顺序、复核和停止条件

存档本计划 → 新增失败测试并在修复前确认失败 → 主协调者实现 → 专项自测 → 独立只读复核（只检查上述已确定标准，返回具体缺陷/证据，不重做设计或推荐下一项任务）→ 主协调者裁决返修 → 完整离线门禁与证据归档 → 更新 delay 入口 → 普通 commit/push origin/main。

独立复核不写文件、不接触真实凭据、不外连、不 commit/push；发现范围外设计问题即返回主协调者。本轮完成条件是这条绕过路径被封闭、正反例及相关投递防线经离线验证、复核结论被处理并记录。B07/R06/B10 保持 FAIL/PARTIAL/OPEN，不能因本地硬边界通过改写为真实语义 PASS。真实模型/生产解锁不属于本轮完成条件。

## 6. 用户后续明确指定的测试/上线模型

实现专项53项通过后，用户明确指定 NanoGPT 聊天模型 `qwen/qwen3.8-27b-uncensored:thinking`、Embedding `Qwen/Qwen3-Embedding-4B`，并提供临时测试认证。本轮随后允许在有界合成 fixture 中调用这两种真实模型；不再使用旧 DeepSeek 验收配置。凭据仅进程认证，不写源码、文档、配置或 Git；QQ/生产部署暂停不因模型选择自动解除。配套变更与新增验收见 [指定模型回放计划](2026-10-19-qwen-replay-profile.md)。本计划原有离线红/绿测试事实与历史授权时点不倒改。
