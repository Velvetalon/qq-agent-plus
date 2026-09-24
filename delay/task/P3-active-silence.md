# P3 主动沉默与统一终止

> 状态：planned。依赖 P2；完成后可独立发布“少抢话”。

## 目标

实现 `stay_silent` 和统一终止屏障，让模型可在不外发的情况下结束本轮，并在三种会话模式、原生/内联工具格式和调度器开关下保持一致审计语义。

## 必须实现

- `stay_silent` 参数严格校验：reasonCode、可选短 reason、threadDisposition；终止权只由宿主控制结果判定。
- 批次预检先于任何副作用：终止动作必须最后且至多一个；终止后调用、双终止、同批外发冲突全部拒绝并保留每个 tool_call 结果。
- `notebook_append + stay_silent` 合法；`send_message + finish` 保持兼容；先前已外发或 unknown 不能被改写成主动沉默。
- 覆盖 face、表情、拍一拍等外部可见效果；保留 unknown/held 人工核对语义。
- 新增结构化 participation、termination、outbound 摘要，进入 session 持久化、summary 和 SSE；不修改管理员已保存 roleText。
- 以唯一 `participation-policy.js` 清理“必须回/补话/强行追问”冲突提示。

## 非目标与硬约束

- 不额外调用 LLM 决定是否沉默，不强制沉默比例，不发送“我不说话了”。
- 不改变 Trigger Policy、消息 lease/ack、Sender/Outbox、独立唤醒和未来任务语义。
- 沉默不刷新 lastAgentAt、不造 self message、不清掉批次外新消息。

## 允许的自主决策

可选择 action-control 内部状态机、错误码、审计字段布局和 UI 展示细节；reasonCode 枚举、批次规则、外发分类和兼容旧状态不可改。

## 验收

- 只调用 `stay_silent`：零 OneBot 外发，准确 ack，结果为 `explicit_silence`。
- 终止后的 handler 调用次数为零；跳过调用仍有对应结果。
- 已发送、发送失败或 unknown 均不被标成主动沉默。
- 三种会话模式无已读重放；调度器开/关安全规则相同。
- P0 回归通过，真实模型评估与 mock 控制流测试分开记录。

## 回退

保留旧 `done/noreply/error/aborted` 兼容字段；可关闭显式沉默能力，但不能删除审计字段或放宽终止屏障。
