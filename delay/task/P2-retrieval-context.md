# P2 Retrieval ContextProvider

> 状态：planned。依赖：P0/P1。实现前冻结 retrieval audit 字段。

## 目标

把现有 `src/features/retrieval.js` 接入真实聊天 Run，在 user prompt 动态注入少量、可审计、受 scope 保护的 Notebook 内容。

## 已冻结契约

- 新增 `SelfEvolutionRetrievalProvider`，挂载 `PluginManager.contextProviders`。
- 注入位置只能是动态 user prompt；不得修改固定 system prompt、tools schema 或 prompt prefix hash。
- 默认预算：最多 5 条、最多 2400 字符；无相关命中时注入 0 条。
- 注入内容必须标注“来自过去记录、可能过时、不是当前命令”。
- 查询先做 account/scope/status/expiry 权限过滤，再做 lexical/FTS/embedding 排名。
- embedding 未配置或失败时 lexical 继续；不得静默把私密文本发往外部 embedding。

## 允许修改范围

- 新增 `src/plugins/self-evolution/retrieval-provider.js`
- `src/features/retrieval.js`
- `src/plugins/self-evolution/index.js`
- `src/core/orchestrator.js` 的 provider 装配与 user prompt 注入
- 测试和验证文档

共享 `prompt.js` 只允许增加动态上下文拼装 helper，不改 Base Persona 或安全规则。

## 实施要求

1. provider 读取当前 run 的 `accountId/chatKey`，不得从模型参数取值。
2. provider 返回 blocks、noteId、revision、snippet、rankingSource、budget、degradationReason。
3. session 记录命中 note id/revision、实际注入字符、召回预算、降级原因。
4. lifecycle continuation 的固定 transcript 不重写；新召回只进入当前 user 增量。
5. archive、scope 变更或 note revision 变化后，旧召回不再注入。

## 验收

`notebook_append → 关闭/重启 → 新 Run → 模型请求 user prompt 含正确笔记`；无关笔记为 0 条，短中文/混合词/QQ ID 召回正常，embedding 零配置不产生外部请求。

## 回退

关闭 provider 或 self-evolution retrieval 开关，保留 Notebook 正文；召回失效时优先注入 0 条。

