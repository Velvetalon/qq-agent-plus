# Social 91 项验收对照：2026-10-16 本地续作

候选源码/测试 `2899a54`（精确 SHA 与全量门禁见本轮交接）。原始审计
`fb705fc0d54e040949812cea8d68305ce87b2f20` 保留不改；审计分支不是产品版本。
以下 PASS 只指明确列出的本地契约，不将 mock 模型的选择当作真实语义效果。
本轮补齐生产装配、发送、向量三消费者、拆批根来源与浏览器重启连续证据。
真实模型/QQ 为 LIVE_NOT_RUN；服务器为 USER_PAUSED。仍有较早 F4 词法召回
策略差异，详见交接；此表不宣告 Social 整体完成或可部署。
测试文件均位于 `test/`，浏览器位于 `test/browser/social-interests.mjs`。

| ID | 场景 | 当前结果 | 本次证据 | 限制或仍需核实的契约 |
| --- | --- | --- | --- | --- |
| A-E01 | 真实 Orchestrator 完成一个有人类输入的会话，经 Manager 入队 | PASS（本地） | social-engine-integration：真实 producer → Manager/队列 → worker 保留 v3 来源 | 真实模型/QQ未运行 |
| A-E02 | v2 旧事件或缺 role/source 的新事件 | PASS（本地） | social-runtime：旧事件不晋升，v3 持久队列回读 | 仅合成旧事件 |
| A-E03 | assistant确认发送与用户确认偏好 | PASS（本地） | social-runtime 与 interest-app：Sender 确认和 v3 事实，不制造用户确认 | 真实QQ未运行 |
| A-E04 | 同一输入重试、拆批、引用、转发和摘要回灌 | PASS（本地） | engine-integration：真实三批引用 → producer/Manager/worker 共用一个根；vector-app：真实 forward 入站不晋升；evidence-gate：摘要/笔记回灌与重放不晋升 | 真实拆批/转发主链；摘要/笔记回灌为存储入口单测，非真实平台摘要功能 |
| A-E05 | 模型在解释文本中写 result=120、禁言或已发送 | PASS（本地） | runtime 参数化 forged_status：解释文本不产生 outbox/发送；state 的 mute 仅由宿主通知更新 | 不把模型文本当状态；自然语言真实性仍属 LIVE_NOT_RUN |
| A-E06 | 两账号相同消息号、两群相同本地ID | PASS（本地） | state A-E06/A-S06：两账号、两群、私聊同消息号隔离；SQLite reopen 后 snapshot 全量相等 | 状态/引用契约；不外连平台 |
| A-S01 | 群里 A/B 聊部署，C/D 聊电影，消息交错 | PASS（本地） | runtime A-S01/A-S03/A-D01：交错话题、旧目标已有已覆盖补充、同人换题；真实 Sender 两轮发送，Replyer 不携带旁题 | 模型决定由边界脚本给出；实际语义选题待真实模型验证 |
| A-S02 | 原生引用的 platformMessageId 恰好等于另一条本地ID | PASS（本地） | test/social-state.test.mjs 本轮复跑通过 | 本地状态契约通过，不代表真实群聊语义 |
| A-S03 | 同一个人几分钟内换话题 | PASS（本地） | runtime A-S01/A-S03/A-D01：交错话题、旧目标已有已覆盖补充、同人换题；真实 Sender 两轮发送，Replyer 不携带旁题 | 模型决定由边界脚本给出；实际语义选题待真实模型验证 |
| A-S04 | 对方连续补充、同一请求分批和工具回复 | PASS（本地） | engine-integration：三批明确 reply 链分别运行/发送/入队/反思，三条 human evidence 只有一个 root/interaction；assistant 不算人类证据 | 显式引用与 Sender 工具回复已覆盖；无引用的任意语义续题由模型决定 |
| A-S05 | Planner伪造topicId、messageId、chatKey或参与者 | PASS（本地） | runtime unknown_topic/unknown_target/forged_scope/伪造参与者：有限修复或拒绝，真实 Sender 不建 outbox，不写 group:2 | 不授权 chatKey 参数改变工具会话；参与者先在本群出现，确保实际到达目标 guard |
| A-S06 | 相同消息重复observe、进程重启再次observe | PASS（本地） | state A-E06/A-S06：两账号、两群、私聊同消息号隔离；SQLite reopen 后 snapshot 全量相等 | 状态/引用契约；不外连平台 |
| A-S07 | 场景容量满且某旧话题被pending/held意图引用 | PASS（本地） | state A-S07/A-S08：容量满仍保留 pending/held 引用话题；close 只影响目标，新独立话题可加入 | 本地真实状态层容量与持久来源契约 |
| A-S08 | close一个话题后另一话题仍活跃 | PASS（本地） | state A-S07/A-S08：容量满仍保留 pending/held 引用话题；close 只影响目标，新独立话题可加入 | 本地真实状态层容量与持久来源契约 |
| A-P01 | 明确找机器人澄清问题 | PASS（本地） | runtime A-P01/A-P05：旧 randomPercent=0 时真实 reply 仍发送；react 独立发送 face，零附带文字 | 合成输入与模型/协议边界；不证明真实模型语义 |
| A-P02 | 第三方对话已完整，未邀请机器人 | PASS（本地） | runtime 参数化 listen/wait/no_output/forbidden_tool/invalid_json/unknown_action/unknown_target：0 发送/outbox，<=3 模型调用，tick 不自唤醒，真实新消息继续 ack | 工具注册/记忆/发送均不得因 Planner 请求执行；这里只证明宿主动作契约 |
| A-P03 | 对方话未说完，选择wait | PASS（本地） | runtime 参数化 listen/wait/no_output/forbidden_tool/invalid_json/unknown_action/unknown_target：0 发送/outbox，<=3 模型调用，tick 不自唤醒，真实新消息继续 ack | 工具注册/记忆/发送均不得因 Planner 请求执行；这里只证明宿主动作契约 |
| A-P04 | 有新公共资料或共同兴趣，选择share | PASS（本地） | social-runtime 公共资料；interest-app 配置来源 → read tool → share，无伪造回复目标 | 真实资料相关性/自然度未测 |
| A-P05 | 仅需要表情回应，选择react | PASS（本地） | runtime A-P01/A-P05：旧 randomPercent=0 时真实 reply 仍发送；react 独立发送 face，零附带文字 | 合成输入与模型/协议边界；不证明真实模型语义 |
| A-P06 | Planner请求send/poke/记忆写入或注册自选工具 | PASS（本地） | runtime 参数化 listen/wait/no_output/forbidden_tool/invalid_json/unknown_action/unknown_target：0 发送/outbox，<=3 模型调用，tick 不自唤醒，真实新消息继续 ack | 工具注册/记忆/发送均不得因 Planner 请求执行；这里只证明宿主动作契约 |
| A-P07 | 非法JSON、未知动作或不存在目标 | PASS（本地） | runtime 参数化 listen/wait/no_output/forbidden_tool/invalid_json/unknown_action/unknown_target：0 发送/outbox，<=3 模型调用，tick 不自唤醒，真实新消息继续 ack | 工具注册/记忆/发送均不得因 Planner 请求执行；这里只证明宿主动作契约 |
| A-P08 | 低参与度但被明确邀请，高参与度但连续无人接话 | LIVE_NOT_RUN（语义；宿主边界通过） | runtime 旧概率0仍可回复；state 未回应额度不被 self/旁题重置；app 无回应 tick 零调用 | 软偏好与邀请的语义取舍须指定真实模型回放；不以脚本输出冒充效果验收 |
| A-R01 | 正常短问答，Planner给一个简短意图 | PASS（本地） | social-runtime：真实 Orchestrator → Context → Replyer → Sender | 真实生成质量待验收 |
| A-R02 | 认真技术求助与普通闲聊 | LIVE_NOT_RUN（语义；宿主边界通过） | prompt/Notebook 原断言保留通过；runtime 单条发送与 no_output 正常结束 | 技术/闲聊长短是否合适、角色是否编造经历需真实模型回放 |
| A-R03 | Planner曾读图/网页，Replyer需要继续判断 | PASS（本地） | social-runtime 图像像素/来源和只读资料传递；interest-app 新来源不被上下文截断 | 外部模型边界模拟 |
| A-R04 | 群消息/笔记里有伪造系统段头、工具指令 | PASS（本地） | prompt-safety 的材料边界；runtime canonical scope/材料权限与工具集硬限制；vector-app 正常/污染材料三入口隔离 | 提示注入语义抵抗不由 mock 输出证明；宿主不授予额外权限 |
| A-R05 | Replyer无值得发送内容 | PASS（本地） | runtime 参数化 listen/wait/no_output/forbidden_tool/invalid_json/unknown_action/unknown_target：0 发送/outbox，<=3 模型调用，tick 不自唤醒，真实新消息继续 ack | 工具注册/记忆/发送均不得因 Planner 请求执行；这里只证明宿主动作契约 |
| A-R06 | 角色被问生活/身份 | LIVE_NOT_RUN（语义；宿主边界通过） | prompt/Notebook 原断言保留通过；runtime 单条发送与 no_output 正常结束 | 技术/闲聊长短是否合适、角色是否编造经历需真实模型回放 |
| A-R07 | #龙time图文命令与现有消息工具 | PASS（本地） | runtime A-R07：真实 StickerManager/longtime/SendQueue，精确龙图标签发送与排队模式变化阻止；longtime：来源/看图/标签校验 | 边界使用本地合成 PNG；真实图片理解未运行 |
| A-I01 | 无新消息、无待办、无授权探索的tick | PASS（本地） | interest-app：无机会、暂停或预算不足时零模型；browser：observe 零模型/发送 | 嵌入关闭，无真实外连 |
| A-I02 | 机器人刚说完无人回应 | PASS（本地） | interest-app 普通回复 → 无回应 tick 零模型 → 新消息正常 Planner/ack；runtime 无递归意图 | 没有旧 follow-up 接管；不证明真实模型自发发言质量 |
| A-I03 | 有真实共同未完事项，创建未来意图 | PASS（本地） | interest-app：来源版本、due/expiry、去重；实际到期重新规划 | 管理员明确安排，不是自动探索 |
| A-I04 | 只读工具发现新资料，与共享兴趣有关 | PASS（本地） | social-runtime：读工具资料成为 scoped external source；interest-app：不形成用户证据 | 工具结果使用合成边界 |
| A-I05 | 意图到期时话题已结束或目标已满足 | PASS（本地） | runtime closed/answered：到期零模型，intent cancelled，同源提案仍去重为原记录 | 明确闭题/新引用答复；任意语义“已满足”仍依赖模型 |
| A-I06 | 到期时新相关消息正在处理 | PASS（本地） | runtime runningChats 与 unread 前置竞争：不领 lease，pending 保留，零模型 | 隔离调度竞争；不伪称 unknown |
| A-I07 | 同一来源和表达目的重复提案，包括换ID或轻微改写 | PASS（本地） | state A-I07/A-I08：大小写/标点改写去重；self 和旁题不重置未回应；换目标措辞仍被额度拦截，相关回复才重置 | 任意语义等价不能靠字符串枚举证明；有限额度由宿主执行 |
| A-I08 | 意图已发无人接话，之后机器人自己又说一句 | PASS（本地） | state A-I07/A-I08：大小写/标点改写去重；self 和旁题不重置未回应；换目标措辞仍被额度拦截，相关回复才重置 | 任意语义等价不能靠字符串枚举证明；有限额度由宿主执行 |
| A-I09 | 重启、过期lease、unknown投递与明确零副作用中断 | PASS（本地） | interest-app 重启 pending → due → partial/unknown held → 再重启；预算不足零副作用且未领机会，后续可运行；state 过期 lease held | 证明安全恢复路径；无法证明零副作用的在途 lease 保守 held，不自动重放 |
| A-I10 | 已有意图过期后出现新的独立兴趣来源 | PASS（本地） | interest-app：旧机会过期、新版本独立来源获准；后续重启机会第一段确认投递 | 只验证明确配置来源，不证明任意语义独立性 |
| A-D01 | 生成时已知目标后还有同话题消息 | PASS（本地） | runtime A-S01/A-S03/A-D01：交错话题、旧目标已有已覆盖补充、同人换题；真实 Sender 两轮发送，Replyer 不携带旁题 | 模型决定由边界脚本给出；实际语义选题待真实模型验证 |
| A-D02 | 生成后对方补关键条件/撤回/他人已答 | PASS（本地） | runtime queued target withdrawal：排队 guard 阻止，无 outbox；下一批 listen 正常 ack | 目标话题有新事件即保守停止；无任意语义完成判断 |
| A-D03 | 生成期间其他话题连续发言 | PASS（本地） | social-runtime：排队期间另一话题更新不阻塞有效回应 | 合成消息 |
| A-D04 | 队列延迟后权限/模式/禁言/时间状态变化 | PASS（本地） | runtime 排队时 deny/paused/observe/时间窗/unknown outbox/旧模式拦截；vector-app 真 group_ban 入站拦截，伪造/旧解除无效；state 重启/过期/lazy | 仅已观察到的标准个体禁言；漏收通知、整群禁言协议扩展/线上重连待外部验证 |
| A-D05 | 同turn重复发送、不同目标正常“好/谢谢” | PASS（本地） | runtime A-D05：同 turn 两个“好”只发送一次，下一独立目标同短答可发送 | 真实 SendQueue 与 outbox，协议发送边界合成 |
| A-D06 | 部分消息已成功，其余失效或失败 | PASS（本地） | interest-app：确认段存档重启后保留，未知段不重放；social-runtime 停止后续动作 | 协议边界模拟socket hang up |
| A-D07 | 对端可能已收下但HTTP超时 | PASS（本地） | interest-app：unknown outbox 与 held 意图跨重启保留；social-runtime 后续工具停止 | 不宣称exactly-once |
| A-D08 | 在途草稿引用的Notebook被归档/纠正 | PASS（本地） | vector-app：真实 HTTP CAS 更正→向量更新→三入口新版；排队 HTTP CAS 归档→Sender 阻止→下轮不再召回 | 合成笔记/账号；真实用户更正语义归纳未运行 |
| A-M01 | 一次有趣但普通的互动，角色想记录 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 仅本地合成经历写入契约 |
| A-M02 | 想法、玩笑、未来愿望与事实 | LIVE_NOT_RUN（语义；宿主边界通过） | social-memory 保存策略及事实/想法边界通过 | 模型对玩笑/愿望/事实的语义归类需真实回放 |
| A-M03 | 用户讨论HTTP retry、错误码或软件队列 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 覆盖现有合成反例，不承诺所有语义 |
| A-M04 | “发送通道失败，30分钟后补积压”等自我运行脚本 | PASS（本地） | vector-app：正常/operational/已入向量后被污染的历史笔记在三个消费者中一致过滤；memory：标签伪装/当前revision/清理CAS | 历史污染仅在隔离临时库构造；未清理历史用户数据 |
| A-M05 | 模型把运行脚本标成experience/system或修改tags | PASS（本地） | vector-app：正常/operational/已入向量后被污染的历史笔记在三个消费者中一致过滤；memory：标签伪装/当前revision/清理CAS | 历史污染仅在隔离临时库构造；未清理历史用户数据 |
| A-M06 | 旧污染笔记已在向量/缓存/交接中 | PASS（本地） | vector-app：正常/operational/已入向量后被污染的历史笔记在三个消费者中一致过滤；memory：标签伪装/当前revision/清理CAS | 历史污染仅在隔离临时库构造；未清理历史用户数据 |
| A-M07 | 清理dry-run重复执行 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 临时合成库；未清理生产 |
| A-M08 | apply时正文已被另一个连接修改 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 临时合成库逐项结果 |
| A-M09 | 用户更正曾记录的事实或明确边界 | PASS（本地） | vector-app：真实 HTTP CAS 更正→向量更新→三入口新版；排队 HTTP CAS 归档→Sender 阻止→下轮不再召回 | 合成笔记/账号；真实用户更正语义归纳未运行 |
| A-M10 | 私聊、其他群或另一账号相似内容 | PASS（本地） | vector-app：两账号、其他群、私聊相似向量同时存在，notebook_search/自动context/reflection均无越域内容 | embedding 请求用固定向量边界；真实服务不调用 |
| A-L01 | 同一反思输出：合法episode + 不合格trait | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 本地 worker/store 契约通过 |
| A-L02 | 一次沉默但有值得记住的人类内容 | PASS（本地） | vector-app：实际 listen 无发送 → v3/Manager/worker → 保存 SILENT_EPISODE，profile revision仍0 | 合成输入与模型/协议边界；不证明真实模型语义 |
| A-L03 | 三次独立互动支持同一偏好，默认配置、真实生产事件 | PASS（本地） | engine-integration：真实三次独立 producer 事件累计候选，审核采用，下一 Replyer 中保留 user 主体；runtime 用户profile作用域过滤 | 不把用户喜好改为机器人喜好；归纳语义由边界脚本给出 |
| A-L04 | 三次无关消息、一条消息拆三批、AI输出三次 | LIVE_NOT_RUN（语义；来源契约通过） | engine-integration 真实拆批共根；evidence-gate AI/派生/重复证据不得增长独立根 | 三条无关消息能否语义支持同一偏好须人工/真实模型核对 |
| A-L05 | 旧v2/缺角色事件或摘要引用被再次反思 | PASS（本地） | evidence-gate v2/缺角色/summary/forward/notebook 回灌不可采用；vector-app 实际平台转发扩展至 worker 不进 trait pool | 旧库已被扁平化的转发无法安全追溯，不回写或猜造来源 |
| A-L06 | 用户偏好与机器人自己的暂时喜好 | PASS（本地） | engine-integration：真实三次独立 producer 事件累计候选，审核采用，下一 Replyer 中保留 user 主体；runtime 用户profile作用域过滤 | 不把用户喜好改为机器人喜好；归纳语义由边界脚本给出 |
| A-L07 | 新反证或明确纠正 | PASS（本地） | engine-integration 管理 CAS 更正后下一真实 Replyer 不再见旧偏好；runtime 更正在途材料阻止发送 | 普通自然语言反馈不自动等价于已授权结构化 profile 修正；语义效果待回放 |
| A-L08 | chat候选尝试global晋升 | PASS（本地） | learned-self-evidence-gate：未经授权 chat→global 被拒，跨群材料不拼接 | 按原验收 A-L08 的拒绝扩域契约验收；原审计额外要求授权晋升正例属于扩展能力，未实现 |
| A-L09 | TTL到期、人工采用/拒绝/撤销、并发回滚 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 本地状态契约通过；不代表管理 HTTP 主链 |
| A-C01 | 加载旧配置、保存其他设置、分群覆盖 | PASS（本地） | social-app-integration：旧库/配置迁移、显式选择、重启和回退 | 合成旧库，不是生产副本 |
| A-C02 | 新模式参数缺失/非法/极端值 | PASS（本地） | social-console：缺省/极端值，以及 NaN/±Infinity/string/null/object/array 均归一为有界非负整数 | 配置归一化与真实 API；不穷举所有 JavaScript 对象 |
| A-C03 | 功能从未使用或已关闭时GET状态 | PASS（本地） | social-console 与 interest-app：未用GET不建表；修复social已选但未建表时500 | 使用宿主临时数据库 |
| A-C04 | 取消既有意图、缺账号、跨chat ID、URL token写入 | PASS（本地） | social-console：取消鉴权/缺账号/跨会话/URL token；interest-app：配置写入作用域和确认 | 真实管理员凭据未使用 |
| A-C05 | Planner决定回复但guard放弃或投递失败 | PASS（本地） | 真实 Chromium：实际 guarded session 的完整 HTTP 无合成凭据，页面区分 reply 计划/未发送及 guard 原因；management-ui 候选证据/转义 | 检查合成机密标记及页面契约；不宣称证明任意未来模型文本绝不含秘密 |
| A-C06 | 会话详情、材料来源、候选证据和待办 | PASS（本地） | 真实 Chromium：实际 guarded session 的完整 HTTP 无合成凭据，页面区分 reply 计划/未发送及 guard 原因；management-ui 候选证据/转义 | 检查合成机密标记及页面契约；不宣称证明任意未来模型文本绝不含秘密 |
| A-C07 | 切模式、重启、旧会话浏览、桌面/窄屏 | PASS（本地） | 真实 Chromium：模式回退 → app stop/start → 同一历史 session 重新打开，1440/390px；原兴趣保存/确认/冲突/取消仍通过 | 隔离数据与浏览器 profile；其他无关页面不纳入 Social 验收 |
| A-H01 | 旧库副本 -> 配置加载 -> createApp -> 状态读取 -> 显式选择social | PASS（本地） | social-app-integration 真实createApp，旧合成库迁移/重启/回退 | 不替代生产迁移验证 |
| A-H02 | 真实入站 -> lease -> Scene -> Planner -> Context -> Replyer -> sender边界 -> Completion v3 -> ack | PASS（本地） | social-runtime 与 interest-app 真实入站/SQLite/Manager/Orchestrator/Sender/ack | 模型/协议边界模拟 |
| A-H03 | 普通回复完无人接 -> tick -> 新相关事件 | PASS（本地） | interest-app：真实普通reply发送 → 无回应tick零调用 → 新相关人类事件进入Planner并ack；另验证held后仍处理新人类输入 | 模型返回可控，未证明真实模型回复自然度 |
| A-H04 | 有来源initiative -> 重启 -> 到期 -> 重新判断 -> partial/unknown | PASS（本地） | interest-app：配置来源 → pending → stop/start → due → partial/unknown → 再重启held | 外层模型/协议模拟，未绕过Sender/SQLite |
| A-H05 | 写episode/污染历史 -> 向量就绪 -> 三入口召回 -> CAS归档 -> 新run及在途draft | PASS（本地） | social-vector-app：真实 createApp/注册插件/Notebook/sqlite-vec/三消费者/CAS/排队guard/新run 连续轨迹 | 仅 embedding、模型、OneBot 外边界模拟；没有替换内部检索/worker/Sender |
| A-H06 | 原始v3人类互动 -> episode保存 -> 候选累计 -> review -> 采用 -> 更正/过期 | PASS（本地） | engine-integration：真实 v3 → worker episode/候选 → review/采用 → 下一prompt → CAS更正 → 下一prompt移除 | 本轮补足先前未连续验证的更正后新run；拆批共根另有真实轨迹 |
| A-B01 | 直接问一个具体短问题 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B02 | 群友彼此完整对话 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B03 | 两组人同时聊技术和娱乐 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B04 | 对方生成途中说“找到了不用了” | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B05 | 机器人开玩笑后无人回应 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B06 | 新公共资料与共同兴趣相关 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B07 | 同类梗图连续出现 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B08 | 群友认真低落或认真求助 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B09 | 技术话题包含retry、queue、错误码 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B10 | 被问身份与现实经历 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B11 | 一次有意义的共同经历，之后再提起 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
| A-B12 | 连续多轮比较强的人设要求 | LIVE_NOT_RUN | 未调用真实模型/QQ | 真实自然度、成本、延迟和群聊效果需独立授权与实际证据 |
