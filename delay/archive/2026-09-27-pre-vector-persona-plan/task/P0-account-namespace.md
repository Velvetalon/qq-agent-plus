# P0 统一账号空间

> 状态：planned。依赖：P2 基线。前置于全部 Notebook/Retrieval/Reflection 集成。

## 目标

统一聊天工具、管理端和 self-evolution 数据使用的账号命名空间，消除 `default` 与 OneBot `selfId` 分叉。

## 已冻结契约

- 生产 `accountId` 唯一来源为宿主注入的 OneBot `selfId`。
- tool context、run context、Notebook source、Reflection job、Retrieval 查询必须使用同一账号值。
- 生产路径禁止工具自行回退到 `default`；`default` 只允许测试夹具或显式测试注入。
- accountId 不由模型参数、tags、正文或 HTTP query 决定。

## 允许修改范围

- `src/plugins/context.js`
- `src/core/orchestrator.js`
- `src/plugins/builtin/self-evolution.js`
- `src/plugins/self-evolution/notebook-store.js`
- 相关配置/测试文件

禁止修改 `Sender/Outbox`、lease/ack、Base Persona、认证语义。

## 实施要求

1. 在 Orchestrator 创建 run context 时注入 `accountId = String(onebot.selfId || '')`。
2. callback context 和受信任 facade 透传同一 accountId。
3. Notebook 写入校验 `source.accountId === host accountId`；缺失或不一致拒绝。
4. 管理端查询默认使用当前 OneBot selfId；无 selfId 时只能显式进入测试/只读 fallback，并在结果中标记 namespace。
5. 保留旧数据，不做隐式迁移；必要时提供只读诊断统计。

## 验收

- 聊天工具写入 SQLite 后，管理 API 用同一 selfId 能查到。
- account A 写入、account B 查询为空。
- 模型伪造 accountId 或 source.accountId 被拒绝。
- 旧 P2/P4 Notebook 与 P6 Reflection focused tests 无回归。

## 回退

关闭新 account 校验 facade，保留数据库和历史数据；不得把生产路径恢复为静默 `default`。

