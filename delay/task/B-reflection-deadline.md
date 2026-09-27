# B Reflection deadline、lease 与有限重试

状态：planned

依赖：`P0-baseline-and-vec-smoke.md`、`A-evidence-budget.md`

## 任务包

目标：反思任务可以超时收尾，过期作业不会绕过尝试上限，坏作业不会挡住队首，晚到结果不能
覆盖新 lease。

## 允许修改

- `src/plugins/self-evolution/reflection-store.js`
- `src/plugins/self-evolution/reflection-worker.js`
- `src/plugins/self-evolution/reflection-plugin.js`
- 相关 migration、测试、状态 UI/验证文档

## 冻结契约

任务总预算必须覆盖：

```text
输入准备 + 相关笔记读取/向量查询 + 反思模型 + 提交/错误收尾
```

`job lease >= 总预算 + 收尾余量`，`worker lease >= job lease + worker 余量`。每个领取有唯一
attempt token；提交/失败/延期必须检查 jobId、状态、owner、generation、attempt token 和
deadline。不能用 `Promise.race` 包住不可取消的同步 SQLite 查询来假装可中断。

`claimNextJob()` 在短事务内：

1. 先把已过期且 `attempts >= maxAttempts` 的 leased job 标记为终态 failed，并记录
   `REFLECTION_ATTEMPTS_EXHAUSTED`；
2. 其余过期 leased 受控恢复；
3. 新领取要求 `attempts < maxAttempts`，每次只增加一次；
4. 跳过终态/耗尽 job。

日预算沿用 `budgetBlockedUntil`；429/临时网络故障有限退避；401/403/配置/维度错误暂停并
记录原因；stop/disable 必须取消请求和 timer。

## 验收

- 第一次模型超时后有限重试；
- 达到 maxAttempts 后 job 终态，不再 claim；
- 队列后续正常 job 能继续；
- 第一轮晚到结果不能覆盖第二轮 lease；
- 日预算阻塞期间无忙循环；
- stop、重启、generation 变化后无晚到提交。

## 交付与回退

返回状态转换、时钟/mock 证据、job/worker audit 摘要。回退停用 worker，保留 attempts、
last_error、budget、audit；不得清零重试。
