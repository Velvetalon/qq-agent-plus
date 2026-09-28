# PR3 反思证据预算

## 目标

修复较长合法聊天在归一化/聚合阶段直接失败的问题，并保持已实现的 deadline、租约余量和耗尽重试终结。

## 范围

- 入队前两级持久化裁剪：原始事件预算和聚合观察预算，保留来源、角色、确认回复和关键问答。
- 最终模型请求按剩余 deadline/tokens 再裁剪；不可缩减输入进入明确 noop/diagnostic，不循环重投。
- 不把工具失败、unknown 外发、取消、预算耗尽或未触发误学成“不感兴趣”。

## 验收

- 15/20 条较长消息经真实 completion event/SQLite/observer 形成合规 job。
- 最终请求不超过配置预算且保留关键证据；超限有明确终态并正常 ack 聊天。
- 正常 API/tool 对话和主动沉默回归通过；保存 `docs/verification/vnext-functional-repair-pr3.md`。
