# PR4 角色笔记与控制台封口

## 目标

保持角色视角笔记语义，统一完整正文/摘录/更新契约，并让控制台显示真实索引状态、失败原因和恢复入口。

## 范围

- 不新增二次润色调用，不强迫每轮写笔记，不把暂时判断升级为固定性格。
- 旧笔记更新必须先取完整正文和 revision；摘录不足时不得整体覆盖；CAS 冲突重新读取。
- 控制台区分 enabled/effective/running、profile/coverage、pending/retrying/blocked/failed、最近召回/反思及有界恢复。
- 迁移/重启/回退读取真实部署文档，SQLite/WAL 用一致性备份；普通聊天和正文读写在向量不可用时继续。

## 验收

- 写入→重启→召回→反思→更正/归档闭环使用当前原文，不复活旧派生版本。
- UI 恢复操作真实改变任务状态，密钥不出现在状态/URL/日志。
- 真实模型/embedding/人物行为没有运行时标记 `LIVE_NOT_RUN`，不得用 mock 冒充；保存 `docs/verification/vnext-functional-repair-pr4.md`。
