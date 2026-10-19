# Thinking 审核与消息ID提示修复：工程验证完成，身份实测受402中断

日期：2026-10-20，Asia/Hong_Kong；本轮于前日23:55接管。
基线：`36a6bd94e12fef742553c6824cc5938f244796e8`。
源码提交：`e870954feb83c48ab89b705d5f9211efcfefc6be`。
[编码前计划与复核补正](../../plan_doc/2026-10-19-thinking-review-compatibility.md)；[脱敏结构化结果及SHA256](evidence/2026-10-20-thinking-review-repair/result.json)。

## 当前结论

本轮已修复两项工程缺陷并通过限定独立复核，不把未完成的真实身份验收判为通过。用户指定模型不变：NanoGPT `qwen/qwen3.8-27b-uncensored:thinking`，Embedding `Qwen/Qwen3-Embedding-4B` / 2560。

- 旧768-token/15秒常量改为有界、可保存并正确重载的审核设置；本轮指定thinking配置2048/45000。实际请求、预留和超时同一快照，严格审核不关闭。
- messaging参数错误提示不再依赖未提供的完整recent方法，只查询当前聊天最多8个合法platform ID，0外发的错误路径不崩溃。
- 原short-invitation合成fixture真实复验有一个正确短答，审核完整stop并确认投递到合成OneBot边界。
- 随后的identity第一条实际请求被供应商 **HTTP402 / Insufficient balance** 拒绝，没有取得新身份判定；其余真实请求被传输层锁闭。该项待余额恢复后复验，不能算语义PASS，也不能据此说所有thinking问题已解决。
- B07/R06/B10、完整新模型记忆链和目标Linux全量仍开放；SC8/真实QQ/生产仍USER_PAUSED。

## 1. 实现边界

审核策略由 [draft-review](../../src/conversation/draft-review.js) 单一纯函数归一化：输出128..4096tokens、timeout1000..60000ms；非法类型/非有限值用旧默认768/15000。`conversation.social.reviewMaxOutputTokens` 与 `reviewTimeoutMs` 在 [配置读写](../../src/core/config-legacy.js) 及运行同用该策略。

[Orchestrator](../../src/core/orchestrator.js) 在planner开始前，从不可变runSnapshot.config生成冻结限额；请求maxTokens覆盖和reservation均使用同一输出上限，AbortSignal及HTTP timeout复用同一值。共享run/探索预算、整轮deadline、4次审核/2次拒绝、可见动作和最终发送门不变。未知usage保留reservation；截断/过滤即使JSON可解析也拒绝REVIEW_INCOMPLETE，不修补JSON来放行。

[messaging facet](../../src/plugins/context.js)新增只读recentMessageIds，固定绑定chat、最多读60条，仅返回最后8个去重的合法非零整数platform ID字符串；不提供正文、其他chat或完整recent。[工具提示](../../src/tools/tools-core.js)优先使用该窄能力，legacy/无能力路径安全降级。原fixture未修改，未增加数字ID来掩盖问题。

未来明确获准上线时使用与测试相同的模型和高级设置；具体非秘密JSON见 [live说明](../../test/live/README.md)。本轮未改生产配置、人物卡、模型、依赖、数据库或UI。

## 2. 红绿测试与独立复核

首轮新增用例红基线：22项 **10 PASS / 12 FAIL**。初版实现专项64通过后，独立只读复核发现两项P2：

1. loadConfig只merge，未归一化新字段。原测试只看保存JSON，没有真正重载。
2. 审核字段在planner后读可变conversationCfg，原地改全局对象可改变已启动轮次的限额，未使用既有runSnapshot。

主协调者亲自核对后确定返修，执行者未补设计/改文件。先新增两反例，预算专项为 **9 PASS / 2 FAIL**；再修loadConfig及读取时点/来源。新测试实际重载越界/非法/字符串/容器配置，保证其他设置与源文件字节保持；planner内修改全局配置后，本轮request/audit/timeout仍为原2048/45000。

返修后独立复跑预算+工具上下文 **24/24 PASS**，原两P2均闭合。复核限域，不冒充独立重跑66项/全量或真实模型效果。

## 3. 最终离线结果

Windows，Node v22.22.2，依赖未变，数据/日志在仓库外；非本地Socket拦截及控制探针启用。

| 检查 | 实际结果 | 退出码 |
| --- | --- | --- |
| 最终专项 | **66 PASS / 0 FAIL / 0 SKIP** | 0 |
| 最终全量，concurrency=4 | **851项：804 PASS / 44 FAIL / 3 SKIP** | 1 |
| 上轮同源码基线 | **837项：790 PASS / 44 FAIL / 3 SKIP** | 1 |
| 失败名称对照 | 完全一致，新增/移除失败均0；新增14项全部通过 | 对照完成 |
| 递归语法 | 280文件PASS | 0 |
| 严格扫描 | 0可疑调用 | 0 |
| local / prompt | 9/9 / PASS | 0 |
| render / scroll / usage | 138 / 19 / 31断言 | 0 |
| sqlite-vec | 0.1.9 smoke PASS | 0 |
| diff check | PASS | 0 |
| 本轮真实浏览器/目标Linux全量 | NOT_RUN，UI未改 | 未运行 |

基线对照使用上轮837项原始日志；已用git diff确认cd7b7d2到36a6bd9的src/test/scripts/package源码无差异，不声称本轮又跑了一次完整基线。44个既有Windows/POSIX、shell/fakeGit和SQLite夹具失败保留，不添加skip或弱化断言，不宣称完整CI已绿。

## 4. 原场景真实复验与费用边界

运行时间2026-10-20 00:07:36至00:08:03（UTC+8）。原short-invitation和identity场景、人物卡、fixture均未改变。

- short-invitation：4次HTTP200，1条内容正确的HTTP404短答；审核实际请求2048输出上限，finish_reason=stop，4927ms，最终delivered。此样本未触发非法引用，提示崩溃的修复由离线工具执行器反例证明，不冒充已在该真实样本触发验证。
- identity：首个planner请求HTTP402，正文Insufficient balance；未取得模型身份输出/审核。传输层在这一请求后锁闭，虽然普通LLM包装器留下本地重试日志，实际没有额外HTTP dispatch。
- 合计5次dispatch/5个HTTP响应，其中4成功、1个402；报告22696tokens，保守reservation26016保留。4个cost字段合计0.0198246，捕获字段未明确币种，不当最终账单；失败请求费用不作猜测。
- 无换模型、换密钥、重试实际请求、余额/扣费接口或更多收费实验。Embedding本轮未重跑，前轮17次4B成功是历史证据，不作为本轮重新验证。
- 此真实运行早于两项P2返修，保留开跑时源码manifest；后两处返修有离线覆盖和独立复核，因402未对最终提交树重跑live，不伪造版本一致证据。

## 5. 安全、恢复条件与剩余工作

密钥仅进程认证，不建立key文件、不写QQ持久配置、源码或Git。此范围不涵盖私有会话/工具执行输入记录。原始输入、模型输出、调用日志和测试SQLite都在仓库外，Git内仅脱敏计数、结论和摘要哈希。未读取/提交未跟踪备忘，未访问上游、生产服务器或生产数据，真实QQ发送0，无部署、tag/Release或清理。

身份实测的下一条件是供应商余额可用；由用户确认后再跑同一固定模型与原fixture，不自动探测账户或换凭据绕过。主协调者继续负责真实结果判断，不能把没有身份输出当成诚实身份通过。B07/R06/B10、完整chat→reflection→4B→新会话召回、Linux门禁和SC8保持各自未完成状态。
