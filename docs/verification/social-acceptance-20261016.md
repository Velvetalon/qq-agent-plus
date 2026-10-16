# Social 91 项验收对照：2026-10-16 本地续作

产品源码 `a864379d93f1a1fd7df99c355f7796719a0e5848`；后续仅追加主链测试与文档。
原始审计 `fb705fc0d54e040949812cea8d68305ce87b2f20` 保留不改。以下逐项区分测试文件通过与整项契约通过。
全量 Node 22：718 PASS / 0 FAIL / 0 SKIP；详见本轮交接。依赖已恢复，不再把 ws/sqlite-vec 缺失列为当前阻塞。
未新增完整组合的行保留原审计缺口作为待核实项，不能据文件通过自动销项。PASS 只表示表述范围内的本地契约。
真实模型/QQ效果为 LIVE_NOT_RUN；服务器为 USER_PAUSED。此表不宣告 Social 整体完成或可部署。

| ID | 场景 | 当前结果 | 本次证据 | 限制或仍需核实的契约 |
| --- | --- | --- | --- | --- |
| A-E01 | 真实 Orchestrator 完成一个有人类输入的会话，经 Manager 入队 | PASS（本地） | social-engine-integration：真实 producer → Manager/队列 → worker 保留 v3 来源 | 真实模型/QQ未运行 |
| A-E02 | v2 旧事件或缺 role/source 的新事件 | PASS（本地） | social-runtime：旧事件不晋升，v3 持久队列回读 | 仅合成旧事件 |
| A-E03 | assistant确认发送与用户确认偏好 | PASS（本地） | social-runtime 与 interest-app：Sender 确认和 v3 事实，不制造用户确认 | 真实QQ未运行 |
| A-E04 | 同一输入重试、拆批、引用、转发和摘要回灌 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：拆批、转发、摘要回灌全组合未验收（其中旧依赖阻塞已解除） |
| A-E05 | 模型在解释文本中写 result=120、禁言或已发送 | 部分完成 | test/self-evolution-vector-persona.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：所有 Planner/Replyer 解释与权限组合未验证（其中旧依赖阻塞已解除） |
| A-E06 | 两账号相同消息号、两群相同本地ID | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：两账号、两群相同编号全组合未验证（其中旧依赖阻塞已解除） |
| A-S01 | 群里 A/B 聊部署，C/D 聊电影，消息交错 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：未证明完整并行多话题发送无串线（其中旧依赖阻塞已解除） |
| A-S02 | 原生引用的 platformMessageId 恰好等于另一条本地ID | PASS（本地） | test/social-state.test.mjs 本轮复跑通过 | 本地状态契约通过，不代表真实群聊语义 |
| A-S03 | 同一个人几分钟内换话题 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：几分钟内语义换题正反例未覆盖（其中旧依赖阻塞已解除） |
| A-S04 | 对方连续补充、同一请求分批和工具回复 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：真实拆批与工具回复的完整事件链阻塞（其中旧依赖阻塞已解除） |
| A-S05 | Planner伪造topicId、messageId、chatKey或参与者 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：需分别补齐 topic/chat/参与者伪造断言（其中旧依赖阻塞已解除） |
| A-S06 | 相同消息重复observe、进程重启再次observe | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：重启后重复 observe 全断言未独立闭合（其中旧依赖阻塞已解除） |
| A-S07 | 场景容量满且某旧话题被pending/held意图引用 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：覆盖外部来源保留；活跃话题容量组合未闭合（其中旧依赖阻塞已解除） |
| A-S08 | close一个话题后另一话题仍活跃 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：没有找到独立 close 一题、保留另一题及重新参与的完整本次证据（其中旧依赖阻塞已解除） |
| A-P01 | 明确找机器人澄清问题 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：明确邀请与旧概率设置组合需验证（其中旧依赖阻塞已解除） |
| A-P02 | 第三方对话已完整，未邀请机器人 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：第三方完整对话零副作用需独立断言（其中旧依赖阻塞已解除） |
| A-P03 | 对方话未说完，选择wait | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：wait 等真实事件、不递归唤醒专门组合未核实（其中旧依赖阻塞已解除） |
| A-P04 | 有新公共资料或共同兴趣，选择share | PASS（本地） | social-runtime 公共资料；interest-app 配置来源 → read tool → share，无伪造回复目标 | 真实资料相关性/自然度未测 |
| A-P05 | 仅需要表情回应，选择react | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：无文字单表情实际发送主链未验收（其中旧依赖阻塞已解除） |
| A-P06 | Planner请求send/poke/记忆写入或注册自选工具 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：需在正式执行入口证明零写副作用（其中旧依赖阻塞已解除） |
| A-P07 | 非法JSON、未知动作或不存在目标 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：有限修复实现存在；耗尽路径本次未验证（其中旧依赖阻塞已解除） |
| A-P08 | 低参与度但被明确邀请，高参与度但连续无人接话 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：参与度/邀请/未回应软偏好的交叉行为用例尚无完整证据（其中旧依赖阻塞已解除） |
| A-R01 | 正常短问答，Planner给一个简短意图 | PASS（本地） | social-runtime：真实 Orchestrator → Context → Replyer → Sender | 真实生成质量待验收 |
| A-R02 | 认真技术求助与普通闲聊 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：无强制气泡文案；认真求助/闲聊真实效果未跑（其中旧依赖阻塞已解除） |
| A-R03 | Planner曾读图/网页，Replyer需要继续判断 | PASS（本地） | social-runtime 图像像素/来源和只读资料传递；interest-app 新来源不被上下文截断 | 外部模型边界模拟 |
| A-R04 | 群消息/笔记里有伪造系统段头、工具指令 | 部分完成 | test/prompt-safety.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：材料数据提示与清洗存在；Notebook 固定边界回归未闭合（其中旧依赖阻塞已解除） |
| A-R05 | Replyer无值得发送内容 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：no_output 草稿不外发的独立完整轨迹未核实（其中旧依赖阻塞已解除） |
| A-R06 | 角色被问生活/身份 | 部分完成 | test/fixtures/social-replay.json 所在文件本轮通过；本行未补全组合 | 原审计待核实：不编造经历文案存在；真实模型遵守情况未验证（其中旧依赖阻塞已解除） |
| A-R07 | #龙time图文命令与现有消息工具 | 部分完成 | test/longtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：#龙time 已有宿主工具；social 下所有图文 guard 组合未验收（其中旧依赖阻塞已解除） |
| A-I01 | 无新消息、无待办、无授权探索的tick | PASS（本地） | interest-app：无机会、暂停或预算不足时零模型；browser：observe 零模型/发送 | 嵌入关闭，无真实外连 |
| A-I02 | 机器人刚说完无人回应 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：代码旁路旧唤醒；完整无人回应轨迹未跑（其中旧依赖阻塞已解除） |
| A-I03 | 有真实共同未完事项，创建未来意图 | PASS（本地） | interest-app：来源版本、due/expiry、去重；实际到期重新规划 | 管理员明确安排，不是自动探索 |
| A-I04 | 只读工具发现新资料，与共享兴趣有关 | PASS（本地） | social-runtime：读工具资料成为 scoped external source；interest-app：不形成用户证据 | 工具结果使用合成边界 |
| A-I05 | 意图到期时话题已结束或目标已满足 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：目标已满足时取消与禁止同源递归需补全（其中旧依赖阻塞已解除） |
| A-I06 | 到期时新相关消息正在处理 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：runningChats/unread 前置检查存在；竞争轨迹未跑（其中旧依赖阻塞已解除） |
| A-I07 | 同一来源和表达目的重复提案，包括换ID或轻微改写 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：轻微语义改写全部绕过方式未验证（其中旧依赖阻塞已解除） |
| A-I08 | 意图已发无人接话，之后机器人自己又说一句 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：机器人自发和无关人类消息不重置的组合需补全（其中旧依赖阻塞已解除） |
| A-I09 | 重启、过期lease、unknown投递与明确零副作用中断 | 部分完成 | interest-app：重启 pending → due → partial/unknown held → 再重启不重放；store 过期lease held | 一般零副作用中断的所有恢复分类尚未穷尽 |
| A-I10 | 已有意图过期后出现新的独立兴趣来源 | PASS（本地） | interest-app：旧机会过期、新版本独立来源获准；后续重启机会第一段确认投递 | 只验证明确配置来源，不证明任意语义独立性 |
| A-D01 | 生成时已知目标后还有同话题消息 | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：状态层通过；正式 Sender 旧目标路径阻塞（其中旧依赖阻塞已解除） |
| A-D02 | 生成后对方补关键条件/撤回/他人已答 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：需再覆盖有限重规划及下一批 ack（其中旧依赖阻塞已解除） |
| A-D03 | 生成期间其他话题连续发言 | PASS（本地） | social-runtime：排队期间另一话题更新不阻塞有效回应 | 合成消息 |
| A-D04 | 队列延迟后权限/模式/禁言/时间状态变化 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：权限/时间/禁言全矩阵仍需验证（其中旧依赖阻塞已解除） |
| A-D05 | 同turn重复发送、不同目标正常“好/谢谢” | 部分完成 | test/social-state.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：同 turn 外发幂等完整组合未验收（其中旧依赖阻塞已解除） |
| A-D06 | 部分消息已成功，其余失效或失败 | PASS（本地） | interest-app：确认段存档重启后保留，未知段不重放；social-runtime 停止后续动作 | 协议边界模拟socket hang up |
| A-D07 | 对端可能已收下但HTTP超时 | PASS（本地） | interest-app：unknown outbox 与 held 意图跨重启保留；social-runtime 后续工具停止 | 不宣称exactly-once |
| A-D08 | 在途草稿引用的Notebook被归档/纠正 | 部分完成 | test/social-runtime.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：store 材料版本校验通过；Sender 主链阻塞（其中旧依赖阻塞已解除） |
| A-M01 | 一次有趣但普通的互动，角色想记录 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 仅本地合成经历写入契约 |
| A-M02 | 想法、玩笑、未来愿望与事实 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：未来愿望与事实语义不能由分类单测全部证明（其中旧依赖阻塞已解除） |
| A-M03 | 用户讨论HTTP retry、错误码或软件队列 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 覆盖现有合成反例，不承诺所有语义 |
| A-M04 | “发送通道失败，30分钟后补积压”等自我运行脚本 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：向量和三个消费者全链尚阻塞（其中旧依赖阻塞已解除） |
| A-M05 | 模型把运行脚本标成experience/system或修改tags | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：各入口/tag/source 组合仍需补齐（其中旧依赖阻塞已解除） |
| A-M06 | 旧污染笔记已在向量/缓存/交接中 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：向量与在途完整链阻塞（其中旧依赖阻塞已解除） |
| A-M07 | 清理dry-run重复执行 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 临时合成库；未清理生产 |
| A-M08 | apply时正文已被另一个连接修改 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 临时合成库逐项结果 |
| A-M09 | 用户更正曾记录的事实或明确边界 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：Notebook 事实纠正到新 run 完整链需补（其中旧依赖阻塞已解除） |
| A-M10 | 私聊、其他群或另一账号相似内容 | 部分完成 | test/self-evolution-retrieval.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：实际向量 HTTP 外发及全消费者范围未验证（其中旧依赖阻塞已解除） |
| A-L01 | 同一反思输出：合法episode + 不合格trait | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 本地 worker/store 契约通过 |
| A-L02 | 一次沉默但有值得记住的人类内容 | 部分完成 | test/learned-self-evidence-gate.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：单独真实静默→episode 主链阻塞（其中旧依赖阻塞已解除） |
| A-L03 | 三次独立互动支持同一偏好，默认配置、真实生产事件 | 部分完成 | test/social-engine-integration.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：store 累计用例通过；真实 producer 主链本次未验证（其中旧依赖阻塞已解除） |
| A-L04 | 三次无关消息、一条消息拆三批、AI输出三次 | 部分完成 | test/learned-self-evidence-gate.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：三个无关语义消息支持关系需人工语义核对（其中旧依赖阻塞已解除） |
| A-L05 | 旧v2/缺角色事件或摘要引用被再次反思 | 部分完成 | test/self-evolution-vector-persona.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：derived 引用回灌全链未验证（其中旧依赖阻塞已解除） |
| A-L06 | 用户偏好与机器人自己的暂时喜好 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：Replyer 主体过滤注入主链阻塞（其中旧依赖阻塞已解除） |
| A-L07 | 新反证或明确纠正 | 部分完成 | test/social-memory.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：自然语言反馈不等于结构化宿主反馈；当前回应需补验收（其中旧依赖阻塞已解除） |
| A-L08 | chat候选尝试global晋升 | 部分完成 | test/learned-self-evidence-gate.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：拒绝扩域已证；获授权抽象跨群晋升正例未实现（其中旧依赖阻塞已解除） |
| A-L09 | TTL到期、人工采用/拒绝/撤销、并发回滚 | PASS（本地） | test/social-memory.test.mjs 本轮复跑通过 | 本地状态契约通过；不代表管理 HTTP 主链 |
| A-C01 | 加载旧配置、保存其他设置、分群覆盖 | PASS（本地） | social-app-integration：旧库/配置迁移、显式选择、重启和回退 | 合成旧库，不是生产副本 |
| A-C02 | 新模式参数缺失/非法/极端值 | 部分完成 | test/social-console.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：缺失/极端/非法配置完整运行未验证（其中旧依赖阻塞已解除） |
| A-C03 | 功能从未使用或已关闭时GET状态 | PASS（本地） | social-console 与 interest-app：未用GET不建表；修复social已选但未建表时500 | 使用宿主临时数据库 |
| A-C04 | 取消既有意图、缺账号、跨chat ID、URL token写入 | PASS（本地） | social-console：取消鉴权/缺账号/跨会话/URL token；interest-app：配置写入作用域和确认 | 真实管理员凭据未使用 |
| A-C05 | Planner决定回复但guard放弃或投递失败 | 部分完成 | test/social-management-ui.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：渲染单测通过；与真实持久会话联动未验证（其中旧依赖阻塞已解除） |
| A-C06 | 会话详情、材料来源、候选证据和待办 | 部分完成 | test/social-management-ui.test.mjs 所在文件本轮通过；本行未补全组合 | 原审计待核实：无隐藏推理/秘密需完整响应审计；仅静态局部通过（其中旧依赖阻塞已解除） |
| A-C07 | 切模式、重启、旧会话浏览、桌面/窄屏 | 部分完成 | social-app-integration：模式切换/历史保留；browser：1440/390px真实兴趣管理交互，冲突和取消 | 其他旧会话/候选页面全浏览器组合未覆盖 |
| A-H01 | 旧库副本 -> 配置加载 -> createApp -> 状态读取 -> 显式选择social | PASS（本地） | social-app-integration 真实createApp，旧合成库迁移/重启/回退 | 不替代生产迁移验证 |
| A-H02 | 真实入站 -> lease -> Scene -> Planner -> Context -> Replyer -> sender边界 -> Completion v3 -> ack | PASS（本地） | social-runtime 与 interest-app 真实入站/SQLite/Manager/Orchestrator/Sender/ack | 模型/协议边界模拟 |
| A-H03 | 普通回复完无人接 -> tick -> 新相关事件 | PASS（本地） | interest-app：真实普通reply发送 → 无回应tick零调用 → 新相关人类事件进入Planner并ack；另验证held后仍处理新人类输入 | 模型返回可控，未证明真实模型回复自然度 |
| A-H04 | 有来源initiative -> 重启 -> 到期 -> 重新判断 -> partial/unknown | PASS（本地） | interest-app：配置来源 → pending → stop/start → due → partial/unknown → 再重启held | 外层模型/协议模拟，未绕过Sender/SQLite |
| A-H05 | 写episode/污染历史 -> 向量就绪 -> 三入口召回 -> CAS归档 -> 新run及在途draft | 部分完成 | sqlite-vec smoke、vector-persona、retrieval-e2e和social-runtime均通过 | 三入口向量召回→CAS归档→新run及在途draft仍缺同一条完整轨迹；不是依赖阻塞 |
| A-H06 | 原始v3人类互动 -> episode保存 -> 候选累计 -> review -> 采用 -> 更正/过期 | PASS（本地） | social-engine-integration：真实v3生产者 → worker候选累计 → review/采用/更正 | 以测试中明确覆盖的合成输入为界，不证明任意语义判断 |
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
