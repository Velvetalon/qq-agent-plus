# 拟人群聊内核：WIP 全量交接

更新：2026-10-13（Asia/Shanghai）。已知可回退提交：059eba574a5e440fb9c385de5305f7afcc585a82。

## 0. 当前授权与发布状态

用户最新要求：把进度落实到 /delay，所有代码（包括未完成代码）提交并推送到自己的 GitHub 仓库，确保其他 Agent 可以接手。

**本交接所在提交是 WIP 保存点，不是功能完成或可上线版本。**本次允许进度文档、归档、语法/敏感信息检查、Git 提交推送；不恢复开发，不修代码，不运行生产清理，不部署、不解除禁言、不新增付费模型调用。

目标远端：origin = Velvetalon/qq-agent-plus，分支 main。上游 fork 不参与。本交接无法预写自身 commit SHA；用 git log -1 --format='%H %s' 获取保存点，提交主题为 wip(conversation): preserve social engine implementation and handoff。后续提交存在时，以该主题和本文件历史定位本次快照。

## 1. 接手阅读顺序

1. 仓库 [AGENTS.md](../../AGENTS.md)，计划归档在 /plan_doc。
2. [完整架构设计](../../plan_doc/2026-10-13-social-conversation-engine.md)。
3. [开发规划 SC0-SC8](../../plan_doc/2026-10-13-social-conversation-development-plan.md)。
4. [单元与主链验收标准](../../plan_doc/2026-10-13-social-conversation-acceptance.md)。
5. 本文的代码落点、已知差距、验证结果和下一步。
6. [历史 stash 归档说明](../archive/2026-10-13-pre-social-stash/README.md)。该旧补丁仅用于保全，不得直接应用。

完整中文设计是目标；代码是在更早、较窄契约下开始写的草稿，不得让现有实现反过来缩减 share/react、主动兴趣来源、经历/偏好分离等需求。

## 2. 当前工作状态

四个代码执行者 social_runtime、social_memory、social_scene_state、social_console 均已被中断，未重新拉起。其他机器不依赖这些 Agent 的内存状态；以 Git 中的文档、代码和本交接为准。

| 阶段 | 现状 | 尚不能声称 |
| --- | --- | --- |
| SC0 基线与契约 | 文档齐全，基线059eba5，草稿盘点完成 | 新旧契约已经全部一致 |
| SC1 事件和场景 | state.js、多话题与意图持久化、Manager v3字段草稿 | Orchestrator v3发射器已接通 |
| SC2 Planner/Replyer | 两阶段prompt、JSON校验、#runSocialAgent/#runSocialPhase草稿已落盘 | share/react、完整主链、工具无回归 |
| SC3 调度与有效投递 | guard、intent存储、旧social催话旁路关闭等草稿 | durable due意图已被正式ticker领取 |
| SC4 记忆 | note类型/channel、共享读取过滤和向量路径改动 | 污染分类无误杀、所有缓存失效、清理CLI已完成 |
| SC5 学习 | v3资格、独立来源池、trait与note拆开校验草稿 | 有效学习闭环、候选review、全局范围策略已验收 |
| SC6 管理面 | social配置、session审计、GET状态/取消待办、UI草稿 | 与完整新runtime的接口已经一致 |
| SC7 集成 | 有合成回放fixture和少量局部测试 | 完整引擎通过、拟人效果通过、CI必绿 |
| SC8 生产 | 本轮无任何线上操作 | 已部署/已清理/已解除禁言 |

## 3. 文件落点

