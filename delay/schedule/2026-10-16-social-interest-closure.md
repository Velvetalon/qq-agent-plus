# Social 配置兴趣与恢复链路本地交付

2026-10-16 UTC。仅 qq-agent-plus，环境名 Dot，未修改环境配置或其他项目。
服务器操作保持 USER_PAUSED；没有进行目标服务器重试、登录、部署、替换或清理。

## 候选与变更

产品源码：`a864379d93f1a1fd7df99c355f7796719a0e5848`。
追加主链测试：`6bbbb08c4da43cda8e82dd0bbca42c13b4883549`（仅 test/social-interest-app.test.mjs）。
分支 `fix/deploy-notebook-gate-20261016`，草稿
[PR #1](https://github.com/Velvetalon/qq-agent-plus/pull/1)。
main 仍以 `2be4bccce643d4d40bdc4472e5703f3a109aac2e` 为已知基线；
审计文档分支 `fb705fc0d54e040949812cea8d68305ce87b2f20` 不是产品版本。

新增账号/会话隔离的来源、预算、一次性机会管理，默认关闭。持久配置 CAS、
来源版本、历史、UTC 日额度、单次模型/只读工具限制及取消恢复走真实宿主链。
旧来源及派生资料在模型、工具和发送边界重新校验；发送排队期间撤销会阻止外发。
机会必须关联宿主观察到的活跃话题；启用不自动探索，失败不退还已预留额度。
修复了 Social 已选但尚未建表时状态 GET 500，以及过期已完成意图永久占用额度。
前次 Notebook 边界和来源截断修复继续保留，没有降低已有断言。

使用与回退说明：[SOCIAL_INTERESTS](../../docs/SOCIAL_INTERESTS.md)。
计划：[social-interest-closure](../../plan_doc/2026-10-16-social-interest-closure.md)。

## 执行证据

固定产品源码上 Node **22.22.2**，子进程 PATH 同版本：

| 门禁 | 结果 |
| --- | --- |
| 全量 test/*.test.mjs | 718 PASS，0 FAIL/CANCEL/SKIP，59.8 秒 |
| test/local/run.mjs | 9/9 通过 |
| test/test-prompt.mjs | exit 0 |
| test/render-test.mjs | 138 PASS，exit 0 |
| test/scroll-test.mjs | 19 PASS，exit 0 |
| test/usage-e2e.mjs | 31 PASS，exit 0 |
| scripts/sqlite-vec-smoke.mjs | exit 0 |
| ops scan --strict | 0 可疑调用，exit 0 |
| node --check src/scripts/test/ui | 251 文件全部通过 |
| bash -n 部署脚本 / git diff --check | exit 0 |
| Chromium 真实页面 test/browser/social-interests.mjs | exit 0；1440×900、390×844，横向溢出均 0，取消按钮可达，无脚本异常 |

全量原始合成日志和退出码 JSON：`/tmp/qq-social-interest-gates-4iy4qfih/`。
浏览器截图/JSON：`/tmp/qq-interest-browser-WJYQQy/`。临时证据可能随环境回收；
可执行测试及此结果记录保存在 Git。浏览器测试覆盖真实设置导航、确认门禁、
保存重载、HTML 转义、安排、取消，以及旧版本保存拒绝且保留输入；仅模型、
协议元数据和版本查询等网络边界模拟，无真实外连。

随后只追加测试，产品源码未变：Social 聚焦回归 46/46 通过
（`/tmp/qq-social-interest-final-focused.tap`）；最后扩展的完整 app 用例单独在
Node 22 通过（`/tmp/qq-social-interest-mainchain.tap`）。未把这个单文件结果
冒充又一次全仓运行。它增加以下连续轨迹：

- 配置来源 → pending → stop/start → 到期重评 → 确认第一段、第二段未知 → held →
  再重启不重放；确认内容的聊天存档保留，未知 outbox 保留。
- 普通回复发送后，无回应 tick 零模型；新相关人类输入仍进 Planner 并 ack。
- 首次 Token 不足零调用、模型次数限制、503 不重试/回退、模型期间取消/停源/
  到期、四次只读工具上限均经过真实 app/Orchestrator/SQLite/Manager/Sender。

## 当前范围与未完成项

[91 项逐项对照](../../docs/verification/social-acceptance-20261016.md) 区分了本地通过、
部分覆盖和 LIVE_NOT_RUN。旧依赖阻塞已经解除；不能用 718 通过代替每个完整契约。
配置兴趣入口、预算、取消恢复及其管理交互本轮完成。仍存在本地验收缺口，特别是
A-H05 三入口向量召回→CAS归档→新 run/在途 draft 的同一条完整轨迹，以及表内
标记的多话题/语义/权限组合。词法检索策略与原设计差异仍需独立处理；没有暗改
它或将这些缺口归因于服务器/依赖。Social 整体尚未宣布完成或适合上线。

真实模型自然度、真实 QQ 投递、付费调用均 LIVE_NOT_RUN；未写真实用户数据，
未清理历史 profile。服务器盘点/备份/替换/健康证明均 USER_PAUSED，原线上版本、
备份位置、变更资源与回滚结果没有新事实；本轮未创建服务器备份、未执行回滚。
恢复线上操作须等用户明确恢复，认证如需传输密码/令牌仍应经主对话逐次安全确认。
