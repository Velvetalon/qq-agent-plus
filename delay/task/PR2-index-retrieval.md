# PR2 独立索引与纯查询

## 目标

让正文先可靠保存，索引由唯一后台消费者有限重试和恢复；自动召回、手动搜索、Reflection 共用纯查询路径。

## 范围

- 沿用 `notebook_embedding_jobs`，补齐原子领取、lease、attempt/profile/revision/hash、blocked/obsolete/终态。
- Notebook 生命周期唯一拥有 index worker；搜索和 Reflection 不 drain 文档索引。
- semanticSearch 只读 ready 向量，统一 NoteHit；无 ready 候选时不发 query embedding；保留账号/scope/current revision 过滤。
- 覆盖重启、取消、停用、网络失败、401/403、429、编辑/归档、切 profile、补建预览/幂等。

## 不做

不引入通用队列、Redis、向量数据库、本地 embedding 模型或自制中文分词回退；不修改已发送聊天。

## 验收

- embedding 请求挂起时 `notebook_append` 先返回 saved/pending。
- 无新聊天时后台可推进允许任务到 ready；首次失败后有限退避恢复。
- 有积压时搜索只产生 query 请求，不产生 document 请求。
- 两连接抢同一任务只有一个有效提交；旧 lease/profile/revision 结果被拒绝。
- 三个入口字段和权限一致，保存 `docs/verification/vnext-functional-repair-pr2.md`。
