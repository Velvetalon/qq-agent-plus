# 当前工作交接入口

## 最新：2026-10-20 Workflow显式Luna与线上更新已落实

[本轮执行进度](schedule/2026-10-20-workflow-resume.md)、[全局新规则快照](coordination-policy-2026-10-20-workflow.md)、[真实故障矩阵](schedule/evidence/2026-10-20-workflow-resume/luna-fault-tests.json)、[Luna独立复核](schedule/evidence/2026-10-20-workflow-resume/independent-review.json)。全局已禁止普通subagent派发；本轮每次workflow agent都显式model=gpt-6-luna，后续显式provider=codex-proxy。

- 已完成Luna紧凑实现、协调者返修验收与全新Luna限域复核；两源各4个方法/18场景、2旧逻辑红例和1唯一性反例PASS。首轮max-tokens无产物保留为失败。
- **线上已更新到91beebb**：142源码hash全部相符，服务active/running，备份和SQLite完整性通过；实际DeepSeek生产固定文本HTTP200/OK。4B/2560已启用并线上验证，query=true/private=false，原权限/凭据和三个记忆开关保持。
- 首次配置500及停供记录保留；现已通过可信已有协议配置/笔记账号交叉核验补宿主身份并恢复成功，不是实时QQ登录证明。OneBot仍既有断连，SC8未通过。
- **现有向量0不冒充索引完成**：293笔记中47不活跃/不可召回，246属chat私域被allowPrivate=false拦截，0条外发排队；主记录不变。[最终生产证据](schedule/evidence/2026-10-20-workflow-resume/production-result.json)。

以下为历史时点，不覆盖本节最新进度。

## 历史检查点：2026-10-20 全部代码/进度/部署状态归档（WIP，生产未更新）

**从[完整总交接](schedule/2026-10-20-complete-work-archive.md)开始**；同时提供[结构化证据](schedule/evidence/2026-10-20-complete-work-archive/result.json)、[16份禁止直接执行的运维代码快照](implementation/2026-10-20-production-update/README.md)、[准确续做卡](task/DEPLOY-2026-10-20-resume.md)及[分工规则快照](coordination-policy-snapshot.md)。既有历史不删除、不倒改。

- 业务代码已在Git/main，归档前HEAD为930bfb9；face审核、thinking预算/快照、消息ID提示与DeepSeek测试档案已有对应提交。待发布候选在目标Linux **852/852 PASS、0失败/跳过**，辅助门禁通过。
- **实际生产仍059eba5、原进程active/lifecycle、聊天仍Qwen、OneBot仍为既有断连。没有正式停服、创建新业务备份、替换安装或切换模型。** 版本号新旧均0.6.18，须看revision，不能仅看health版本号。
- 首次发布尝试因主协调者把Embedding未配置误判为记忆关闭，在停服前被拒绝；实际记忆/检索/反思均true、293笔记存在。失败进程退出且标记已保存，之后没有再次启动发布。
- 用户已明确允许符合策略的笔记发NanoGPT、启用4B/2560、query=true/private=false；固定文本探针真实HTTP200/2560维/7tokens。但**配置/真实笔记索引尚未应用**。
- 本地最后异常清理补丁未上传、缺专门故障注入和最终复核；服务器旧稿有已知P2，不能直接运行。Luna尚未实际指定；不能把通用复核或解释workflow当已派发。
- 本轮按最新要求只归档并推GitHub，不新增部署、模型调用或索引。SC8真实QQ、B07、更广R06/B10及完整新模型记忆链仍开放；Windows旧失败不冒充已修。

以下均为历史时点，不覆盖本节的实际状态。

## 历史检查点：2026-10-20 按用户选择改用DeepSeek Flash，原短问答/身份小样本实测正常（WIP）

[本轮模型选择与实测](schedule/2026-10-20-deepseek-chat-profile.md)、[脱敏结果](schedule/evidence/2026-10-20-deepseek-chat-profile/result.json)。源码 `ef4e806` 将测试和待授权上线配置约定统一为NanoGPT `deepseek/deepseek-v4.1-flash-1017`；Embedding继续 `Qwen/Qwen3-Embedding-4B` / 2560。

- 专项 **67/67**；精确新模型断言及旧Qwen聊天0dispatch拒绝通过；审核/共享预算/失败锁闭不变。本轮未重跑全量，不覆盖上轮44旧失败/3跳过。
- 原short-invitation与identity实测共 **12次HTTP200 / 65038报告tokens / 0错误**，本轮无402。短答1条、身份两轮4条，明确否认虚构现实经历并承认机器人身份；仅属原fixture正例，不把全部R06/B10关闭。
- 12个返回cost字段为0，不保证最终账单为0；原人物卡、fixture及Embedding未修改。B07、更广身份矩阵、完整记忆链与Linux门禁仍开放。
- **线上实际实例未改**：本轮只统一仓库测试/上线配置约定，未恢复既有服务器连接/部署暂停，SC8/真实QQ保持USER_PAUSED。

