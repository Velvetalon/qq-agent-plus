# vNext 任务卡目录

规划原文：[`plan_doc/2026-09-24-little-w-vnext-development-plan.md`](../../plan_doc/2026-09-24-little-w-vnext-development-plan.md)

这些任务卡是给后续普通 Agent 调度开发使用的执行边界，不是实施结果。按 `P0` 到 `P8` 的顺序推进；只有任务卡明确写出可并行部分时才允许并行。

## 顺序与合并门槛

| 顺序 | 任务卡 | 交付重点 |
|---|---|---|
| 1 | `P0-baseline.md` | 固定源码、运行基线、建立可比较证据 |
| 2 | `P1-plugin-registry.md` | Registry、Legacy Adapter、Run 快照，行为不变 |
| 3 | `P2-plugin-lifecycle.md` | 生命周期、扩展点、可靠完成事件、迁出基础工具 |
| 4 | `P3-active-silence.md` | `stay_silent`、终止屏障、参与审计，可独立发布 |
| 5 | `P4-notebook.md` | 自由 Notebook 的持久化与管理端最小闭环 |
| 6 | `P5-retrieval.md` | 中文召回、动态上下文、可选 embedding 与失效 |
| 7 | `P6-reflection.md` | Reflection、Learned Self、Capability Gap、回滚 |
| 8 | `P7-console-observability.md` | 管理端、审批、预算、可观测性与文档 |
| 9 | `P8-release-validation.md` | 故障注入、真实模型评估、灰度、发布/回退 |

P4/P5 的纯存储、检索和独立页面工作，可在 P2 契约冻结后由不同 Agent 并行；共享 `Orchestrator`、`ChatStore`、配置 facade、`tools.js`、`ui/app.js` 的改动必须由一个集成负责人合并。

## 通用交付规则

每张卡完成时必须返回：变更文件、执行命令及退出码、测试结果、已验证事实、`NOT_RUN`/`BLOCKED` 项、数据/代码回退步骤。不得修改管理员保存的 `persona.roleText`，不得绕过 Sender/Outbox、lease/ack、lifecycle 原子提交、实验调度包装或认证体系。
