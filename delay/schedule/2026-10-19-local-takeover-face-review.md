# 本地接管：表情文字审核与指定 Qwen 实测（仍为 WIP）

日期：2026-10-19，Asia/Hong_Kong。
源码提交：`cd7b7d2a987f7f300bad298bf246ae3508de6473`。
接管基线：`188ba2232d78b4613000c015ecada0f782d3d23f`，该基线已按用户要求推送 origin/main。
本记录随独立文档提交归档；最终远端 SHA 以普通 push 后回读为准。

## 1. 当前结论与授权

- 本轮完成一个已复现的硬边界修复：`send_face.text` 不再绕过 Social 发送前审核。
- 用户指定测试和后续上线均使用 NanoGPT 聊天 `qwen/qwen3.8-27b-uncensored:thinking`（thinking on、无其他模型fallback）及 Embedding `Qwen/Qwen3-Embedding-4B` / 2560维。本轮已按此组合真实调用，不再把旧DeepSeek结果当新模型验收。
- 真实短问答有一个正确输出；真实身份回放 **NOT_PASS/OPEN**，审核输出截断和超时导致两轮均无可接受输出，不能算自然沉默或身份通过。
- 真实4B独立Notebook索引/重开/检索小样本通过，不等同chat→reflection→Notebook全链新模型验收。
- 本轮不是整项目完成或上线通过：B07/R06/B10仍开放，SC8/真实QQ/生产部署仍 **USER_PAUSED / NOT_RUN**。

计划由主协调者亲自确定并在编码前存档：[表情文字审核计划](../../plan_doc/2026-10-19-social-face-caption-review.md)、[指定模型回放计划](../../plan_doc/2026-10-19-qwen-replay-profile.md)。执行者仅按既定标准独立复核，不承担架构分析、技术路线或下一步方向判断。

## 2. 修复与实际接线

编码前的最小离线复现：拒绝型宿主审核回调未被调用，合成sender仍发送caption，`reviews=0 / syntheticSends=1`。新增13项测试修复前 **2 PASS / 11 FAIL**，失败记录保留。

实现使用原 [messaging facade](../../src/plugins/context.js)、[Social宿主](../../src/core/orchestrator.js)、[Sender](../../src/onebot/sender.js) 和 [send_face工具](../../src/tools/tools-core.js)：

1. 非空白caption先走现有审核，复用调用/拒绝/令牌/时间预算；纯表情不增加模型请求。
2. face caption是一条协议文字段，不做Markdown剥离或文字批次分片，仅复用现有CQ规范化；审核文本与实际OneBot段逐字一致。
3. 审核前和入队前快照caption，审批不一致在创建chain/outbox之前拒绝；原options在异步等待期间变化不能替换文字。
4. 宿主chat/run/signal/last-moment guard、unknown保护和原Sender/Outbox不变。caption+face计一条物理消息，成功审批批次记录delivered=1。
5. 工具保留预检拒绝和有限修订元数据，不把零次发送记成外发失败。旧模式caption和纯表情行为保留。

本轮没有新增数据库schema、外部服务、运行模式或启用配置，没有改人物卡、生产API设置或阈值。

## 3. 独立复核与返修事实

独立复核原始13项通过，但发现P2：原审核保留 `[CQ:`，协议在最后一层改为 `[CQ：`。原测试CQ用例只到stub Sender，真实协议正例漏掉CQ。主协调者亲自确认并确定返修：宿主与Sender审批比较同用现有CQ转换，真实协议正例增加大小写CQ，旧审批负例要求0chain/0outbox。独立重跑 **13/13** 及真实宿主CQ探针后通过；原发现未倒改为一开始就通过。

模型回放只读复核另发现key-file环境指针遗留。主协调者确定：读取成功后删除API key及key-file两环境变量，不删除原文件。新增可选dispatcher helper修复无代理fetch传入null的本地错误。该范围独立 **9/9 PASS**；没有放松call/token/deadline/failure-latch限制。

复核的边界：没有执行live入口、读取真实凭据、复跑完整门禁、验证真实子进程继承/代理握手或真实QQ效果。上述限域复核不替代主协调者最终验收。

## 4. 离线门禁与Windows基线对照

环境：Windows，Node v22.22.2，依赖不变。使用仓库外临时数据和Node非本地TCP/UDP拦截器；网络拦截自检通过。Linux现场、systemd和生产访问未运行。

| 检查 | 实际结果 | 退出码 |
| --- | --- | --- |
| 最终专项：caption/draft review/message cap/plugin context/live profile/transport | **62 PASS / 0 FAIL / 0 SKIP** | 0 |
| 当前全量：`node --test --test-concurrency=4 test/*.test.mjs` | **837项：790 PASS / 44 FAIL / 3 SKIP** | 1 |
| 未改动188ba22归档副本，同环境/依赖/并发/拦截器全量 | **819项：772 PASS / 44 FAIL / 3 SKIP** | 1 |
| 两次全量失败名称比较 | 完全一致，新增失败0；本轮新增18项全部通过 | 对比完成 |
| 递归语法 | 278文件通过；后新增helper和最终live入口补检通过，共279唯一文件 | 0 |
| 严格未定义扫描 | 0可疑调用 | 0 |
| 本地回归 | 9/9 | 0 |
| prompt / render / scroll / usage | PASS / 138 / 19 / 31断言 | 0 |
| sqlite-vec smoke | 0.1.9，距离检查通过 | 0 |
| diff check | PASS | 0 |
| 本轮实际浏览器/目标Linux全量 | **NOT_RUN**，本轮无UI变更 | 未运行 |

