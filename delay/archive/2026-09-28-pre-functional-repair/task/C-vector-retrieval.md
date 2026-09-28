# C SQLite 向量召回

状态：planned

依赖：`P0-baseline-and-vec-smoke.md`、`A-evidence-budget.md`

## 任务包

目标：用现有 SQLite + sqlite-vec 普通 BLOB 表 + 一个经验证的远端 embedding 接口替换
Notebook 的自制中文相关性检索；正文仍由 Notebook 权威保存。

## 允许修改/新增

- `src/plugins/self-evolution/embedding-client.js`
- `src/plugins/self-evolution/vector-memory.js`
- `src/plugins/self-evolution/notebook-store.js`
- `src/plugins/self-evolution/retrieval-provider.js`
- `src/features/retrieval.js`（删除/隔离被替代的中文 n-gram 语义路径）
- `src/plugins/builtin/self-evolution.js`
- 相关 migration、配置、管理端状态和测试

## 冻结契约

向量是可删除、可重建的派生索引，不是第二份正文。索引至少记录：

```text
account_id, note_id, profile_id, note_revision, input_hash,
embedding_dimension, vector, status, attempts, last_error, timestamps
```

普通 SQL 先过滤 account/scope/status/revision，再用 sqlite-vec `vec_distance_cosine()` 排序。
不部署向量数据库、不使用本地模型、不调用聊天完成接口伪造向量、不混用 embedding profile。

embedding client 必须验证条数、顺序、维度、有限浮点、非零范数、usage（无则 unknown）、
timeout/取消/有限重试，并只发送角色笔记正文及必要主题标签。配置不完整返回
`embedding-not-configured`，扩展不可用不影响 Notebook 读写和普通聊天。

所有写入入口都先保存正文，再创建可恢复索引任务；append/update/archive/rollback/revision
变更必须使旧向量失效。聊天自动召回、手动语义 `notebook_search`、反思相关旧笔记复用同一
召回服务；Learned Self 不做向量化。

## 实施顺序

1. 重新跑 P0 sqlite-vec smoke，锁定实际依赖版本；
2. 建普通 SQLite 表和可重复 migration；
3. 建唯一 embedding client/profile 校验；
4. 接写入索引任务和重建/失败状态；
5. 接三个召回入口，保留 scope/account 权限；
6. 更新 provider 超时、管理端状态和关闭/不可用降级；
7. 删除被淘汰的自制语义降级，不删除手动精确列表/读取 API。

## 验收

- 真 sqlite-vec 加载，正交/相同向量距离正确；
- 错维、NaN、零向量、错序、stale revision、归档晚到结果全部拒绝；
- 写入/索引/关闭/重启后正文和索引状态可恢复；
- 别账号、别群私聊、归档笔记不泄露；
- 旧的相关笔记不因“最近 100 条”失去候选资格；
- embedding 超时/扩展不可用时聊天继续、正文不丢；
- C05/C07/C08/C09/C10/C11/C12/C14 记录真实结果。

## 交付与回退

交付依赖版本、migration、profile 状态、重建命令、实际距离/排名和 `LIVE_NOT_RUN` 项。
回退关闭 vector provider，保留 Notebook 正文、版本和索引表；不得静默恢复自制语义路径。
