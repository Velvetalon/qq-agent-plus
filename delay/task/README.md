# Self-Evolution 闭环修复任务卡

规划基线：[`../plan/2026-09-25-self-evolution-closure.md`](../plan/2026-09-25-self-evolution-closure.md)

目标：只修复 Notebook、Retrieval、Reflection、Learned Self 之间已有的断链，不扩大权限，不改变 Base Persona、安全规则、工具权限、Sender/Outbox、lease/ack 或 unknown 外发语义。

## 顺序与依赖

| 顺序 | 任务卡 | 交付重点 |
|---|---|---|
| 1 | `P0-account-namespace.md` | 统一 accountId 来源与 source 校验 |
| 2 | `P1-notebook-scope.md` | 修复 chat/global scope 边界 |
| 3 | `P2-retrieval-context.md` | Retrieval ContextProvider 与动态 user prompt 接入 |
| 4 | `P3-learned-self-revision.md` | Reflection 读取真实 Learned Self revision |
| 5 | `P4-reflection-scheduling.md` | 预算阻塞、观察门槛、证据过滤 |
| 6 | `P5-notebook-prompt.md` | Notebook 能力说明与安全边界提示 |
| 7 | `P6-closure-verification.md` | 跨账号、跨 scope、重启、召回、反思、回滚闭环验收 |

P0/P1 的纯调查和局部测试可以并行；涉及 `src/plugins/context.js`、`src/core/orchestrator.js`、`src/llm/prompt.js`、`src/plugins/self-evolution/index.js` 的写入必须由一个集成负责人串行合并。P2 必须在 P0/P1 契约冻结后实现，P3/P4 可并行开发但只能在 P6 汇合验收。

## 通用交付规则

每张卡完成时必须返回：变更文件、执行命令及退出码、测试结果、已验证事实、`NOT_RUN`/`BLOCKED` 项、回退步骤。所有测试使用 `E:\node22\node.exe`。不得修改 `persona.roleText`，不得让模型自行指定 `accountId`，不得把 tags 当 scope 权限，不得删除历史 Notebook/Reflection 数据。
