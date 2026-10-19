# Thinking 审核兼容与最小消息ID提示修复

接管时间：2026-10-19 23:55（Asia/Hong_Kong），允许跨日完成。基线 `36a6bd94e12fef742553c6824cc5938f244796e8`。
主协调者亲自阅读全局分工、仓库指令、[最新进度](../delay/schedule/2026-10-19-local-takeover-face-review.md)、配置归一化、审核函数、宿主预算/取消接线、messaging facade及工具提示后确定此方案；不委派架构分析或方向判断。

## 目标和已知事实

1. 指定 `qwen/qwen3.8-27b-uncensored:thinking` 的原identity回放中，审核用完768 completion tokens（含511 reasoning tokens）而没有完整JSON，另一次在15002ms超时。当前生产审核、宿主reservation及请求timeout均写死768/15000。单纯放大模型请求却不调整reservation会破坏共享预算。
2. `midHint`调用完整store.recent，但messaging facet不提供该方法。错误引用参数因而变成`recent is not a function`。不得为了错误提示暴露完整store或其他聊天内容。
3. 旧基线Windows已有44个全量失败及3跳过；本轮不得改弱或skip这些测试。SC8/真实QQ/生产部署仍暂停。

## 主协调者确定的接口和边界

### 有界审核设置

- 在既有 `conversation.social` 增加高级设置 `reviewMaxOutputTokens`、`reviewTimeoutMs`。旧配置保持768tokens/15000ms，不自动切模型、模式或改生产配置。
- `draft-review.js` 作为单一纯策略所有者，导出默认值和归一化函数。输出token范围128..4096，timeout范围1000..60000ms；空白、布尔、对象、NaN/Infinity使用默认，有限数值/数字字符串取整并夹界，不能用0禁用审核。配置读写与运行期同用该策略，覆盖直接内存注入。
- 新模型测试及未来显式生产设置使用2048tokens/45000ms；这在既有live transport的2048输出硬上限内，不放大其100call/800000token/30min总上限。真实复验不自动重试失败请求。
- Orchestrator在本轮快照固定归一化设置，传给默认reviewer。complete边界无论注入reviewer传什么，都以该设置覆盖maxTokens，reservation必须是估算prompt+同一输出上限，HTTP timeout及AbortSignal.timeout同用设置，并继续被原runSignal/整轮deadline打断。4次审核/2次拒绝/可见动作/探索与run token预算不变。
- 审核响应明确`finishReason=length/content_filter`时返回可观测的`REVIEW_INCOMPLETE`，即使恰有可解析JSON也不能放行。未知/缺失finishReason保留旧兼容；非法JSON仍拒绝，不修复、截取思考或降低证据标准。
- 不增加response_format网关特性、不修改底层LLM协议、不关闭thinking或审核，不提前承诺2048/45000必能解决全部真实语义问题。若真实结果仍不兼容，保留失败并由主协调者继续决策。

### 最小消息ID提示

- messaging的store facet新增只读 `recentMessageIds()`：宿主绑定当前chat，固定最多读60条，仅返回最后8个去重的合法整数platformMessageId字符串（允许负ID），不返回正文、发送者、其他chat、数据库或完整recent能力。入参不能改绑定chat。
- `midHint`优先使用该窄能力；legacy完整store可走可选recent兼容路径。两者都没有时返回可行动的通用提示，不能崩溃或伪称存在ID。未知/非法引用仍被拒绝，0sender调用，禁止补造数字ID。
- 保留现有发送目标、权限、预检、取消和unknown门。修复真实fixture报错，不改原fixture输入使其看起来通过。

## 单一写入所有权

主协调者写：
- `src/conversation/draft-review.js`、`src/core/config-legacy.js`、`src/core/orchestrator.js`；
- `src/plugins/context.js`、`src/tools/tools-core.js`；
- `test/social-review-budget.test.mjs`、`test/social-console.test.mjs`、`test/plugin-tool-context.test.mjs`；
- `test/live/bounded-chat-transport.mjs`、`test/live/social-chat-replay.mjs`、`test/live-replay-profile.test.mjs`、live README；
- 本计划、delay进度及脱敏结果。

不改UI、模型/人物卡、数据库schema、生产配置、依赖或未跟踪本地备忘。没有新实验模块或独立服务，沿用现有管理鉴权及配置持久化。

## 验收标准和顺序

先存档计划 → 新增失败用例并确认红基线 → 主协调者实现/专项自测 → 独立只读复核既定标准 → 必要时主协调者返修 → 原场景有界真实复验 → 全量/基线失败对照和进度 → 普通commit/push origin。

必须覆盖：
1. 旧默认不变；上下限/非法值安全；配置保存/重载/无关patch保持两参数。
2. 实际review请求、reservation、timeout与配置一致；预算不足在HTTP之前拒绝；未知usage保留真实reservation；run取消/权限变化仍零后续投递。
3. 增大输出预算不接受截断、工具调用、非法JSON或伪造证据；仍仅一次审核请求、无fallback/重试。
4. 有限ID提示同chat、只含合法platform ID、上限8，不泄漏正文；泛用插件无store；legacy/无方法兼容；无效引用经真实工具执行器返回有用错误而非recent崩溃，0发送。
5. 指定模型原short-invitation/identity场景：分别记录正确实际回复、自然沉默、门禁拒绝/无可接受输出、截断/timeout/transport失败。最多先执行这两个场景，不因失败换模型或无限调prompt。凭据只进程认证，原始输入/输出/日志在Git外。
6. 独立复核仅返回具体缺陷、定位和复现证据，不提出新架构或决定下一项任务；设计缺口返回主协调者。最终验收由主协调者完成，真实效果只按观察判定。

停止本轮的条件：两项工程修复经离线正反例与独立复核验证，真实复验完成且未完成语义项如实保留，成果推送并交接；不等于整项目或上线通过。

## 独立复核补正（2026-10-20）

原新增测试检查了updateConfig保存JSON，但未真正调用loadConfig；另有审核限额在planner后读取可变conversationCfg的路径。主协调者亲自核对并裁定两处返修：loadConfig在合并后同用归一化策略，保留其他配置/合法模式且不写回源文件；非法conversation/social容器仅恢复该段默认。审核限额前移到Social运行入口，从既有不可变runSnapshot.config的cfg字段读取，不改变其他Social/分群mode来源。先补真实重载及planner内原地修改全局配置的失败测试，再修复及请求独立复核，不将原实现说成一开始已通过。
