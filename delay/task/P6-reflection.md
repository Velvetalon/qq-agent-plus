# P6 Reflection、Learned Self 与 Capability Gap

> 状态：planned。依赖 P2 的可靠事件、P4/P5 的笔记与召回；默认 selfEvolution 关闭、反思 `review`。

## 目标

建立不阻塞聊天的后台反思闭环：受限观察、幂等作业、结构化提案、版本化 Learned Self、能力缺口记录、审批/受限自动应用和可回滚状态。

## 必须实现

- observer 只写受限事实并入队；worker 有 lease/generation、并发 1、预算、停止协议和有限重试。
- 同一观察窗口只建一个 job；无新证据不调用；反思自身产物不形成自激证据。
- 输出只允许 noteOperations、traitProposals、capabilityGapProposals、summary；严格 schema、来源、scope、CAS、数量和字符上限校验。
- Learned Self 与 Base Persona 分离，默认 review；bounded_auto 只允许低风险、可审计、可回滚的有限变更。
- profile version 记录 parent、evidence、base persona hash、应用者和时间；旧提案遇到新 Base Persona/人工编辑必须失效。
- Capability Gap 区分 missing/disabled/permission/config/temporary_failure，按真实去重请求计数，不执行代码/装插件。

## 非目标与硬约束

- 不改模型权重、roleText、权限、安全边界、工具规范或跨域共享策略。
- 失败、超时、预算耗尽、unknown 外发和未被唤醒不能被学成“不感兴趣”。
- 不在聊天线程调用反思 LLM，不自动私聊、不申请密钥、不重试未知 QQ 外发。

## 允许的自主决策

可决定 worker 调度实现、作业表字段的非语义性扩展、提案 diff 形式和错误重试退避；证据 lineage、版本/CAS、上限、模式和回滚语义不可变。

## 验收

- 作业可恢复但不会重复应用；关闭/暂停后无新模型请求，晚到结果不提交。
- 没有新证据时 noop；非法输出零业务状态变更。
- review 提案可批准/拒绝；profile 回滚产生可追踪新版本并改变后续上下文。
- 修改 Base Persona 或支持证据后旧偏好不再越权注入。

## 回退

停用反思 worker，保留 Notebook、profile 历史和 gap 数据；回退行为版本不得删除聊天历史或未知外发记录。
