# P3 Learned Self Revision

> 状态：planned。依赖：P4 Notebook、P5 Reflection store 契约。

## 目标

修复 Reflection Worker 固定使用 `expectedProfileRevision=0` 的 CAS 断链，让 Learned Self 能连续版本更新。

## 已冻结契约

- 每次任务开始主动读取 `learned_self_heads`，按 accountId/basePersonaHash 获取真实 currentRevision。
- currentRevision 是数据库运行状态，不由 config 的 `basePersonaHash` 或固定 revision 推断。
- Base Persona hash 用于提案失效校验，不是 Learned Self revision 的来源。
- profile version 必须记录 parent、evidence、base persona hash、applier、时间和 diff。
- 旧提案遇到 Base Persona 变化、人工编辑或 CAS 不一致时失效，不得覆盖新版本。

## 允许修改范围

- `src/plugins/self-evolution/reflection-worker.js`
- `src/plugins/self-evolution/reflection-store.js`
- `src/plugins/self-evolution/reflection-plugin.js`
- P6 reflection tests

## 验收

连续执行两个合法 reflection job，profile revision 必须从 0→1→2；并发旧提案只能一个成功，另一个返回 stale/CAS conflict；rollback 产生新的可追踪版本且影响后续 learned context。

## 回退

停用 reflection worker，保留 profile/version/audit 表；不得删除已生成版本。

