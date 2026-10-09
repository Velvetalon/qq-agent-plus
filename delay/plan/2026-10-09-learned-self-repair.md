# Learned Self 反思污染修复规划

> 规划日期：2026-10-09（Asia/Shanghai）
> 适用仓库：`Velvetalon/qq-agent-plus`
> 任务卡目录：[`delay/task/`](../task/)
> 证据目录：`C:\Users\v_whcnwwang\OneDrive\codex\qq-agent-plus\diagnostics\learned-self-root-cause-2026-10-09`

## 目标

修复 Learned Self 把机器人自己的输出、系统提醒、发送错误和调度状态总结为长期行为脚本的问题。修复后，反思只能从有充分用户证据的互动中提取短期、可过期、范围明确的抽象偏好；不能把“人呢”“固定表情”“result=120 重试”之类内容写成长期行为规则。

线上当前已由管理员禁言，本规划不包含止血开关和主动停机操作；重点是清理已有 profile、修复证据契约、限制自动应用并完成回归验收。

## 已确认根因

1. `session.sent` 被作为 assistant conversation evidence 送入反思；`confirmed` 表示发送已确认，不表示用户认可。
2. 默认单个有效会话即可创建反思作业；有效只表示没有被分类为运行故障。
3. 反思 Prompt 没有要求用户明确确认、跨会话重复、排除 assistant 输出、排除运行状态或限制 global scope。
4. `bounded_auto` 会依据模型自报置信度自动应用低风险 trait。
5. Learned Self 注入只展示 key/value，缺少来源、范围、年龄、验证次数和过期约束；随后又作为下一轮反思的 `currentProfile` 输入，形成自强化。

## 实施顺序

1. `LSR1-profile-cleanup.md`：审计并非破坏性清理当前 profile，保留历史和回滚能力。
2. `LSR2-evidence-gate.md`：修复证据资格、独立会话阈值和作用域晋升规则。
3. `LSR3-reflection-policy.md`：禁止运行状态和固定脚本进入 trait，关闭行为 trait 的自动应用。
4. `LSR4-injection-closure.md`：注入来源/过期/纠正机制，补齐闭环测试、观测和交付文档。

LSR1 可以先独立交付；LSR2 是 LSR3 的前置；LSR4 依赖 LSR2 和 LSR3。任何任务都不得为了测试通过而直接写线上 SQLite 或发送生产 QQ 消息。

## 总体验收

- 清理后当前 profile 不再注入已确认的固定台词、固定表情和发送错误规则；历史版本仍可查询和回滚。
- assistant-only、主动唤醒、无触发消息和纯沉默会话不会自动产生行为 trait。
- 一次互动不能生成长期 trait；global trait 必须经过跨聊天验证。
- `result=120`、retry、queue、schedule、wake、系统提醒和具体时间/消息 ID 不会进入 Learned Self trait。
- `bounded_auto` 不会自动应用行为 trait；人工审核、拒绝和回滚均可观测。
- 下一轮注入带来源、范围、时间、验证次数和过期信息，不把完整历史台词作为行为模板。
- 局部测试、反思生命周期测试、脱敏线上案例回放和最终集成测试均有命令、退出码和 PASS/FAIL/NOT_RUN 记录。

## 不做

- 不删除 `reflection.sqlite` 历史版本、proposal、evidence 或审计记录。
- 不自动修改 Base Persona，不把 Learned Self 变成人格卡编辑器。
- 不引入第二套人格引擎、通用规则 DSL 或外部队列系统。
- 不以提高温度、修改几句 Prompt、增加固定黑名单作为唯一修复。
- 不在没有明确授权的情况下执行线上迁移、部署、收费模型调用或生产 QQ 测试。

