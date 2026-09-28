# Self-Evolution Vector Persona 任务卡

执行规划：[`../plan/2026-09-27-self-evolution-vector-persona.md`](../plan/2026-09-27-self-evolution-vector-persona.md)

执行基线：`f745111a3a680a24e226870bccff5c5cc79eed2d`

本目录的任务卡供 Sol 模型执行。任务卡描述的是待完成工作，不代表代码已经实现、
测试已经通过或生产已经授权。

## 交付范围

本阶段只闭合四件事：

1. 证据只保存一份，反思输入在预算内可用。
2. 反思超时、lease、attempt 有界收尾。
3. SQLite + sqlite-vec + 远端 embedding 替换自制中文相关性检索。
4. 角色结合真实经历和相关旧笔记，直接选择并书写角色笔记。

不做人格引擎、模型权重修改、自动改 Core、主动私聊、动态插件安装、向量数据库服务、
本地大模型、全量历史 backfill 或娱乐功能。

## 顺序与依赖

| 顺序 | 任务卡 | 依赖 | 结果 |
|---|---|---|---|
| 0 | `P0-baseline-and-vec-smoke.md` | 无 | 基线、环境、sqlite-vec 能力和回滚边界冻结 |
| 1 | `A-evidence-budget.md` | P0 | canonical evidence、预算和失败分类闭环 |
| 2 | `B-reflection-deadline.md` | P0、A | deadline、lease、attempt、晚到结果闭环 |
| 3 | `C-vector-retrieval.md` | P0、A | 向量索引、embedding、三条召回入口闭环 |
| 4 | `D-role-notes.md` | A、B、C | 角色视角笔记、自由写作、撤销语义闭环 |
| 5 | `E-integration-closure.md` | A-D | 真实装配、重启、回滚、失败恢复和交付轨迹 |

A/B/C/D 允许只读调查并行；共享接口和生产实现采用单写者串行合并。C 的 sqlite-vec
预检失败时，必须先返回 `NEEDS_DESIGN`，不能用自制分词或伪向量悄悄替代。

## 通用交付

每张卡必须返回：

- 变更文件和数据库迁移；
- 实际命令、退出码、运行时版本；
- 测试结果和 mock/真实边界；
- 已验证事实、`NOT_RUN`、`BLOCKED` 和剩余风险；
- 回退步骤；
- 需要下一张卡消费的接口、fixture 或验证证据。

统一约束：

- 不修改 `persona.roleText`、Base Persona、安全规则、工具权限、Sender/Outbox、消息 ack、
  lease/unknown 外发语义；
- account、scope、source、revision、CAS、取消和生命周期继续使用现有契约；
- 关闭模块时保留数据，不建库、不调用模型、不调用 embedding；
- 生产推送、部署、付费 backfill 和 QQ 测试消息必须获得当前用户明确授权；
- 没有真实 embedding 或人物行为凭据时，标记 `LIVE_NOT_RUN`，不能用 mock 结果冒充。
