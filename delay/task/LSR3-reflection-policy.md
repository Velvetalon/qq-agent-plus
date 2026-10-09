# LSR3 反思策略与运行状态隔离

## 目标

禁止把发送错误、队列、定时唤醒和固定台词写入长期 trait，并停止行为 trait 的无人工审核自动应用。

## 范围

- 将 `working_habit` 从默认 bounded-auto trait 白名单移除，或改为必须人工批准；不得把它作为运行状态存储的替代品。
- 对 `result=120`、retry、queue、schedule、wake、system reminder、具体时间、消息 ID、发送状态和外发结果做 host-side procedural evidence 拒绝。
- 对“固定原句 + 固定表情 + 固定触发条件”类值拒绝或降级为短期、当前聊天上下文；不写 Learned Self trait。
- `communication_style`、`expression_preferences`、`interaction_preferences` 仍可提案，但必须满足 LSR2 evidence gate，并以抽象偏好而非脚本保存。
- `bounded_auto` 只允许自动应用安全的普通 Notebook 操作；行为 trait 进入 review/pending，confidence 不能绕过人工审核。
- 反思输入中保留运行诊断供 capability gap 使用，但明确分离 `execution_state` 与 `preference_evidence`。

## 不做

- 不把“禁止关键词”当成唯一语义判断；需要组合字段、作用域、证据角色和结构化状态。
- 不删除正常短句偏好，例如“倾向简短”；拒绝的是具体脚本化执行规则。
- 不修改主动唤醒调度器本身；调度行为与 Learned Self 隔离即可。

## 验收

- 包含 `result=120`、schedule/retry/queue 或系统提醒的 proposal 被拒绝并记录原因。
- 固定台词/固定表情 proposal 不会自动应用；抽象风格 proposal 可进入人工审核。
- bounded_auto 下行为 trait 保持 pending，Notebook 普通笔记原有行为不回归。
- 同义改写的脚本不会因字符串不同而无限产生新 trait revision。
- 记录拒绝原因、evidence refs、proposal 状态和操作者，且不泄露凭据或完整敏感聊天。
- 生成 `docs/verification/vnext-learned-self-lsr3.md`。

## 实施自由度

可以用专门的 policy helper、trait validator 或 reflection-store 内部校验；不要把运行状态再塞回 profile JSON。允许先采用保守拒绝策略，后续再放宽抽象偏好范围。

## 交付

反思策略实现、proposal 状态迁移、focused tests、线上案例 replay 验证文档。生产 profile 清理由 LSR1 负责，本卡不直接改线上数据。

