# P1 Notebook Scope 边界

> 状态：planned。依赖：P0 account namespace。

## 目标

阻止聊天模型用 `scope=global` 扩大数据可见范围，保证 private/chat 信息不会跨群或跨账号召回。

## 已冻结契约

- 聊天工具默认写入 `scope=chat`。
- 聊天模型不能创建 global preference；global 只允许管理端、明确管理员授权或受控低风险系统写入。
- chat scope 必须绑定当前 `chatKey`，不能由模型传入其他 chatKey。
- global scope 绑定 accountId，只对同一账号可见。
- tags 只做过滤，不能改变 scope、account 或可见性。
- private/chat 信息不得自动升级为 global。

## 允许修改范围

- `src/plugins/builtin/self-evolution.js`
- `src/plugins/self-evolution/notebook-store.js`
- `src/plugins/self-evolution/index.js`
- 相关测试

管理端 API 与 UI 集成留给 P7；本卡只提供可复用校验和明确错误码。

## 实施要求

1. 聊天 append 忽略/拒绝 `scope=global`，返回可审计错误。
2. 管理端或系统写入必须显式声明 `actorKind`/授权来源。
3. search 强制过滤 `accountId`、`status=active`、scope 和当前 chat。
4. archive 保留历史但永不进入普通召回。
5. 统一 source lineage，记录 `accountId/chatKey/sessionId/runId/toolCallId`。

## 验收

- `private:A` 写入后，`group:B` 搜索为空。
- 同账号其他 chat 只能看到 global，不能看到 chat:A。
- 不同账号不能读写对方 global。
- tags 伪造、scope 伪造、chatKey 伪造均被拒绝。
- 归档后历史仍可审计但 search 不返回。

## 回退

停用新的 global 写入口，保留原文、版本和审计记录；不得硬删除或放宽读取范围。

