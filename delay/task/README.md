# 项目开发任务索引

## 最新：2026-10-19 云环境代码交付（仍为 WIP）

[云交付记录](../schedule/2026-10-19-cloud-handoff-delivery.md) 保存恢复链、实际命令/退出码和未完成项。
源码 `bc0a77d1f65edcc009ac6d5d463af2b7866e31fe` 的最新离线单测为 **819 PASS / 0 FAIL / 0 SKIP**；
用户现授权将未完成成果推送原分支。图片细节幻觉、身份表达误拦和 B07/R06/B10 最终真实模型
回归仍未完成；SC8/真实 QQ/生产部署仍暂停。下方 800 PASS 与“不 push”为旧时点记录。

## 历史时点：2026-10-19 真实模型与必选 Embedding

[最新收口记录](../schedule/2026-10-19-real-model-embedding-closure.md)：真实4B跨会话记忆与独立设置页通过；全量800 PASS。17项真实模型验收中14项有小样本支持，B07复读FAIL，R06/B10因跨场景编造经历保持开放。SC8仍USER_PAUSED；项目未全卡结束，仅本地归档/commit，不push。以下较早状态保留为历史。

## 历史时点：2026-10-19 模型授权前复核

[任务卡复核与验证修复](../schedule/2026-10-19-task-card-recheck.md) 是模型授权前的历史入口。
本轮修复浏览器崩溃后测试挂起和价格测试意外外连，最终 759 项单测、其余本地门禁
和实际 Chromium 均通过。任务卡仍未全部结束：5 项真实语义、12 项真实模型回放、
真实 embedding 校准及暂停中的 SC8 仍未完成；不得把本地完成当作整体完成。

## 2026-10-16 当前逐项状态

[SC0–SC8与F4完整收口矩阵](../schedule/2026-10-16-task-card-closure.md) 保留当时逐项证据。
750项本地测试及其余门禁通过；F4词法回退差异已修复。下文旧时点状态保留作为历史，
不能据此重报旧依赖失败，也不能跳过最新矩阵中的真实模型/QQ/生产阻塞。

## 当前：拟人群聊内核完整设计（2026-10-13）

最新保存点见
[2026-10-14 GitHub WIP 交接](../schedule/2026-10-14-github-wip-handoff.md)：
全部当前未完成项目代码纳入保存，全量单测 660 PASS / 45 FAIL / 3 SKIP；
不得宣称完整开发、完整验收或生产部署已经完成。

**2026-10-13 用户已明确恢复开发，接管基线为 `8233c83`。当前接口与文件所有权见[接管契约 V1](../../plan_doc/2026-10-13-social-takeover-contract-v1.md)，逐阶段实测进度见[恢复开发记录](../schedule/2026-10-13-social-engine-resumed.md)。原 WIP 保存不等于完成验收；本次仍不授权生产上线或清理。**

1. [完整架构设计](../../plan_doc/2026-10-13-social-conversation-engine.md)：当前/目标对比、模块职责、事件与ID、场景、Planner/Replyer、主动意图、四类记忆、迁移与回退。
2. [开发规划 SC0-SC8](../../plan_doc/2026-10-13-social-conversation-development-plan.md)：依赖顺序、各阶段范围/不做/交付和Agent决策空间。
3. [单元与闭环验收](../../plan_doc/2026-10-13-social-conversation-acceptance.md)：A-E/S/P/R/I/D/M/L/C/H/B用例，区分单元、主链与真实模型效果。
4. [暂停交接](../schedule/2026-10-13-social-engine.md)：已有未提交草稿、局部验证、未完成项及恢复边界。
5. [2026-10-14 本地验证检查点](../../docs/verification/social-engine-closure.md)：248 项联合回归、35 项独立关键路径复核通过；剩余完整验收、配置兴趣来源入口和 LIVE_NOT_RUN 边界。

本方案替代后续发言内核方向；下方PR/LSR记录是历史计划和当时验证，不自动代表当前线上效果。旧的“所有笔记需用户确认”“所有沉默不得记忆”等限制不得覆盖本方案的经历/偏好分离设计。

## 历史：2026-09-28 功能修复任务卡

规划原文：[`delay/plan/2026-09-28-functional-repair.md`](../plan/2026-09-28-functional-repair.md)

这些任务卡是在当前 `9069a4f` 基线上执行的修复边界。旧进度和任务卡已归档到 `delay/archive/2026-09-28-pre-functional-repair/`；本轮结果见 `docs/verification/vnext-functional-repair-pr*.md`。

执行顺序：

1. `PR1-config-authorization.md`：F1 + F2，宿主持有 embedding 凭据与外发授权。已实现，真实 provider `LIVE_NOT_RUN`。
2. `PR2-index-retrieval.md`：F3 + F4，独立索引消费者、恢复和纯查询。已实现，真实 provider `LIVE_NOT_RUN`。
3. `PR3-evidence-budget.md`：F5，反思证据预算与有限终结。已实现，真实反思模型 `LIVE_NOT_RUN`。
4. `PR4-role-console-closure.md`：F6 + F7，角色笔记接口、控制台状态和恢复入口。已实现，真实角色行为/线上部署 `LIVE_NOT_RUN`。

每张卡完成后必须保存命令/退出码、PASS/FAIL/NOT_RUN/LIVE_NOT_RUN、实际装配证据和回退方式。不得把 mock 外部 HTTP/LLM 的通过写成真实 embedding 或角色行为通过；不得部署、收费调用或发送生产 QQ 消息。

## 当前追加规划：Learned Self 反思污染修复

规划原文：[`delay/plan/2026-10-09-learned-self-repair.md`](../plan/2026-10-09-learned-self-repair.md)

这轮针对线上发现的“机器人输出被习得为固定台词、运行状态被习得为长期习惯、profile 反复自强化”问题。线上已由管理员禁言，因此任务卡不包含止血开关；先清理历史 profile，再修复证据资格和自动应用策略。

执行顺序：

1. `LSR1-profile-cleanup.md`：非破坏性审计、清理和 profile reset，保留历史与回滚。
2. `LSR2-evidence-gate.md`：排除 assistant-only/主动唤醒/纯沉默证据，增加独立会话与跨聊天门槛。
3. `LSR3-reflection-policy.md`：隔离运行状态，拒绝固定脚本，行为 trait 改为人工审核。
4. `LSR4-injection-closure.md`：注入元数据、TTL、纠正入口、观测和完整闭环验收。

本轮任务卡不授权直接改生产 SQLite、部署、重新启用反思、调用真实收费模型或发送生产 QQ 消息。每张卡完成后必须保存命令/退出码、PASS/FAIL/NOT_RUN/LIVE_NOT_RUN、实际装配证据和回退方式。

LSR1-LSR4 已完成本地实现与 focused/regression 验证；验证记录见
`docs/verification/vnext-learned-self-lsr1.md`、
`docs/verification/vnext-learned-self-lsr2.md`、
`docs/verification/vnext-learned-self-lsr3.md` 和
`docs/verification/vnext-learned-self-lsr4.md`。生产 profile reset、部署和真实
模型/QQ 行为验证均为 `NOT_RUN` / `LIVE_NOT_RUN`，等待明确授权。
