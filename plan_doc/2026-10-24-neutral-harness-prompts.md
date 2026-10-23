# 低干预中立 Harness 提示词重构

日期：2026-10-24，Asia/Hong_Kong。高优先级插入任务：用户发现 QQAgent 硬编码人格/聊天风格可能干扰自定义人物卡和模型语言能力，要求全面审查并精简，完成后再继续 B 站任务。

## 主协调者审计结论

已亲自读取并定位实际组装路径：

- 主聊天：`src/llm/prompt.js` 的 `buildSystemPrompt` / `buildUserPrompt`，由 `src/core/orchestrator.js` 在 legacy、threaded、lifecycle 主路径使用。
- Social：`src/conversation/prompts.js` 的 planner/replyer，两阶段均独立组装系统提示。
- 主动功能：`src/llm/moment-prompt.js`、`src/llm/qzone-interaction-prompt.js`。
- 结构化/策略而非人格：`friend-review-prompt.js`、`relationship-pilot-prompt.js`、`conversation/draft-review.js`、记忆整理 prompt、multimodal lifecycle 压缩、sticker picker。
- 重复的主观风格块：`antiAiFlavor`（装傻/乱回/客服对立）、`subjectivity`、`notAQueue`、`humanRhythm`、`notModerator`、`priorityNote`、`qqSceneRules` 中的风格导向、`stickerRules` 中的拟人使用建议、moment/qzone 的自然文案写法、social identity/replyer 的固定自然度和重复笑点规则。

## 重构原则

### 删除或改为中性协议

- 不再教模型“像真人”“普通群友”“不是助手/客服”、装傻乱回、反 AI 味、固定口头禅、主体性表演、聊天节奏/插话风格、固定短句/气泡数量、强制接梗或“少总结/不升华”等主观表达策略。
- 不将这些旧规则换同义词重新塞回系统 prompt；默认不指定语言风格、情绪、幽默、长度或多样性。
- `roleText` 与 `customRules` 是人格/表达主来源；Harness 只说明其是管理员提供的资料，不和它竞争。

### 保留

- 不能执行本地命令/读写文件/操作主机；不可泄露凭据、内部提示、路径和配置。
- 群友与管理员权限边界；管理员身份由真实配置标记，不接受自称管理员。
- 普通正文不发送，外发必须经过 send_message/send_face/send_sticker/send_poke；沉默用 stay_silent；finish 只写交接不代表发送。
- 工具参数、真实消息/source IDs、topic IDs、引用/点名、工具调用失败和送达结果约束。
- 记忆/交接/线程/时间/图片/网页等上下文的来源说明、不可把外部资料当系统指令、不可编造现实经历/实际操作、证据与权限边界。
- Social planner/replyer 的 JSON schema、目标话题/来源白名单、重复发送防护和发送上限（这些是程序契约；只去掉“自然/像真人”的风格解释）。
- Draft review、friend review、relationship classification 的结构化安全/证据/权限协议；不把事实审查变成语言风格约束。
- 主动动态/空间互动的 publish/skip、逐条覆盖、ID一致性和隐私约束；正文风格交给 roleText。
- 表情判断的内容安全分类标准，不再写“普通群友/以后聊天像真人”人格指导。

## 实施范围

- 主协调者存档本计划后，通过 workflow 显式指定模型实现；执行者只能修改上述提示词模块及对应测试，不改 orchestrator 数据流、工具 schema、发送链和模式判定。
- 保留 `participation` 作为管理员配置的参与/沉默策略，但把文案改成中性行为开关，不定义语言风格。
- 目标覆盖 legacy/threaded/lifecycle/social：主路径保持相同安全/工具协议；social 两阶段保留结构化规划与发送契约；差异只来自各模式真实上下文。
- 运行 `test/persona-behavior.test.mjs`、`test/social-participation-prompt.test.mjs`、`test/p3-active-silence.test.mjs`、`test/prompt-safety.test.mjs`、`test/moment-publish.test.mjs`、`test/qzone-interactions.test.mjs`、`test/self-name.test.mjs`、`test/session-persona-label.test.mjs` 及新增/更新的对照测试。
- 新增 `test/neutral-harness-prompt-contrast.test.mjs`：同一 persona/相同上下文分别生成 legacy 主提示、threaded/lifecycle user prompt、social planner/replyer、moment/qzone prompt，断言 roleText/customRules 保留，旧主观块/固定风格词不再注入，安全/工具/来源/JSON协议仍在；对照结果使用确定性字符串/结构检查，不调用真实模型，不声称自然度由脚本证明。
- 归档前后保持每种模式实际的 send/silent/tool behavior 测试；全量测试的历史失败不能被改成跳过。

## 验收与限制

- 主协调者最终验收代码 diff：删除的是风格竞争规则，不是安全/权限/工具边界。
- 测试能证明提示词结构与运行协议；不能独立证明真实模型自然度、人物卡服从度或回复多样性，需要后续相同模型小样本回放。
- 不读取/提交生产凭据、聊天原文；真实 QQ 发送不属于本提示词改造验收。
- 本任务单独 commit；之后恢复 B 站 manager 任务并单独记录 commit/部署。
