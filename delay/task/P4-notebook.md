# P4 自由 Notebook

> 状态：planned。依赖 P2 契约；P3 可先完成但 Notebook 可并行实现，集成仍按顺序合并。

## 目标

为 self-evolution 插件建立独立 SQLite 和四个工具，完成写入、重启、编辑冲突、范围隔离、归档及管理端最小闭环；不开反思，不默认启用 embedding。

## 必须实现

- 数据目录为 `DATA_DIR/plugins/self-evolution/`，独立 `state.sqlite`；正文/版本是事实，索引为派生数据。
- 工具：`notebook_append`、`notebook_search`、`notebook_update`、`notebook_archive`。
- revision/CAS、宿主生成幂等键、来源校验、scope（global/chat）和账号命名空间。
- archive 保留历史但停止召回；容量、正文长度和每 Run 写入上限明确拒绝，不默默丢数据。
- 聊天工具和管理端写 API 共用校验，但管理端返回可审计来源和 revision。
- 未启用或停用时不建库、不写入、不运行 worker；停用仍可读已有数据。

## 非目标与硬约束

- 不迁移 Person Memory/Handoff，不创建定时任务、主动私聊或跨群广播。
- 模型不能凭 tags 扩大 scope；当前会话只能读 global + 当前 chat 允许范围。
- 不把失败返回 `saved=true`，不做硬删除自动化。

## 允许的自主决策

可按规划合并少量逻辑表、选择 SQLite 驱动封装、管理端分页样式和具体错误码；不得改变四个工具语义、CAS、来源继承和数据目录。

## 验收

- 真实工具入口写入后重启仍可读，重复调用幂等。
- 并发编辑只有一个 revision 成功，另一个得到冲突且不覆盖。
- global/chat 隔离无泄露；archive 后不再召回。
- `notebook_append -> stay_silent` 能落库且零外发。
- 关闭插件后无新写入、timer 或模型调用。

## 回退

停用 self-evolution，保留 SQLite 供审计；迁移失败安全关闭插件，不删除库、不影响主聊天。