以下为历史时点；前Qwen的402不代表本轮DeepSeek不可用。

## 历史检查点：2026-10-20 Thinking审核与消息ID提示已修，身份复验受402中断（WIP）

先读 [本轮修复与实测](schedule/2026-10-20-thinking-review-repair.md) 和 [脱敏结果](schedule/evidence/2026-10-20-thinking-review-repair/result.json)。源码 `e870954` 完成有界审核配置、读盘/保存/运行统一、不可变run快照和最小ID提示；主协调者亲自定方案，原两项独立复核P2已返修闭合。

- 最终专项 **66/66**，新增14项全过；Windows全量 **804 PASS / 44 FAIL / 3 SKIP**，与上轮同源码基线失败名称完全一致，不标完整CI全绿。
- 指定Qwen thinking回放使用2048tokens/45000ms（旧配置仍768/15000默认）；严格JSON/截断拒绝与共享预算、4审核/2拒绝、发送门不放松。
- 原短问答真实4次HTTP200、1条正确回复，审核完整返回。identity首个实际请求被NanoGPT **402 / Insufficient balance** 拒绝；没有新增身份结论，不能算PASS。等待用户确认余额恢复后再继续实测，不自动重试/换模型或凭据。
- 模型仍为 `qwen/qwen3.8-27b-uncensored:thinking` + `Qwen/Qwen3-Embedding-4B` / 2560；Embedding本轮未重跑。B07/R06/B10、完整记忆链和目标Linux验证仍开放，SC8/真实QQ/部署仍USER_PAUSED。

以下均为历史时点，不覆盖本节当前状态。

## 历史检查点：2026-10-19 本地接管、表情审核与指定 Qwen 实测（WIP）

先读 [本轮接管进度](schedule/2026-10-19-local-takeover-face-review.md) 和 [结构化结果](schedule/evidence/2026-10-19-social-face-review/result.json)。源码 `cd7b7d2` 修复 face caption 绕过审核、协议CQ文本一致性和无代理回放请求；方案由主协调者亲自确定，独立限域复核通过。

- 专项 **62/62**；Windows全量 **790 PASS / 44 FAIL / 3 SKIP**。精确旧基线同环境为 **772/44/3**，失败名称完全一致，本轮18项新增全部通过；不宣称完整CI已绿。
- 用户指定测试及后续上线：NanoGPT `qwen/qwen3.8-27b-uncensored:thinking` + `Qwen/Qwen3-Embedding-4B` / 2560。密钥只在进程认证，不入Git或生产配置。
- 真实短问答有1条正确输出；身份两轮受768-token截断及15秒审核超时影响，**NOT_PASS / OPEN**。真实4B独立记忆索引/重开/检索17次HTTP成功，小样本校准通过。
- 下一步先由主协调者处理thinking审核兼容和工具错误提示缺口，再做同模型B07/R06/B10及完整记忆链；当前不是可上线版本。SC8/真实QQ/生产部署仍 **USER_PAUSED / NOT_RUN**。

以下是历史检查点，不覆盖本节当前状态和模型选择。

## 历史检查点：2026-10-19 云环境代码交付（仍为 WIP）

[云交付记录](schedule/2026-10-19-cloud-handoff-delivery.md)：安全包恢复原提交及全部 28 个未提交文件；
最新源码 `bc0a77d1f65edcc009ac6d5d463af2b7866e31fe`，Node 24 离线单测 **819 PASS / 0 FAIL / 0 SKIP**，
静态、本地与实际 Chromium 回归通过。用户现授权推送原工作分支；最新语义门的图片细节幻觉、
身份误拦修复尚未最终真实模型回归，B07/R06/B10 保持开放，SC8/部署仍暂停。

## 历史时点：2026-10-19 真实模型与必选 Embedding

[最新收口记录](schedule/2026-10-19-real-model-embedding-closure.md)：真实4B跨会话记忆与独立设置页通过；全量800 PASS。17项真实模型验收中14项有小样本支持，B07复读FAIL，R06/B10因跨场景编造经历保持开放。SC8仍USER_PAUSED；项目未全卡结束，仅本地归档/commit，不push。以下较早状态保留为历史。

## 最新补正：独立审查及两项修复

