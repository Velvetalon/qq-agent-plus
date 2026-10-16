# 当前开发进度：2026-10-16 远端代码审计

仓库：[Velvetalon/qq-agent-plus](https://github.com/Velvetalon/qq-agent-plus)。审计日期：2026-10-16 UTC。
代码基线：[2be4bccce643d4d40bdc4472e5703f3a109aac2e](https://github.com/Velvetalon/qq-agent-plus/commit/2be4bccce643d4d40bdc4472e5703f3a109aac2e)。
文档分支：`docs/progress-audit-20261016`，基于该 main 创建；**本报告不代表已合并 main**。

**结论：Social 与 Self-Evolution 已有大量远端实现，但整体仍是未完成 WIP；Notebook 提示词边界回归没有完成，Social 全套验收也没有完成。** 本次仅审计及交接，没有改业务代码、测试断言、依赖锁、运行配置或旧证据，没有部署、生产访问、付费调用或QQ发送。

本文件是当前唯一进度裁决入口。旧 `schedule/`、任务卡和 `docs/verification/` 的完成声明只代表各自日期和范围；不要把它们与本次结果并列成多套“当前状态”。

## 阅读与覆盖

1. [200条规划→实现→测试→状态矩阵](audit-20261016-matrix.md)：Social 91、功能修复T 28、历史向量VP 35、SC/F/PR/LSR 24、归档任务卡22。条目有重叠，不能换算为完成率。
2. [本次命令、退出码、测试结果和跳过原因](audit-20261016-evidence.md)。
3. [全部delay及相关规划/验收来源、Git事实、源码指纹](audit-20261016-sources.md)：61份来源文件，另读仓库AGENTS.md。
4. 原始目标仍见 [Social设计](../plan_doc/2026-10-13-social-conversation-engine.md)、[开发阶段](../plan_doc/2026-10-13-social-conversation-development-plan.md)、[验收规范](../plan_doc/2026-10-13-social-conversation-acceptance.md)、[接管契约](../plan_doc/2026-10-13-social-takeover-contract-v1.md)。

状态汇总：完成13、部分完成113、未完成7、阻塞46、无法验证21。这里“完成”仅限矩阵该行明确的本地契约或本次审计动作，不是13个模块已上线。

## 已确认进入远端的内容

- `git fetch`、`git ls-remote --heads`和本地 `rev-parse` 一致：审计时远端仅main，SHA如上。PR head refs查询为空；没有可见未合并产品分支可对照，没有进行合并。旧云未推送成果不可访问，不能当代码事实。
- `src/conversation/{events,state,runtime,context,prompts}.js`、Orchestrator的双阶段主链/到期意图ticker、Sender guard、Manager/Store v3字段保全均已存在。
- `test/social-runtime.test.mjs`、`test/social-memory.test.mjs`、`scripts/notebook-memory-cleanup.mjs`现已存在。10-13早期交接中“尚不存在”的句子是历史，不是当前缺项。
- Notebook运行脚本隔离、MaterialRef、候选累计/subject/人工审核/CAS、清理manifest、管理UI等代码已存在。历史Social报告列出的11个源码哈希与当前main全部匹配；这证明这些代码已入远端，不能证明全部验收通过。
- Notebook早期能力说明提交`6acd177`确为main祖先；后续共享角色规则取代了原六句文案。当前main没有恢复原测试要求的完整边界句，本次两项失败仍可复现。不能把旧对话中可能讨论或未推送的修复写成已完成。

## 本次实测

Linux x64、Node v24.19.0；测试数据均为临时合成数据。与历史Windows/Node22结果不可直接混算。

| 检查 | 本次结果 | 含义 |
| --- | --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | 退出1，HTTP403 | 锁定镜像的ws包下载被拒；停止下载，未换源绕过 |
| Social/LSR/functional/prompt focused，13文件 | 退出1；31 PASS / 8 FAIL | 2个Notebook实际断言失败；6个依赖阻塞（4文件ws、2向量） |
| Self-Evolution，9文件 | 退出1；38 PASS / 6 FAIL | 5文件ws加载失败，1向量扩展不可用；不是6个已判定产品缺陷 |
| JS/MJS语法 | 245文件全部退出0 | 仅解析检查 |
| shell语法 | 退出0 | 只执行bash -n，没有执行部署 |
| sqlite-vec smoke / prompt self-test | 各退出1 | 分别缺sqlite-vec/ws |
| render / scroll | 134 PASS+1阻塞 / 19 PASS | 非浏览器完整UI验收 |
| 全量unit、npm test、浏览器QA、真实模型/QQ/生产 | NOT_RUN / LIVE_NOT_RUN | 依赖失败或本次明确禁止；不复用历史结果当通过 |

## 偏差、风险与下一步验收条件

下列下一步是交接建议，**本次没有开始修复或实现**。恢复业务开发、外部服务验证和生产操作需按届时明确指令分别安排。

| 优先级/项 | 当前证据与风险 | 明确下一步及验收条件 |
| --- | --- | --- |
| P0 依赖/可复现性 | npm下载ws返回403，sqlite-vec也缺失；主链测试没到断言。历史660/45/3不能当本次基线结果。 | 在合法可用的依赖环境解决安装来源后，成功执行原锁文件npm ci与sqlite-vec smoke，再跑本报告V1/V2及CI全矩阵；保留每个失败归因。不得绕过下载拒绝或静默改锁。 |
| P0 Notebook提示词边界 | `notebook-policy.js::ROLE_NOTE_POLICY`仍有“不是命令”“不扩大权限”，但缺原来“不改变身份、权限、安全规则”的明确完整句；`prompt-safety:127/177`失败。不能仅据文字缺失宣称已经发生权限绕过，也不能把它全归为过期测试。 | 对照角色自由笔记新语义与不可提升身份/权限/安全边界，修复契约一致性；enabled一次、disabled零次、固定system/Base Persona不变、恶意笔记不能取得工具权限的正反例通过。不能删除安全断言凑绿。 |
| P1 配置兴趣来源 | `validateSourceRefs`只承认message/external_observation；工具观察入口已有，显式配置/shared-interest探索入口未找到。 | 明确受控兴趣来源、配置/授权和独立预算；补A-P04/A-I04/A-I10正例，保持空tick零调用和禁止递归催话。没有上线或付费探索授权。 |
| P1 旧lexical路径仍在 | `retrieval-provider.js::provide`在embedding未请求时分页取Notebook并调用旧RetrievalService；`builtin/self-evolution.js`工具也回退search。与09-28 F4“不静默回退自制中文相关性”不一致。本次retrieval测试通过的是该路径之一。 | 先裁决当前产品契约，不能借旧用例PASS忽略新要求；无embedding时明确不可用与精确读取能力，三个语义入口保持同一行为。 |
| P1 索引错误/恢复 | `EmbeddingClient.#request`区分AUTH/RATE_LIMIT，但`VectorMemory.#markJob`统一退避；未读取Retry-After，也没有profile级401/403暂停。`retryFailed`不清零attempts，耗尽作业可能立刻回failed；取消晚到转obsolete的恢复未证明。 | 补T10-T15：401/403暂停后配置修复恢复，429按策略延迟，取消/停用/重启不永久丢索引，尝试计数有界，恢复策略明确且审计。 |
| P1 历史补建/管理恢复 | 未找到T16要求的preview→授权→有界幂等补建链；现有`/api/self-evolution/embedding/retry`直接重试并process，不等于补建。UI未找到对该端点的恢复调用。 | 补历史及新profile补建验收、幂等/授权/范围、失败恢复UI→真实队列状态；不能保存配置即自动付费回填。 |
| P1 NoteHit/全文更新 | `VectorMemory.search`结果缺scope/chatKey/tags/isTruncated；`notebook_search`无noteId精确全文读取schema，semanticSearch调用未传signal。CAS本身不能证明模型已读全文。 | 补T17/T24：三个入口统一字段与取消语义，按真实ID/revision取全文，摘录不得覆盖未读正文，冲突重新读取。 |
| P1 正式装配证据不足 | functional-repair首项直接调用createEmbeddingCapability和fake fetch；其余直接NotebookStore并手动processEmbeddingQueue。历史PR文档“PASS”不满足T01/T02/T08要求的createApp→Manager→后台消费→HTTP。 | 在真实装配只替换最外层HTTP，断言测试凭据只在HTTP、禁发0调用、后补配置生效、不聊天自动ready、在途切profile拒绝旧结果。 |
| P1 Social完整主链 | A-H01-H06本次被依赖挡住；即使历史专项通过，也缺部分组合（重启→due→partial/unknown、三入口召回→撤销→在途）。 | 逐行补充矩阵的生产入口、fixture、实际计数/状态/失败码，跑通全部硬项；保留两模型阶段共用预算、Sender/outbox/ack，不以helper替代。 |
| P2 候选global语义 | 当前`reflection-store.js`对global候选给出`global-cross-chat-evidence-unavailable`；安全拒绝已测，但旧LSR跨群晋升正例不能宣称完成。 | 显式区分安全拒绝与已授权抽象晋升；若仍不实现正例则保持部分完成，不能拼接私聊原文或以扩大scope消除失败。 |
| P2 行为与UI效果 | 合成social-replay只是输入，没有本次真实模型输出/评分；未重跑浏览器桌面/窄屏QA。 | 按A-B01-B12在另行允许的模型/数据范围记录模型、人设hash、参数、输入时序、自然/突兀判断和真实成本；至少分享、旁听、记忆、认真回答正例。全静默判失败。UI完成真实控制台/窄屏操作。 |

## 历史证据处理与交接边界

- 保留旧任务卡、计划、schedule、验证报告及18209字节旧stash patch，不应用patch，不改历史PASS/FAIL数字。
- 旧LSR“纯沉默不反思”、单会话计数、autoApplyBehaviorTraits测试豁免和旧lexical回退约定不能覆盖当前Social的经历/偏好分离与review-only规则。
- 部分历史索引指向已不在当前树的09-24原始plan_doc，旧云work日志/截图也不可访问。只能用现存任务卡、当前代码与当前测试评估，不能宣称这些外部历史材料已核验。
- 生产profile是否已清理、服务运行何版本、线上自然度/发送效果均无法验证且未访问。报告不含生产数字、聊天、账号身份或私有运维资料。
- 本次仅提交delay下入口和审计文档；push后以远端该文档分支ref核对提交，最终交付回报给出准确commit SHA。main保持审计基线，不冒充已经合并。