| 文件 / 范围 | 当前作用 | 原执行者 |
| --- | --- | --- |
| src/conversation/state.js | SocialStateStore；话题、消息关系、观察版本、outcome、持久意图与guard | social_scene_state |
| src/conversation/runtime.js | Planner决定/意图JSON校验、两阶段工具过滤 | social_runtime |
| src/conversation/prompts.js | 参与规划与自然回应prompt，不沿用legacy固定气泡要求 | social_runtime |
| src/core/orchestrator.js | social模式入口、规划/表达循环、场景和sender接线草稿 | social_runtime |
| src/onebot/sender.js | 实际投递前的beforeSend宿主回调 | social_runtime |
| src/plugins/context.js | 受限sender facade、回调保护与实际外发记录 | social_runtime |
| src/plugins/manager.js | v3字段与来源角色转交；不能自行猜用户确认 | social_memory |
| src/plugins/builtin/self-evolution.js | Notebook工具来源接线草稿 | social_memory |
| src/plugins/self-evolution/notebook-policy.js | experience/preference_candidate/operational分类及可召回策略 | social_memory |
| src/plugins/self-evolution/notebook-store.js、vector-memory.js | 加性类型字段、读写和向量召回过滤 | social_memory |
| src/plugins/self-evolution/reflection-store.js、reflection-worker.js | 拆trait门槛与笔记提交、来源池、单独拒绝记录等草稿 | social_memory |
| src/core/config-legacy.js | social第四种模式及有界参数；旧模式默认不变 | social_console |
| src/core/sessions.js | 精简socialAudit序列化 | social_console |
| src/console/app.js | 社交状态GET、受保护意图取消接口 | social_console |
| ui/app.js、ui/style.css | 设置选项、会话审计和待办列表 | social_console |
| test/social-state.test.mjs | 已落盘的状态模块用例 | social_scene_state |
| test/social-console.test.mjs | 管理接口用例草稿 | social_console |
| test/fixtures/social-replay.json | 合成对话材料，不是实际模型回放结果 | 协调者 |
| plan_doc、delay索引/交接、AGENTS.md | 设计、规划、验收、归档约定 | 协调者 |

尚不存在：test/social-runtime.test.mjs、test/social-memory.test.mjs、scripts/notebook-memory-cleanup.mjs；文档提到这些是计划路径，不要当成已有入口。

## 4. 已知未完成接线与设计差距

以下为只读检查结果和接手优先项，不是完整代码审查：

1. Orchestrator 的成功及失败完成事件仍有 evidenceVersion:2。Manager已经能够保留v3字段，但只有下游支持不等于主链发射了v3。需要贯通 triggerKind/proactive/sourceRecordType/originalSourceId/interactionId/topicId/delivered，不能在测试fixture里手填后宣称接线完成。
2. 目前runtime动作集合只有 reply/listen/wait/close，使用单个 targetMessageId；最终设计还要求 share/react 和合理的多目标关联，主动分享不能伪造被回复消息。
3. validateSocialInitiative目前只接受本批 humanMessageIds。最终设计允许宿主记录的外部新观察/共同兴趣来源，这部分还没有实现。
4. state.js提供 claimDue，但当前Orchestrator没有调用claimDue的正式领取路径。social旧follow-up/pacing/proactive路径已部分旁路，不能因此把“没有任何主动行为”当目标达成。
5. MaterialRef版本、材料epoch、正在生成的草稿因记忆归档而失效、有限重规划仍需逐条核对。不要把当前只检查topic新消息的guard当成完整材料失效机制。
6. getSocialStatus在未选择social时仍返回 snapshot:null，即使存在历史表；最终设计要求停用可读历史。还需审查create:false和cached state是否会造成GET初始化。
7. 已有代码仍在Orchestrator增加较多逻辑。恢复时应按设计抽离清楚的运行组件，不仅为减少行数而抽象，也不能继续把全部社交逻辑堆在原大循环。
8. 记忆分类曾因简单模式误伤未来愿望/技术讨论，虽已进行一轮调整，当前未完成反例验证。技术错误码历史描述与自我运行脚本必须区分，不能以黑名单作为唯一判据。
9. 反思trait拒绝不能使合法episode失败；validateReflectionOutput被worker与store重复调用的归一化字段兼容、单独拒绝的持久审计、默认参数下三次独立来源候选需要真实worker验证。全局候选当前采用保守拒绝路径，不能宣称跨群晋升已完成。
10. 新增state表的已发送未回应预算、话题引用ID、pending/leased/held恢复、取消竞态和过期后的新来源主动性均需要主链验收；局部4个测试仅覆盖其中一部分。
11. 既有回归测试可能仍假设v2/auto-apply旧语义，需要在新契约下正确更新fixture与期望，不得以兼容测试为名保留生产资格绕过。当前未跑完相关回归。
12. 正式管理端候选审核、清理工具、迁移与回退文档属于后续阶段；本次推送只保全草稿，不运行它们。

