# P4 Reflection 调度与证据门槛

> 状态：implemented。依赖：P3 revision 契约。共享 worker 只保留一个写者。

## 目标

防止预算不足时立即重领 job 形成数据库空转，并阻止无效/失败行为被学成偏好。

## 已冻结契约

- 预算不足写入 `budget_blocked_until`，在下一周期前不可重新领取。
- 每个 observation window 最多一个 job；无新证据直接 noop。
- 观察门槛至少满足 N 个有效 Session，或存在明确行为变化证据。
- timeout、API/tool failure、未回复、没被叫到、unknown 外发不能作为兴趣/不感兴趣证据。
- completion provenance 默认是 `originKind=chat_run`；reflection/internal 来源不能进入 Reflection。
- worker concurrency=1，lease/generation/stop/late-result 语义保持 P6。

实现说明：

- `minValidSessions` 与 `observationWindowMs` 是 Reflection limits/config；默认值保持 P6
  的单 Session 行为（`1`、不做隐式时间聚合）。
- 达到门槛前的 completion 会保存在 `reflection_observations`；同一
  `(observation window, session)` 幂等，窗口最多创建一个 `reflection_jobs`。
- 预算阻塞按 UTC 日界限恢复；worker 的下一次 timer 会直接等待到该界限，避免轮询空转。

## 允许修改范围

- `src/plugins/self-evolution/reflection-store.js`
- `src/plugins/self-evolution/reflection-worker.js`
- `src/plugins/self-evolution/reflection-plugin.js`
- P6/P4 测试

## 验收

- 预算耗尽后 job 不会在同一周期重复 claim/model call。
- 同一观察窗口只产生一个 job。
- 失败有限重试，恢复后可继续。
- 无新证据无模型调用；无效证据不能产生 trait proposal。
- stop/disable 后无新调用，晚到结果不提交。

## 回退

停用 worker；保留 jobs、attempts、last_error、budget 和 audit，后续可恢复。
