# 2026-09-28 功能修复任务卡

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
