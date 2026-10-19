# Workflow显式Luna续做与线上更新结果

2026-10-20，Asia/Hong_Kong。接续[69cd归档](2026-10-20-complete-work-archive.md)，用户要求改全局规则后继续开发/测试/验证/线上更新，不再询问。**本轮代码和获准配置已实际上线；不能据此关闭真实QQ或完整语义验收。**

[最终脱敏证据](evidence/2026-10-20-workflow-resume/production-result.json)、[主协调者计划](../../plan_doc/2026-10-20-workflow-luna-production-resume.md)。

## 1. 全局规则及实际Luna执行

全局AGENTS已修改、重载：所有执行者必须workflow，每次agent显式model；禁普通subagent/fork及复用旧会话绕过，主协调者需求/架构/路线/优先级/最终验收职责不变。[新规则快照](../coordination-policy-2026-10-20-workflow.md)，全局文件SHA256为`9cbce55322080c4440a9d1da8f1637cf57831e31998c5e2066c6faec5b16fadf`。

所有本轮workflow调用都显式gpt-6-luna，后续显式provider=codex-proxy。[调度实录](evidence/2026-10-20-workflow-resume/workflow-dispatch.json)：
- 首轮实际模型/提供方由授权事件元数据确认，但生成工具参数到32768输出上限，无文件，保留FAILED，不当完成、不公开opaque replay。
- 紧凑初稿落盘后，主协调者亲自指出唯一性、准确路由/请求体/顺序、清理确认及真实旧逻辑红例不足；给定返修方案后仍显式Luna实现。
- 最终[测试实现](../../test/production-embedding-cleanup.test.py)：每源4个unittest方法、18当前场景、2旧逻辑红例、1唯一性反例。Luna自测及主协调者对归档/实际稿复跑均exit0，AST片段哈希一致。[数据](evidence/2026-10-20-workflow-resume/luna-fault-tests.json)。最终更换发布metadata后再复跑，[仍通过](evidence/2026-10-20-workflow-resume/final-worker-fault-tests.json)。
- 新workflow明确同模型做限域独立复核，PASS；没有让执行者决定架构或上线。[复核记录](evidence/2026-10-20-workflow-resume/independent-review.json)。

## 2. 实际发布的源码及目标Linux门禁

- **生产revision：`91beebbcc3a99e725b5f35ac97245a80ca1195ea`**。包版本仍0.6.18，必须看revision/源码哈希，不凭版本字符串断言已更新。
- 从已推GitHub提交重新导出3139915字节归档，SHA256 `6725e3d1ed4d76fa3bb9af5704aca628ae1a9050e67fc9dbce66ff8dd16146a8`；未含未跟踪备忘/生产数据/依赖。
- 142受控业务文件manifest SHA256 `afca77f6d8e867c64498bd6bf7a5eb0db9b84764653b1cbf68c817faf055f7f3`。与930已测代码相同，但仍对91be实际候选重新验证。
- Node22.23.2、独立HOME/XDG/data及非本地网络拦截：**852/852 PASS，0 FAIL/CANCEL/SKIP**；280语法/strict scan/local/prompt/render/scroll/usage/sqlite-vec全部exit0；新增Python故障测试在目标Linux也exit0（4方法）。
- 最终服务用户ubuntu/uid1000、原安装/数据/Node/console绑定保留；142文件对当前安装逐项SHA相符，mismatch=0。

## 3. 备份、一次失败与已验证恢复

先保留原3历史快照，停服务后保存应用、配置、单元及全部业务数据。messages.sqlite使用SQLite backup API，并双侧quick_check，其他业务持久项在静止时复制。原快照不因部署轮转丢失。

正式deploy.sh已成功替换代码和生成91be revision；随后第一条配置API触发selfEvolution重载，因拿不到OneBot selfId返回HTTP500。外层安全停供，**原失败记录保留**。主协调者确认源码/权限/密钥未变、索引未启用后恢复新代码服务，未重复发布、未覆盖迁移数据或回滚到旧代码。

