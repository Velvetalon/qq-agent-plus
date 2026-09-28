# 2026-09-28 功能修复任务卡

规划原文：[`delay/plan/2026-09-28-functional-repair.md`](../plan/2026-09-28-functional-repair.md)

这些任务卡是在当前 `9069a4f` 基线上执行的修复边界。旧进度和任务卡已归档到 `delay/archive/2026-09-28-pre-functional-repair/`；本轮结果见 `docs/verification/vnext-functional-repair-pr*.md`。

执行顺序：

1. `PR1-config-authorization.md`：F1 + F2，宿主持有 embedding 凭据与外发授权。已实现，真实 provider `LIVE_NOT_RUN`。
2. `PR2-index-retrieval.md`：F3 + F4，独立索引消费者、恢复和纯查询。已实现，真实 provider `LIVE_NOT_RUN`。
3. `PR3-evidence-budget.md`：F5，反思证据预算与有限终结。已实现，真实反思模型 `LIVE_NOT_RUN`。
4. `PR4-role-console-closure.md`：F6 + F7，角色笔记接口、控制台状态和恢复入口。已实现，真实角色行为/线上部署 `LIVE_NOT_RUN`。

每张卡完成后必须保存命令/退出码、PASS/FAIL/NOT_RUN/LIVE_NOT_RUN、实际装配证据和回退方式。不得把 mock 外部 HTTP/LLM 的通过写成真实 embedding 或角色行为通过；不得部署、收费调用或发送生产 QQ 消息。
