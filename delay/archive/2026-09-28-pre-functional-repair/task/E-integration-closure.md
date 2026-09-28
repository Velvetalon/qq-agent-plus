# E 跨工作包闭环验收

状态：planned

依赖：P0、A、B、C、D 全部完成

## 任务包

本卡不新增业务功能，只验证 A-D 在真实装配、SQLite、PluginManager、Notebook、Reflection、
Retrieval、Learned Self 和 Orchestrator 路径中共同工作。

## 必须覆盖

1. P0 smoke 和依赖安装/回滚。
2. A01-A07：证据去重、预算、来源、正常沉默、真实失败、旧事件兼容。
3. B01-B06：超时、lease、attempt、队首清理、晚到结果、预算退避、stop/restart。
4. C01-C14：sqlite-vec、profile/revision、所有写入口、权限、旧笔记、超时和禁用。
5. D01-D08：角色笔记原文、空提案、自由写作、旧笔记、撤销和回滚。
6. 三种 conversation mode、账号/scope 隔离、Sender/Outbox、stay_silent、ack 回归。

## 真实闭环轨迹

至少保留一条脱敏轨迹：

```text
QQ 源材料/确认回复
→ canonical evidence
→ ReflectionInput
→ 一次角色笔记模型输出
→ Notebook revision + vector index
→ 重启
→ 语义召回
→ 下一次 user prompt 实际注入
→ 更正/归档/回滚
→ 新 Run 和 lifecycle 不再注入旧派生材料
```

另保留一条：

```text
超时 → 有限重试 → attempts exhausted 终态
→ 下一正常 job 成功
```

## 验收与报告

- 工程通过、真实 embedding 语义通过、真实人物行为通过必须分开；
- mock 的模型/embedding/OneBot 只覆盖外部边界，不能复制业务逻辑；
- 没有凭据的真实项目标 `LIVE_NOT_RUN`；
- 报告所有命令、退出码、运行时版本、schema/migration、残余风险和回退；
- 未经用户授权不推送、部署、付费 backfill 或发 QQ 测试消息。

## Definition of Done

- 可靠经历能变成角色笔记并在未来被找到；
- 反思能结束且不忙循环；
- 向量索引失败不阻塞正文和主聊天；
- 关闭、归档、更正、回滚都不复活旧派生材料；
- 相关测试和验证文档完成。

## 回退

按模块关闭 self-evolution/retrieval/reflection/vector index；保留正文、版本、jobs、audit；
不得删除历史或自动重试未知外部写入。