原因/恢复：
- OneBot更新前就断连，live get_login_info仍连接重置；容器running、原3000/3001映射无误。未改/重启/重装协议容器，也未登录QQ。
- 只读交叉核验得到唯一per-account协议配置，HTTP/WS端口和令牌均与Agent匹配；唯一数字Notebook账号与该配置相同，无其他命名空间。
- 据此只补Agent的已配置onebot.selfId，保持所有端点/令牌及Note.account_id不变。不是猜QQ号、不是换账号，也不把“配置账号已确认”当实时登录成功。真实QQ号只留服务器私有记录，不入Git。
- 现有API随后成功保存聊天/审核/Embedding配置并重载，实际4B固定文本验证成功。恢复成功记录与原FAILED分开，当前总状态SUCCESS，不倒改失败日志。

服务器备份/运行路径：

```text
安装 /mnt/data/qq-agent/app
数据 /mnt/data/qq-agent/data
用户服务 qq-agent-linux.service
维护 /home/ubuntu/qq-agent-maintenance-20261020-cd1c4beb
原应用 application-backup
一致业务 data-backup
原配置 original-config.json
原单元 units-backup
原3历史快照 prior-deploy-backups
实际候选 validation-91beebbcc3/source
```

这些材料权限保持私有，不入Git。需要回滚时先停供、检查迁移与新外部效果，不能把原数据快照直接覆盖当前业务状态或用旧码打开不兼容数据。

## 4. 最终线上验收（05:05:22 +08）

- 服务active/running/enabled，ExecMainStatus=0、NRestarts=0；health ok。
- runtime active/paused=false、lifecycle、allow/deny/blocklist/时控、console及模型供应商/密钥绑定保持；旧记忆/检索/反思三个开关保持true。OneBot只增加经验证的已有selfId元数据，不改凭据/端点。
- **聊天：NanoGPT deepseek/deepseek-v4.1-flash-1017，thinking on，fallback false，review2048/45000。** 生产凭据单次64-token上限固定文本请求HTTP200、准确返回同模型、finish=stop、OK，报告23tokens，约1.282秒。返回cost=0 USD不保证最终账单0，没有真实聊天/笔记输入或QQ发送。
- **Embedding：Qwen/Qwen3-Embedding-4B / 2560，enabled/configured=true，state=verified，query=true/private=false，timeout60000。** 线上固定文本EMBEDDING_PROBE_OK，约14.56秒；sqlite-vec0.1.9可用。
- live与一致备份SQLite均quick_check=ok；消息9904、outbox54、线程2前后一致，Notebook293保留。完整笔记行摘要在派生队列操作前后相同。
- **OneBot仍为更新前已有断连。** 不宣称已登录QQ、可真实投递或SC8通过；未主动QQ测试，未测量线上总发送量。

## 5. 为什么现有就绪向量仍0

启用/改profile只启动worker，不自动把旧笔记回填新profile。用户已允许符合策略的旧笔记索引，主协调者在不改主记录条件下复用owner公开入口：NotebookStore只读get、isRecallableNotebookNote、EmbeddingClient.authorizeNote、queueEmbedding，一次事务上限500；跳过已有当前profile job，不重置lease/attempt。

实际293条：**47条归档/不满足召回，246条可召回但属于chat私域，按用户选择allowPrivate=false禁止外发。0条允许排队**，所以ready/pending/failed/total均0。排队操作自身发出模型请求0，未改正文、revision、scope、账号或降低策略。

**4B配置与后端验证通过，不等于293条已上传或新模型完整记忆链通过。** 不制造假笔记/假向量，不为完成数字自动改allowPrivate。后续如有明确允许的公开笔记，会按该profile正常索引；当前隐私保护继续生效。

## 6. 仍开放的范围

- OneBot现有登录/连接问题；当前仅从已有配置确认账号，不是实时协议登录/QQ端到端验证。
- B07视觉新增性、R06/B10更广语义矩阵、DeepSeek完整chat→reflection→4B→新会话召回、适用浏览器与真实QQ/SC8验收。
- Windows既有44平台/夹具失败未修，不能用目标Linux852全过倒改历史。
- 新观察到通用config的selfEvolution失败回滚采用深合并，首次500后新增timeout字段仍保留；恢复配置已符合用户目标，但“精确回滚对象/原始存在性”仍需专门修复与回归。本轮清理故障测试只覆盖部署者的Embedding专用API异常块，不能冒充覆盖这一更广问题。

本轮用户要求的全局调度、Luna实现/自测/复核、实际代码更新及获准配置已落实；仍开放项不因上线或提交归档自动关闭。后续按已收到指令直接执行必要操作，不再发确认问题。没有tag/Release、上游操作、私密笔记外发或原始数据/凭据进入Git。
