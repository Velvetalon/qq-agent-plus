# P2 生命周期与三个扩展点

> 状态：planned。依赖 P0、P1；框架契约冻结后，P4/P5 的独立存储工作才可并行。

## 目标

接通 `declare/start/stop`、generation、窄 services/runContext、ContextProvider、SessionObserver 和可靠运行完成事件；迁出 runtime-control、messaging、memory-tools，其余工具暂留 Legacy。

## 必须实现

- 启动前只声明，不建库、不起 timer、不发请求；启动失败原子回滚注册项和资源。
- 停用顺序为阻止新调用、generation 失效、取消异步任务、有限 drain、释放资源。
- provider 失败/超时降级，不拖垮聊天；共用预算并返回来源与 diagnostics。
- 在现有 ChatStore 完成确认/生命周期提交事务中写入完成事件；observer 至少一次投递并幂等消费。
- 硬停用实时拒绝旧 Run 的副作用，晚到写入不能提交；不重放已 ack 的 QQ 入站消息。
- 通过测试专用 probe 插件走真实 composition root。

## 非目标与硬约束

- 不建设通用消息总线、命令 DSL、插件市场或第三方代码沙箱。
- 普通插件不能拿 onebot、完整 store、任意文件路径、token 或任意群号；messaging 必须绑定当前 chat/run。
- 不宣称 ChatStore 与插件库具备分布式事务。

## 允许的自主决策

可选择完成事件表名（`extension_events` 或 `run_completion_events` 二选一）、worker 结构、provider 裁剪算法和迁出文件边界；不得变更事件字段、幂等键、generation 语义和现有提交原子性。

## 验收

- 未启用插件时无自有 DB、timer、模型请求或上下文注入。
- start 中途失败无半注册项；stop 后无新副作用。
- provider 故障有 degraded 审计，聊天继续。
- observer 重投不会重复插件记录，也不会重放 QQ 消息。
- 至少一个真实原有工具已从 Legacy 清单迁出且只归属一个 owner。

## 回退

保留旧工具出口和 ChatStore 读取兼容；关闭可选插件后主聊天仍能启动，完成事件积压可标记过期但不得删除原消息。
