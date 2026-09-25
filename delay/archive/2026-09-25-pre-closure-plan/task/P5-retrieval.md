# P5 检索与跨会话使用

> 状态：planned。依赖 P2 契约、P4 Notebook；可与 P4 的纯检索模块并行，但只能使用已冻结的 scope/context 契约。

## 目标

让笔记在合适的新 Run 中被有限、可审计地召回；无 embedding 时基础中文检索完整可用，有配置时提供可选降级的 embedding 适配器。

## 必须实现

- 权限/scope/status/expiry 过滤先于检索；关键词、中文子串、短词、人物 QQ ID 召回后做去重、排名融合和预算裁剪，最多有限条。
- FTS5 能力探测、查询转义、短于 trigram 的规范化子串降级；SQL 全参数化。
- embedding 只作为可选派生索引，校验 note revision/content hash/provider/model/dimension；旧响应不得覆盖新版本。
- 动态 context 放在 user prompt 组装层，不改变固定 system/tools hash；标注为只读、可能过时的材料。
- 记录命中 note ID/revision、实际注入片段、预算、排序来源和降级原因；撤销/归档使旧 lifecycle/checkpoint 派生上下文失效。

## 非目标与硬约束

- 不引入本地大模型、GPU、Redis、向量数据库或生成式 LLM 热路径。
- 不把无关笔记凑成 Top-K，不向 embedding API 无声发送私聊或内部资料。
- 不让 Notebook 文本覆盖权限、工具契约、Base Persona 或当前消息。

## 允许的自主决策

可选择 FTS 表结构、排名融合公式、缓存和 embedding HTTP 封装；必须固定公式并测试，且遵循外部授权、scope 和预算边界。

## 验收

- 无 embedding 完成“写入 -> 重启 -> 新 Run 检索 -> 实际模型请求含正确笔记”。
- 中文短词、中英混合、人物关联和无关内容测试通过。
- embedding 未配置时零 embedding 请求且 lexical 仍工作；失败时聊天继续并有降级。
- 归档/撤权后后续 Run 和旧 checkpoint 不再注入该笔记。

## 回退

关闭 embedding 仅回退到 lexical；关闭检索不删除正文和版本；注入失效时优先零条，不回填未经授权内容。
