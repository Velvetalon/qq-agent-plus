# 当前工作交接入口

## 当前状态：拟人群聊内核 WIP，开发暂停

2026-10-13 用户要求将全部代码（包括未完成代码）和进度提交到自己的GitHub仓库，便于其他Agent接手。此保存点不是可上线版本，尚未完成主链和真实模型效果验收。

先读 [完整交接](schedule/2026-10-13-social-engine.md)，再读：

1. [完整架构设计](../plan_doc/2026-10-13-social-conversation-engine.md)
2. [开发规划 SC0-SC8](../plan_doc/2026-10-13-social-conversation-development-plan.md)
3. [单元与闭环验收标准](../plan_doc/2026-10-13-social-conversation-acceptance.md)
4. [任务索引与历史记录](task/README.md)

已知可回退基线为059eba5。本次WIP主题为 wip(conversation): preserve social engine implementation and handoff；精确SHA以Git提交历史为准。

关键未完成：Orchestrator仍有v2完成事件、share/react与外部观察意图未实现、due意图ticker未接通、记忆反思与发送有效性闭环待验收、social-runtime/social-memory专项用例和清理CLI未完成。

代码执行者已停；接手需用户恢复开发指令，不自动修代码或部署。现有main CI可能因半成品失败，必须如实处理，不为保绿跳过测试。生产运行模式、禁言、配置与数据未改动。

旧的局部未完成LSR代码已作为 [仅供参考的patch](archive/2026-10-13-pre-social-stash/README.md) 保全，不能直接应用到当前代码。