## 5. 验证账本

可用运行时：Node >=22.13；本机使用 v24.19.0：
C:/Users/v_whcnwwang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe。
其他机器应选自己的兼容Node，不要求照搬Windows路径；本机PATH Node16不适用。

| 时间点/检查 | 结果 | 范围与限制 |
| --- | --- | --- |
| 开发前基线focused五文件 | PASS 55 | orchestrator、p3-active-silence、longtime、learned-self-evidence-gate、learned-self-policy |
| 状态草稿单元 | PASS 4 | social-state；未验证真实模型/完整发送链 |
| 配置及迁移 | PASS 12 | config/config-migration；不是新模式运行验收 |
| render中间执行 | PASS 134 / FAIL 1 | 当时notebook-store重复query变量导致import失败；执行者后来修正，未最终重跑 |
| 本次WIP保存前Node --check | PASS 19文件 | 修改/新增JS/MJS全部可解析；不证明可运行或逻辑正确 |
| 敏感内容模式扫描 | 常见凭据/私钥模式0命中 | 仅变更新增行、未跟踪文本和旧patch；不是绝对泄漏保证，仍执行路径范围检查 |
| git diff --cached --check | WARN，退出码1 | 归档patch三处空白上下文行和文档末尾空行；保持旧补丁字节级一致，未为消除告警修改代码；不是语法/功能验收通过 |
| 主链测试、真实模型回放 | NOT_RUN / LIVE_NOT_RUN | social-runtime/social-memory专项文件尚未创建 |
| 生产修改/部署/解除禁言 | NOT_RUN | 本轮未操作线上 |

推送main将触发现有CI测试；当前WIP不保证CI通过。ci.yml没有自动部署步骤；release.yml仅v* tag触发，本次不推tag、不发Release。

## 6. 其他机器接手步骤

1. 拉取 Velvetalon/qq-agent-plus 的本次WIP保存点，先阅读 /delay/README.md 和本文。
2. 确认用户是否已允许恢复开发；本次保存点本身不撤销“先停代码”的要求。
3. 用git status/log确认本地新增改动，勿直接覆盖；阅读三份plan_doc并从SC0做契约差距盘点。
4. 优先完成v3真实发射、动作集合、due意图正式ticker、Planner/Replyer发送边界，再整理记忆反思和管理面接线。不要从头重写已有底座，也不要将半成品直接部署。
5. 运行临时DATA_DIR下的focused语法/测试，记录具体失败；修复必须保持Sender未知投递与消息lease/ack契约。
6. 按阶段记录实际PASS/FAIL/NOT_RUN，补上social-runtime/social-memory真实主链用例和轻量拟人回放，不能只追求全静默或空profile。
7. 所有凭据、生产配置、完整日志/聊天不在本仓库。生产访问走用户另行提供的私有运维包；公开交接不依赖该包中的原始聊天内容。
8. 真正上线前单独确认部署、数据清理、运行模式与禁言操作；不要把GitHub推送等同于线上更新。

## 7. 历史未完成代码保全

旧stash 4acd836b64734e1f208a7cdb1a9d8e1fb7a90bd0，基线b1c3a682d7eebe7a8ed80747375b2f5839901dfd，仅修改reflection-store.js。

该stash已机械导出为 ../archive/2026-10-13-pre-social-stash/reflection-store.partial.patch，本地原stash保留。它属于059eba5之前的早期LSR局部尝试，与当前代码冲突，不能直接应用；保留目的是跨机器不丢历史工作。

## 8. 完成界限

本次完成条件仅为：进度文档和所有当前项目代码（含未完成项）可从GitHub取得，私有/运行数据没有被加入，HEAD与origin/main同步。完整开发目标仍未完成，状态保持等待用户后续指令。

