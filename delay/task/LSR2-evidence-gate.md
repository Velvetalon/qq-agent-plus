# LSR2 Learned Self 证据资格与作用域门禁

## 目标

阻断“机器人自己的输出被当成用户偏好”的根因，让反思只从有足够用户证据的互动中创建行为 trait。

## 范围

- 在 completion evidence 中明确区分 `user_evidence`、`assistant_context`、`delivered` 和 `user_confirmed`；发送成功不得等同于用户认可。
- assistant outbound 可以保留给反思模型理解上下文，但不能作为 trait 唯一证据，也不能作为用户确认引用。
- 主动唤醒、无新触发消息、assistant-only、纯 `explicit_silence` 会话默认标记为不可学习行为 trait。
- 引入至少 3 个独立会话、至少 2 条用户证据的默认门槛；同一消息/同一会话重复不能满足独立性。
- global trait 需要跨至少 2 个聊天 scope 的有效用户证据；否则强制 chat scope 或拒绝 proposal。
- 保留 Notebook/普通 reflection 的上下文能力，但 trait proposal 的 evidenceRefs 必须通过 host-side 资格校验。

## 不做

- 不在 Prompt 中只增加“请谨慎学习”文案而不加宿主校验。
- 不把所有 assistant evidence 从反思输入删除，避免破坏角色笔记和上下文理解；只禁止其充当偏好证据。
- 不在本卡实现运行状态关键词过滤；那属于 LSR3。

## 验收

- assistant-only proactive run 不创建行为 trait job。
- 只有 assistant outbound 的“人呢？”案例被拒绝或标记不可学习。
- `explicit_silence` 且无用户明确偏好时不产生 trait。
- 一次正常会话不能达到 trait 门槛；3 个独立会话达到门槛后才生成 job。
- 单群 evidence 不能生成 global trait；跨群证据可以在满足阈值后晋升。
- 旧的账号、聊天、Base Persona、CAS 和 reflection job 隔离测试继续通过。
- 生成 `docs/verification/vnext-learned-self-lsr2.md`。

## 实施自由度

可以扩展 normalized evidence 字段，也可以在 enqueue/validate 两层分别门禁；但最终必须由宿主拒绝不合格 evidence，不能只依赖 reflector 自律。阈值可配置，但默认值不能退回单会话自动学习。

## 交付

证据 schema/校验实现、focused tests、脱敏 replay fixture、验证文档。不得写生产数据库或调用真实模型完成验收。