基线副本由精确188ba22 Git archive恢复在仓库外，仅junction复用未变化的node_modules，没有覆盖本地工作区。既有44项涉及Linux shell/fake Git路径、Windows不支持的POSIX mode预期、SQLite夹具句柄关闭和信号语义。本轮没有修改这些夹具、添加skip或降低断言；同名失败不等于这些问题不存在，也不能声称完整CI已绿。旧云端819 PASS是Linux/旧版本的历史时点。

普通push后回读 [main Actions API](https://api.github.com/repos/Velvetalon/qq-agent-plus/actions/runs?branch=main&per_page=3) 返回 `total_count=0`。本轮未开启/修改工作流，也不能把推送成功当作远程Linux门禁通过。

## 5. 指定模型真实测试：结果分开报告

### Chat canary

精确Qwen模型，6次dispatch/6个HTTP响应，报告32020 tokens；低参与度直接邀请场景有1条内容正确的短问答，最终delivered。期间一次非法引用参数触发既有 `ctx.store.recent is not a function` 工具错误（后续请求携带同一历史错误，不重复计数），另一次重复发送尝试被宿主去重挡住。此小样本不代表总体自然度、身份或视觉通过。

### 身份两轮：NOT_PASS / OPEN

8次dispatch、7个HTTP响应，报告45095 tokens，超时请求保留5191个保守reservation。第一次审核响应finish_reason=length，用完768completion tokens（其中报告511reasoning tokens），没有合法结构化判定；第二次审核在15002ms超时。两轮均为no_acceptable_output，实际可接受回复0，不能当作自然沉默或身份反例已经修复。失败后没有自动重试、换模型、关闭审核或改写原fixture。

聊天两次运行合计14次dispatch、13个HTTP响应、77115已报告tokens。12个响应cost字段之和0.05537645，捕获字段未自明币种；另1个响应与1次超时费用未知，不能当最终账单。聊天运行在当时未提交工作树上，均保存开跑时源码manifest；后续环境清理/代理修复不冒充已用于之前聊天结果。

### Embedding：小样本通过

第一次独立运行在HTTP回应前因 `dispatcher:null` 本地断言失败，记录1次尝试、0回应；原失败保留。主协调者修复三处请求options：无ProxyAgent就省略dispatcher，不修改系统代理、目标或模型。

新目录复测：17次实际HTTP成功，报告424 tokens，6条合成笔记索引为2560维，关库重开后检索、外群隔离和profile mismatch不调用旧向量通过。5正例/3负例可分，2正/1负留出样本通过。夹具校准阈值0.5370144993066788仅在临时fixture使用，没有覆盖生产0.5默认/用户配置。17个响应均未返回cost，实际收费未知。独立脚本没有开跑时源码manifest，不伪造该项证据。

## 6. 安全与证据

所有输入均为已入Git的合成fixture；OneBot回执为合成，真实QQ发送0。密钥以临时环境变量传给测试进程并在读取后清除；没有创建key文件、写QQ持久配置或写Git，项目测试日志和交付证据不记录认证值。此承诺不包含用户消息和工具执行输入形成的会话记录，不能保证该类记录不保留认证输入；本会话不能当作密钥管理器，需限制会话记录风险时应轮换本次密钥。临时数据、原始调用/响应/模型输出和完整失败日志留在仓库外；[结构化摘要和SHA256](evidence/2026-10-19-social-face-review/result.json)不含原始聊天或秘密。模式扫描仅是增量检查，不声称完备DLP。

未跟踪的本地备忘未读取、修改或提交。没有访问上游、生产服务器、生产配置/数据库，没有部署、清理、切模式、解除禁言、tag或Release。

## 7. 主协调者确定的后续优先级（未实施）

1. 针对指定thinking模型，先亲自拟定并存档审核结构化输出与输出/超时预算的兼容方案，再实现和按相同正反例真实复测；不能靠关闭审核、换模型或全静默解决。
2. 修复已真实观察到的messaging错误提示依赖未提供的recent能力；保持最小作用域，不通过暴露完整store权限补洞。需另行方案与测试，当前仅记录缺口。
3. 用同一指定模型继续B07视觉/新增性及R06/B10跨场景正反例；本轮B07未复测，旧FAIL仍开放。完成新模型chat→reflection→4B→新会话召回全链，不能只用独立embedding校准代替。
4. 获取目标Linux的全量/必要浏览器验收，现有Windows失败另行修复或在合适平台验证，不能跳过后宣布全绿。
5. SC8继续USER_PAUSED；以上未闭合前不能宣称可上线，生产操作仍须单独授权。
