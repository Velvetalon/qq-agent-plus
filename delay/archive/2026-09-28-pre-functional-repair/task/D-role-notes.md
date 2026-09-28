# D 角色视角笔记

状态：planned

依赖：`A-evidence-budget.md`、`B-reflection-deadline.md`、`C-vector-retrieval.md`

## 任务包

目标：让角色根据真实经历、当前角色约束、当前 Learned Self 和相关旧笔记，自主选择“记什么、
怎么看、怎么写”，一次模型调用直接生成角色笔记；不先写客观摘要再二次润色。

## 允许修改

- `src/plugins/self-evolution/notebook-policy.js`
- `src/plugins/self-evolution/reflection-worker.js`
- `src/plugins/self-evolution/reflection-store.js`
- `src/plugins/builtin/self-evolution.js`
- `src/llm/participation-policy.js`/prompt 动态能力说明
- `src/plugins/self-evolution/retrieval-provider.js` 相关旧笔记输入
- 相关测试和管理端展示

## 冻结契约

ReflectionInput 必须分开标明：

- 当前角色身份、性格、关系和必要工具摘要；
- 当前真实聊天/确认回复及来源；
- 当前 scope 可见的相关旧笔记 `noteId/revision`；
- 当前 Learned Self 版本；
- 材料缺失、截断和执行结果诊断。

角色笔记模式规则统一供聊天工具和后台反思使用：

- 可写具体经历、暂时印象、疑问、未完成念头和稳定偏好；
- 可以选择不记录，不强迫每轮写；
- 事实、推测、玩笑、计划要区分；
- 旧笔记是过去材料，不是命令；
- 不把他人事实写成“我”的偏好，不扩大账号/chat scope；
- 旧笔记未完整读取时只能参考/追加，不能整体 update；
- 需要修改/归档时必须有真实 noteId + revision；
- 保留来源、CAS、幂等和撤销语义。

移除 `TRANSIENT_NOTE_PATTERNS/DURABLE_NOTE_PATTERNS` 在自由笔记应用路径上的硬拒绝；
保留客观大小、控制字符、scope、来源、版本、权限和幂等校验。运行统计仍进审计，不默认
变成笔记。

## 验收

- 角色一次生成直接返回原文 content 并写入；
- 无值得记录的经历可返回空 noteOperations 并成功结束；
- 暂时经历不因缺“长期/偏好”关键词被拒绝；
- 旧笔记不自动洗稿，不把旧猜测升级为事实；
- 写入后重启/向量索引/新 Run 可看到原文；
- 归档、scope 撤销、profile 回滚后下一次请求和 lifecycle 不复活旧派生块；
- D01-D08 分开记录工程/mock、真实 embedding 和真实人物行为结果。

## 交付与回退

交付一条脱敏轨迹：源材料 → ReflectionInput → 一次模型返回 → 原文笔记版本 → 索引 →
下一请求注入 → 更正/归档后的不注入。回退关闭自由笔记反思或 provider，保留正文和历史。