[独立审查记录](schedule/2026-10-16-f4-independent-review.md)：原“独立复核”已纠正为实现者自查。
本次独立子代理发现并复核修复P1授权期间配置撤销竞态、P2反思截断遗漏最新目标。
修复源码 `78dd7683ac4063d2844e810b5c0eb452788b1724`；独立重点回归93项通过。
下方旧候选结果保留历史时点，具体全量门禁及授权边界见最新审查记录。

## 最新：2026-10-16 当前任务卡与 F4 收口

先读 [全部阶段状态、证据与最小解锁条件](schedule/2026-10-16-task-card-closure.md)。
源码候选 `6ae135a9dff17eb309b3ec4989faaa063834e7b2`：F4 三入口仅 ready 向量、
完整标签/作用域过滤、NoteHit、精确读取/取消/配置变化边界已修复并验证。
Node 22 **750 PASS / 0 FAIL / 0 SKIP**，其余门禁及真实浏览器通过。
91项：74本地契约通过，5语义项与12真实行为项未运行；SC8仍USER_PAUSED。
不再等待词法策略选择；只剩文中明确的模型/平台/生产授权阻塞。草稿PR未合并。

## 最新：2026-10-16 剩余本地验收与禁言/转发修复

先读 [本轮完整交接](schedule/2026-10-16-social-remaining-closure.md)。
产品/测试候选 `2899a54bb4d4a5ddaf163bb03a8435506f2c5e7a`，Node 22 全量
**749 PASS / 0 FAIL / 0 SKIP**；A-H05 三消费者/CAS/在途与下一轮已闭合。
修复已观察到的群禁言发送门禁与转发证据类型；真实浏览器重启验收通过。
[91 项对照](../docs/verification/social-acceptance-20261016.md) 保留语义/真实平台未运行项。
较早 F4 无向量词法回退策略差异仍需明确专项范围，不宣告可部署。
独立草稿 PR 未合并；服务器连接/认证/部署仍 **USER_PAUSED**。

以下为历史检查点，请以此最新交接为准。

## 最新：2026-10-16 配置兴趣入口与主链恢复验收

先读 [本轮交付记录](schedule/2026-10-16-social-interest-closure.md) 和
[91 项验收对照](../docs/verification/social-acceptance-20261016.md)。
产品源码 `a864379d93f1a1fd7df99c355f7796719a0e5848`：来源/预算/一次性机会、
撤销与恢复及真实管理页面已实现；Node 22 全量 **718 PASS / 0 FAIL / 0 SKIP**。
后续仅追加重启 partial/unknown 与普通回复安静 tick 的完整应用测试，已通过。
仍是草稿 PR；Social 其他组合验收不冒充完成，服务器仍 USER_PAUSED。

## 最新：2026-10-16 本地修复检查点，服务器操作暂停

接手先读 [本地开发闭环记录](schedule/2026-10-16-local-development-closure.md)。
候选源码 `9cd2c2449b467314f146adcb23d4a425c5fa8ad4` 已完成 Notebook 边界、
严格扫描声明识别和 Social 来源截断修复；Node 22.22.2 全量单测
**714 PASS / 0 FAIL / 0 SKIP**，其他本地 CI 门禁通过，测试断言未降低。
修复位于独立草稿 PR，未合并 main；Social 全套验收和配置兴趣入口仍未闭合。
用户已要求暂停所有目标服务器连接重试、认证和部署；即使连通恢复，也必须等用户
明确确认才可恢复线上操作。下面是历史交接，不代表当前测试仍失败。

## 当前状态：拟人群聊内核 WIP，已恢复本地开发

2026-10-14 用户要求保存当前全部未完成代码并推送自己的 GitHub。
最新接手入口是
[GitHub WIP 交接记录](schedule/2026-10-14-github-wip-handoff.md)。
全量单测结果为 **660 通过、45 失败、3 跳过**；开发未完成，
此次保存不是发版或上线授权。提交范围包含全部当前项目代码、测试和计划，
不包含生产凭据、数据库、聊天记录及本地生产连接备忘。

2026-10-13 用户已明确授权接管并继续。接手基线为 `8233c83`；
当前阶段接口和所有权见
[接管契约 V1](../plan_doc/2026-10-13-social-takeover-contract-v1.md)，
实际进度见[恢复开发记录](schedule/2026-10-13-social-engine-resumed.md)。
尚未完成整体验收，不部署、不清理生产数据、不调用真实付费模型、不切换线上模式。

2026-10-14 最新本地验证：联合回归 248 项通过，独立关键路径复核
35 项通过、未发现 P1/P2 问题。详见
[验证检查点](../docs/verification/social-engine-closure.md)；
完整验收矩阵、预配置兴趣来源入口和真实模型效果仍未闭合，不能据此上线。
随后全量验证已确认有失败，不能用上述专项通过数代表全部测试成功。

下方为原 WIP 保存点的历史交接信息。

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
