# QQAgent 云环境交付记录（2026-10-19）

## 当前结论

本轮交付保存现有实现和真实进度，项目仍为 WIP。最新源码检查点为
`bc0a77d1f65edcc009ac6d5d463af2b7866e31fe`，父提交为原始
`54bf28d9311e592ad09b552ca379baec2606580e`。最新离线单测为
**819 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**；这不替代真实模型最终语义回归。
旧文档的 800 PASS 是此前已提交版本的历史结果。

目标：[Velvetalon/qq-agent-plus](https://github.com/Velvetalon/qq-agent-plus)，
分支 `fix/deploy-notebook-gate-20261016`。用户最新要求允许将未完成成果提交并推送；
旧交接中的“仅本地、不 push”不是本轮授权状态。
计划见 [云交付计划](../../plan_doc/2026-10-19-cloud-handoff-delivery.md)，
实现计划见 [语义发送审核](../../plan_doc/2026-10-19-semantic-send-review.md)。

## 恢复与变更范围

保留原 Git 父历史：

`dc012094febc8521b5253592c854f7b0910db0b3`
→ `b31c24cb5dfa808cf23e50ccf15264dae4ba8c1b`
→ `54bf28d9311e592ad09b552ca379baec2606580e`
→ `bc0a77d1f65edcc009ac6d5d463af2b7866e31fe`。

交接 ZIP 为 255376 bytes，SHA256
`5cedc133bb404336bf309423004a0b906d7a496b3cfadd1b1aa84f45c6d3be5a`。
官方 Library 获取、全部 10 项内部 SHA256SUMS、增量 bundle 均验证成功。
恢复后 24 个 tracked 修改的完整 binary diff 与补丁一致，4 个新文件逐字节一致，
Git 状态与 manifest 完全一致，原索引无 staged 改动。恢复使用 bundle，未重复应用备用邮件补丁。

`handoff-checks.json` 中的 `source_status_sha256` 元数据未能复现；manifest 文本和
恢复状态的 UTF-8 摘要相同，但与该记录不同。完整包/内部文件校验、状态比较和补丁/
新文件比较均通过；该差异原样记录在 [完整性证据](evidence/2026-10-19-cloud-handoff-delivery/handoff-integrity.json)，
没有为匹配元数据删除或改写交接代码。

本轮提交保留全部交接实现，没有修改产品代码或降低测试断言以制造成功：

- mandatory embedding 独立设置页、`Qwen/Qwen3-Embedding-4B` / 2560 维记忆链及既有修复。
- `deepseek/deepseek-v4.1-flash-1017` 聊天与回放修复。
- `draft-review.js` 完整草稿批次语义审核、事实来源/视觉依据/身份声明检查、有限修订、
  预算和审计；宿主、插件 sender facade、Sender 物理分片一致性接线。
- 已有测试的合成审核注入、19 项专项审核/边界单测、浏览器与 live fixture 修订。
  `test/live/` 文件保留供以后显式授权使用，本轮没有启动真实回放入口。

## 本轮实际离线验证

环境为 Linux x64、Node **v24.19.0**，满足项目 `>=22.13.0`；没有新增 Node 22 CI 运行。
依赖按锁文件 `npm ci --ignore-scripts --no-audit --no-fund` 安装，使用独立空 npm 配置；
lockfile 未变。最初把同一个 `/dev/null` 同时作为 user/global 配置导致 npm 配置解析失败，
改为两个独立空文件后安装成功。未执行依赖安装脚本。

| 检查/命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `node --check`，递归 src/scripts/test/ui | 0 | 275 文件 PASS |
| `bash -n deploy.sh deploy-all.sh manage.sh` | 0 | PASS，仅语法检查 |
| `node src/ops.js scan --strict` | 0 | 0 可疑调用 |
| `node --test test/*.test.mjs` | 0 | 819 PASS，0 FAIL/CANCEL/SKIP |
| `node test/local/run.mjs` | 0 | 9/9 PASS |
| `node test/test-prompt.mjs` | 0 | PASS |
| `node test/render-test.mjs` | 0 | 138 断言 PASS |
| `node test/scroll-test.mjs` | 0 | 19 断言 PASS |
| `node test/usage-e2e.mjs` | 0 | 31 断言 PASS |
| `node scripts/sqlite-vec-smoke.mjs` | 0 | sqlite-vec v0.1.9，距离 0 / 1 |
| `node test/browser/embedding-settings.mjs` | 0 | 实际 Chromium 六组检查，0 UI errors |
| `node test/browser/social-interests.mjs` | 0 | 实际 Chromium 五组检查，0 UI errors |
| `git diff --check` | 0 | PASS |

[结构化结果及输出摘要/哈希](evidence/2026-10-19-cloud-handoff-delivery/result.json) 记录每项结果。
所有模型/provider、OneBot 边界使用合成夹具，数据目录位于临时目录；测试进程仅继承
允许列表中的基础环境和测试变量。没有读取已有生产配置或继承真实凭据变量。

系统的 `unshare` 网络隔离因 `/proc/self/uid_map` 只读不可用，未修改系统权限。
实际采用 [本轮原样保存的 Node 外连拦截器](evidence/2026-10-19-cloud-handoff-delivery/offline-guard.mjs)，
在 Socket 连接前拒绝非本地 TCP/UDP；Chromium 增加关闭的 loopback HTTP 代理及后台网络禁用参数。
拦截自检通过；测试期间另拦截了 **27 次非本地 Socket 尝试**，因此不宣称测试天然零外连尝试。
拦截器在建立外部连接前抛错，没有执行真实模型请求或真实 QQ 发送。
保存的拦截器包含当时临时日志路径，仅为本轮证据；复用时应选择新的临时日志位置。

增量秘密扫描覆盖 80 个 blob 版本/工作文件；5 个候选已逐项复核，均为明确 synthetic
常量或非法 URL 拒绝夹具，未发现真实秘密和禁止路径。
见 [扫描摘要](evidence/2026-10-19-cloud-handoff-delivery/secret-scan.json)。这是模式扫描，
不是全历史或完备 DLP 审计。原始模型日志、环境、数据库、node_modules 和浏览器截图未入 Git。

## 已知失败与下一步

1. **A-B07 FAIL（历史真实观察）**：同梗图笑点换措辞复读。新增审核实现与专项 mock
   回归不能证明该真实语义失败已经消失，需后续明确授权的原 fixture 复测。
2. **A-R06 / A-B10 PARTIAL / OPEN（历史真实观察）**：特定身份题通过，但其他场景
   仍有无依据的过去经历/操作声明。不能用局部正例覆盖反例。
3. **最新修复尚未最终真实模型回归**：交接指出独立复核曾发现图片细节幻觉和身份表达
   误拦；现有视觉依据与 host identity 修复已保留。本环境仅做上述离线验证，未重新观察
   真实模型效果，不能报告修复已通过真实验收。
4. 后续复核应分别记录实际可接受回复率、自然沉默、被门禁拒绝/无可接受输出、
   语义新增性和事实/视觉来源；不能把 0 发送或全部拒绝当作修复成功。
5. 原真实模型/embedding 小样本与费用不确定性见
   [历史验收记录](../../docs/verification/real-model-replay-20261019.md)。原始私有证据未随安全包交付，
   此处只保留已入 Git 的摘要，不声称本环境重跑或拥有原始日志。
6. SC8、真实 QQ 平台与生产部署保持 **USER_PAUSED / NOT_RUN**。本次没有合并 main、
   部署、发 tag/Release、发送真实 QQ、取用或保存真实凭据。

上一开发对话因 preview 用量限制中止；这只是原会话的中断原因，不是本轮测试失败或
模型质量结论。本轮用受支持云环境交付代码，没有尝试绕过原会话额度。

## 推送与接手

本记录随独立文档提交保存，后续普通 push 到原分支；最终提交 SHA 和 tree
以远端分支回读及最终交付回复为准。未强推、未删历史、未合并 main。
源码已按交接包保全，以上真实模型/平台事项留给后续明确授权处理，不再阻止本次代码交付。
