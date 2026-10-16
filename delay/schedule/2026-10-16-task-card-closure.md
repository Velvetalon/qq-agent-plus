# 当前任务卡逐项收口：Social SC0–SC8 + F4

2026-10-16，Dot 环境本轮可执行；仓库 `/workspace/qq-agent-plus`，仅本项目。
产品/全量测试候选：`6ae135a9dff17eb309b3ec4989faaa063834e7b2`。
基于上一轮 `14b4a7131596ee0e0e7d83ea87dc1bc75581a2d8`，仍在
`fix/deploy-notebook-gate-20261016`，独立草稿 [PR #1](https://github.com/Velvetalon/qq-agent-plus/pull/1)。
未合并 main，未发 tag/Release。旧报告保留原始时点，不改写成当时已经通过。

本轮授权已明确包括 F4；不再等待普通实现选择。计划见
[ready-vector closure](../../plan_doc/2026-10-16-f4-ready-vector-closure.md)。
当前任务以 [SC 开发卡](../../plan_doc/2026-10-13-social-conversation-development-plan.md)、
[91 项验收](../../plan_doc/2026-10-13-social-conversation-acceptance.md) 和
[F4 既定设计 §5](../plan/2026-09-28-functional-repair.md) 为准。

## 任务卡全部阶段

“完成并验证”限定本地宿主契约；外部效果单列阻塞，不意味着整项产品验收完成。
逐用例及限制继续保存在 [91 行矩阵](../../docs/verification/social-acceptance-20261016.md)：
**74 项本地契约 PASS，5 项语义验收未运行，12 项真实行为回放未运行**。

| 卡项 | 已完成并验证的范围与代码 | 真实验收证据 | 尚不能完成的部分 / 最小解锁动作 |
| --- | --- | --- | --- |
| SC0 接管/协议/所有权 | 分支基线、独立模块、v3/材料/意图最小契约，隔离测试目录 | AGENTS、takeover-contract、git状态；social-app-integration 的旧库/显式切换/重启 | 本地完成；无新增凭据或环境设置 |
| SC1 事件与现场 | events/state、Manager 保留根来源；转发派生类型；账号/群隔离、话题容量、重放幂等 | E01–06、S01–08；engine-integration 三个真实引用批次只有一个根，state reopen | 本地契约完成；真实平台漏收/扩展字段不能由脚本保证 |
| SC2 Planner/Replyer | Orchestrator 两阶段、工具硬权限、来源上下文、单条/表情/no_output、预算、longtime 宿主路径 | P01–07、R01/R03–05/R07、H02；runtime、vector-app、prompt 与 longtime 回归 | P08/R02/R06 真实模型软偏好、长度、身份真实性未运行；需允许的模型端点、明确预算/数据范围，先离线回放，不默认 QQ 发送 |
| SC3 意图/投递 | state/interests、真实tick、去重/期限/额度、并发前置、guard、outbox/unknown；已观察群禁言阻止发送 | I01–10、D01–08、H03/H04；interest-app stop/start、partial/unknown held 再重启；runtime队列矩阵 | 本地契约完成；真实QQ协议超时/漏收和禁言同步需限定测试群与明确发送许可；当前不得尝试 |
| SC4 记忆与撤销 | Notebook policy/向量/三消费者统一；精确读取、CAS更正/归档、在途材料失效、普通经历可写、污染脚本隔离 | M01/M03–10、L01/L02、H05；social-vector-app真实装配、memory/cleanup测试 | M02 事实/愿望/玩笑语义需模型回放；历史真实库清理未授权，需恢复服务器权限、只读清单、一致备份及逐项确认 |
| SC5 候选/反馈 | evidence gate、候选支撑/反证/根、人工采用、TTL/CAS纠正/撤销；跨群未授权拒绝 | L03/L05–09、H06；engine-integration 采用→新prompt→更正→新prompt，evidence-gate/cleanup | L04 无关消息的语义蕴含需模型/人工核对；自然语言纠正的表达效果同属真实模型验证，不伪称结构化授权已发生 |
| SC6 配置/控制台 | 设置、scoped API、确认/CAS、关闭读历史/取消、计划与投递区分、材料/候选展示 | C01–07；实际Chromium保存/冲突/取消/模式回退/重启历史会话，1440/390px，HTTP无合成秘密；补充reasoning标记验证 | 本地完成；真实使用者体验反馈可后续补充，未以此阻止本地工作 |
| SC7 集成/回放/交付 | 真实createApp/Orchestrator/Manager/SQLite/工具/Sender，固定源码完整CI与浏览器；仅外部模型/embedding/OneBot可控边界 | 750 PASS；H01–06连续轨迹；本报告与91行矩阵 | B01–12真实模型行为/自然度/成本/延迟未运行；需批准模型/预算/合成回放数据。实群效果另需QQ许可，不能用mock输出冒充 |
| SC8 生产清理/灰度 | 本地迁移/预览/CAS/回滚能力及部署文档已有；没有线上执行 | 本地app重启/历史保留、cleanup及CAS回归 | **USER_PAUSED**：连接、认证、只读盘点、备份、替换、健康与回滚全部未执行；用户明确恢复后才可开始，涉及凭据传输仍需逐次确认 |
| F4 三入口纯查询 | 按下面子项修复完成，本地所有消费者回归通过 | notebook-ready-vector、social-vector-app、retrieval/e2e、functional-repair | 实际embedding中文语义和距离阈值校准阻塞于服务/费用授权；不再存在等待确认的词法策略实现选择 |

以上当前卡不要求新增通用队列、新模型或自动global晋升。历史 LSR2 的跨群正例
不能覆盖当前 SC5/A-L08 的授权范围约束；未经授权不跨群、不拼接私聊原文。
历史 LSR1 的真实 profile reset 与 SC8 一样仍被明确禁止。本地 LSR1–4 的
cleanup/evidence/policy/metadata/TTL/CAS 回归均包含在本次全量中，不以历史报告
替代本次测试；PR1/F1/F2 的宿主 embedding capability 与外发授权、PR3/F5 的
证据预算也继续通过。真实服务行为、历史库迁移和人物效果没有被新增授权。

## F4 子项：实现、验证与必要取舍

| F4 要求 | 实际实现/验证 | 状态 |
| --- | --- | --- |
| 三消费者仅 ready 向量；无词法/最近八条回退 | provider删除Notebook词法分支；工具非空query统一semanticSearch；Reflection无列表兜底；真实app关闭embedding前后三入口对照 | 完成并验证 |
| 缺配置/无ready/失败零召回，正常对话继续 | store保留原因；真实app disabled/external-disallowed/503后三入口无旧材料且仍正常结束；不重试或回退 | 完成并验证 |
| 查询不消费文档索引 | 功能测试及新测试分别计document/query；pending时两者0；ready查询不改document计数 | 完成并验证 |
| account/scope/active/revision/profile/tag在查询前过滤 | tags由LIKE改json_each完整值；ready预检共用SQL过滤；其他群和子串标签不产生query；后续当前revision/CAS仍验证 | 完成并验证 |
| NoteHit字段一致，不把摘录称完整正文 | scope/chatKey/tags/distance/isTruncated补齐；自动与Reflection保留；Reflection修正旧id空值映射 | 完成并验证 |
| 精确读取/普通列表无embedding | 既有notebook_search增加规划中的noteId模式，返回完整当前正文/revision；与query/filter冲突拒绝；跨群ID拒绝 | 完成并验证 |
| 取消/配置变更/长输入 | ctx.signal传到vector/client；请求前、响应后检查取消；替换profile/client后丢弃；maxQueryChars保留末端当前输入，64–16000默认4000 | 完成并验证 |
| profile下相关性阈值，不填满topK | maxDistance为排他上限，0–2默认1；只改变查询策略，不重建文档向量；0阈值返回0，diagnostics明确未校准 | 本地机制完成；实际语义校准外部阻塞 |
| 自动召回约5秒独立预算、反思总预算 | 保持provider.timeoutMs=5000与Manager中止信号、reflection taskSignal；手动搜索新增同一信号透传 | 本地机制/取消通过；真实供应商时延未运行 |

对旧测试的调整有明确依据：旧“embedding关闭仍词法命中”正例与 F4 §5.2
冲突，因此改为严格零命中/零请求负例。原重启、scope、revision、生命周期
transcript及动态提示词隔离正例全部保留断言，改用真实Notebook写入和后台
索引函数生成向量；没有预填ready行或替换内部检索，合成向量只在外部边界。
通用 features/retrieval 的既有测试和非Notebook调用方未改策略。

独立复核（实现后再次按接口检查）覆盖：手动工具schema/取消、精确读取范围、
SQL标签边界、查询与索引分离、scope/revision/profile晚到结果、Reflection字段
映射、当前任务全部阶段的证据分类。未使用子代理，也未修改任何生产配置。

## 测试与证据

修复前真实app关闭embedding：工具1条、反思1条、自动context仍含旧记忆；
预期三者皆0。红灯日志 `/tmp/qq-f4-red.tap`。
修复过程中全仓发现5个旧夹具相关失败，保留 `/tmp/qq-f4-regression-discovery.tap`；
修复夹具后 focused 81/81通过，源码原安全断言未降低。

固定候选 `6ae135a9dff17eb309b3ec4989faaa063834e7b2`，Node **22.22.2**：

| 门禁 | 结果 |
| --- | --- |
| test/*.test.mjs | **750 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**，61.0秒 |
| test/local/run.mjs | 9/9，exit0 |
| prompt / render / scroll / usage | 全部exit0；render138、scroll19、usage31 |
| sqlite-vec smoke / strict scan | exit0；扫描0可疑调用 |
| 递归node --check | 254文件全部通过 |
| bash -n 部署脚本 / git diff --check | exit0 |
| 实际Chromium | exit0，0异常、0外部模型请求、0QQ发送；预期合成模型2次 |

完整日志和命令/退出码JSON：`/tmp/qq-social-final-gates-c01qovv2/`；浏览器证据
`/tmp/qq-interest-browser-zHwxDO/`。随后只增强浏览器测试，向真实Social模型响应
注入合成reasoning标记，确认完整HTTP响应及重启持久会话均不含该标记；独立
复跑exit0，日志 `/tmp/qq-f4-browser-reasoning.log`，截图/JSON
`/tmp/qq-interest-browser-mDGIPj/`。源码未变；不把这次单独复跑冒充第二次全仓。
临时证据可能回收，回归脚本与本记录保存在Git。

## 无法在现授权下解除的阻塞与下一步

| 目标动作 | 状态/不能继续的具体原因 | 最小解锁条件 |
| --- | --- | --- |
| A-P08/R02/R06/M02/L04、B01–12实际模型回放 | 未运行；当前不授权付费调用/新增凭据；mock只能证明宿主动作与管线 | 明确批准模型、端点、合成数据范围与成本上限；通过受支持凭据通道配置。可先离线，不默认允许QQ |
| F4中文语义召回与maxDistance校准 | 未运行；没有获授权的实际embedding服务实验 | 指定允许的embedding模型/输入范围/预算，实测正反例与阈值；固定profile记录结果 |
| 真实QQ发送/平台禁言、超时和实群体验 | 未运行；明确禁止真实QQ消息，无法验证平台效果 | 指定测试账号/群、时间窗和具体动作许可；未知发送仍人工核对、不重放 |
| SSH/登录/盘点/备份/替换/健康/回滚 | **USER_PAUSED**，不是网络已恢复的推断；本轮没有尝试 | 用户先明确恢复服务器操作；再按握手→认证→项目只读盘点流程，新增敏感传输逐次确认 |
| 历史profile/Notebook生产清理 | 未运行，保留真实数据且没有清理授权 | 获准只读审计后给出清单/备份/目标revision，再逐项CAS操作授权；禁止不可恢复删除 |

这些阻塞不是工具拒绝或审批失败；均为当前授权边界，尚未执行，也没有不确定
远端结果。没有未解决的已知本地测试失败，不因此宣称完整产品验收或上线完成。
原线上SHA、远端备份、容器/目录归属及健康状态本轮仍未知，无远端变更或回滚。
