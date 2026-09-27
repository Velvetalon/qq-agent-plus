# A 证据单份化与反思输入预算

状态：planned

依赖：`P0-baseline-and-vec-smoke.md`

## 任务包

目标：让同一消息正文在完成事件、聚合作业和最终 ReflectionInput 中只保留一份；
正常长批次在预算内可以进入反思，且自由文本不会误判技术失败。

## 允许修改

- `src/core/orchestrator.js`
- `src/plugins/manager.js`
- `src/core/store.js`
- `src/plugins/self-evolution/reflection-store.js`
- `src/plugins/self-evolution/reflection-worker.js`
- 相关 schema/migration、测试、验证文档

## 冻结契约

canonical evidence 至少包含：

- `evidenceVersion`
- `conversationEvidence[]`：唯一的消息正文集合，含 account/chat/source ID、speaker/role、时间、
  是否已确认外发、正文和截断标记；
- `observations[]`：每个 run 的状态、质量、来源引用，不重复内联正文；
- `executionOutcome`：宿主真实结构化结果；
- `evidenceIds`：只允许引用实际保留材料和明确的 run 状态证据。

宿主负责生成，模型不能通过 finish summary 声明“运行成功”或伪造原话。图片无正文时只保留
媒体占位，不猜测内容。保留当前账号、chatKey 和事件时间范围，最多 20 条初始材料；
用户消息和已确认机器人回复各有基本额度，不能只保留一方。

预算分两级：

1. 归一化/聚合后的最终 JSON 字符预算；
2. `ReflectionInput`（角色、当前 profile、相关笔记、证据、运行结果）的总输入预算。

禁止对完整 JSON/prompt 末尾直接 `slice()`。先删重复/冗余旧片段，再缩减低相关材料和单项
长度；无法放下最小材料时返回 `insufficient-context-budget`/`noop`。

失败分类只读宿主结构化状态。不要扫描 `finishReason`、参与理由或终止自然语言里的
`api/tool/http/error` 关键词。正常讨论技术词、显式 `stay_silent` 和零外发不应自动变成
兴趣/厌恶证据；真实 timeout/API/tool/unknown/held 才标质量问题。

## 实施顺序

1. 冻结 event -> SQLite -> observer -> job -> prompt 的字段白名单和旧事件降级；
2. 消除 aggregate 中重复正文，添加有界选材和计量 helper；
3. 构造受限 `ReflectionInput`，只传角色必要身份、真实材料、当前 scope profile 和相关旧笔记；
4. 用真实请求构造测试断言正文、来源、确认回复和裁剪诊断存在；
5. 运行 A05/A06 和重启兼容测试。

## 验收

- 15/20 条接近单条上限的材料能形成合法 job；
- 同一正文不会在 payload 多次出现；
- 确认回复未被前 N 条截掉；
- 正常 API/tool 讨论、正常显式沉默不产生 `api_failure/tool_failure`；
- 真失败不形成自主偏好；
- 模型看到的 evidenceRefs 不引用被预算裁掉的正文；
- 旧事件安全降级，不回放全历史。

## 交付与回退

交付变更、payload 前后计数/字符、请求快照脱敏摘要和命令退出码。回退只关闭 Reflection
observer/worker，保留事件和正文；不得删除历史。
