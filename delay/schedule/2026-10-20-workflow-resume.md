# Workflow显式Luna续做与线上更新（进行中）

2026-10-20，Asia/Hong_Kong。接续[69cd完整归档](2026-10-20-complete-work-archive.md)，用户明确改全局调度规则后继续开发/测试/验证/上线，不再询问。

## 已完成：全局规则与真实执行者调度

- 全局AGENTS已实际修改并重载：所有委派经workflow，每次agent显式model；禁普通subagent/fork和复用旧会话绕过。主协调者架构/方案/方向/最终验收职责不变。[新规则快照](../coordination-policy-2026-10-20-workflow.md)。
- 所有本轮调用均显式gpt-6-luna，后续并显式provider=codex-proxy；不是只在任务名写Luna。[调度记录](evidence/2026-10-20-workflow-resume/workflow-dispatch.json)。
- 首次调用在生成工具参数时达到32768输出上限，没有文件，保留FAILED/NO_ARTIFACT；不伪称完成。实际模型/提供方由授权事件元数据确认，不公开opaque replay数据。
- 收窄任务后Luna交付初稿；主协调者亲自阅读指出唯一性、准确调用断言和真实旧逻辑红例不足，给定返修要求后仍用显式Luna实现，不让执行者选设计。
- 最新[离线测试](../../test/production-embedding-cleanup.test.py)为114行：每份源4个unittest方法、18当前场景、2受控旧逻辑红例和1唯一性反例。Luna自测、主协调者独立复跑默认归档与真实本地稿均exit0，所选AST片段哈希一致。[实际结果](evidence/2026-10-20-workflow-resume/luna-fault-tests.json)。
- 第二个全新workflow以同一显式Luna只做限域独立复核，PASS；未代替主协调者上线裁决。[复核](evidence/2026-10-20-workflow-resume/independent-review.json)。

## 已重新核对的线上前提

04:01:59 +08只读状态仍059/Qwen、原PID、active/lifecycle、OneBot既有断连；三个记忆开关true，293条Notebook，Embedding尚未配置。无运行发布/锁/新备份。另查8679文件可读、0不可读、约16.6GB可用。没有在此阶段停止服务或启动索引。

69相对930的受控业务目录无变化；实际发布将固定本轮测试提交后的具体SHA，重新导出归档、校验业务142文件manifest、在隔离候选复验，不把旧revision标签复制成新代码证明。用户原有4B云端索引/费用授权仍适用，query=true/private=false，保留旧三个开关与供应商密钥绑定。

## 正在执行／尚未完成

按[既定计划](../../plan_doc/2026-10-20-workflow-luna-production-resume.md)进入备份和实际发布准备，待固定最终提交后生成并验证最终稿。发布成功前不能把本文当线上更新完成。真实QQ/SC8、协议端重装和更广B07/R06/B10语义验收不由离线故障测试关闭。
