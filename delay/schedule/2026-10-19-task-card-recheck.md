# QQAgent 当前任务卡复核与验证修复

日期：2026-10-19。仓库：`Velvetalon/qq-agent-plus`。
接管基线：`dc012094febc8521b5253592c854f7b0910db0b3`。
继续现有 `fix/deploy-notebook-gate-20261016` 和
[草稿 PR #1](https://github.com/Velvetalon/qq-agent-plus/pull/1)，不合并主线、不部署。

## 结论

**当前任务卡尚未全部结束。** 本地实现与可执行契约已通过本轮独立复测；真实模型语义、
实际 embedding 质量/阈值与生产阶段仍未完成。不能把本记录当作整体验收或上线批准。

本次按当前代码核对 AGENTS、SC0–SC8 设计/验收、F4、PR1–PR4 和 LSR1–LSR4，
不是仅转述旧的 750 PASS。旧计划里的“暂停/待恢复/660 PASS”等原始时点保留，不据此
重报旧失败。最新本地证据见下表，详细契约映射仍见
[SC0–SC8/F4 矩阵](2026-10-16-task-card-closure.md)及
[91 项逐例账本](../../docs/verification/social-acceptance-20261016.md)。

| 当前任务 | 本轮结论 | 尚未完成的范围 |
| --- | --- | --- |
| SC0/SC1 | 接管、来源、隔离、状态与重启契约通过 | 实际平台漏收/扩展字段不由合成事件证明 |
| SC2 | 真实 Orchestrator/Planner/Replyer 宿主权限、预算和动作链通过 | A-P08/R02/R06 的真实模型取舍、长短与身份真实性 |
| SC3 | 意图、额度、恢复、guard/outbox/unknown 本地通过 | 真实 QQ 协议行为和实群体验未测；没有发送许可 |
| SC4 | 记忆策略、统一召回/撤销/CAS 与正常经历写入通过 | A-M02 事实/愿望/玩笑的模型语义；真实历史数据未清理 |
| SC5 | 证据独立性、候选采用/更正/撤销和范围契约通过 | A-L04 无关消息是否支持同一偏好的语义判断 |
| SC6 | 控制台实际 Chromium 操作、冲突、取消、移动布局与重启通过 | 不把本地 UI 自动化等同真实使用反馈 |
| SC7 | 759 项单测、完整本地门禁与真实应用合成主链通过 | B01–B12 实际模型自然度/成本/延迟回放未运行 |
| SC8 | **USER_PAUSED / NOT_RUN** | 服务器连接、清理、备份、部署、灰度和回滚均未执行 |
| F4 / PR1–PR4 | ready-vector 三消费者、授权/索引/预算和角色接口回归通过 | 实际中文 embedding 语义与 maxDistance 校准未运行 |
| LSR1–LSR4 | 清理工具、证据门、策略、TTL/纠正的本地回归通过 | 生产 profile reset 与真实模型效果仍未运行 |

91 项验收分类仍为 **74 项本地契约 PASS、5 项真实语义 NOT_RUN、12 项真实行为
回放 NOT_RUN**。后 12 项可先在离线合成场景中调用真实模型，不必发送 QQ；真实 QQ
投递/禁言/超时与 SC8 是另外的范围，不能把它们混为一项“必须部署才能测”。

## 本轮发现和修复

1. 浏览器验证进程崩溃会挂死：受限执行器拒绝 Chromium 所需的本地 Unix socket，
   Chromium 因信号退出；旧 finally 只看 `exitCode === null`，随后等待已发生的 exit。
   新生命周期跟踪器提前记录 error/exit，辨识 signalCode，有界等待就绪和关闭。
   新增 9 项回归；受限环境现在快速报告真实启动失败，不再假装一直运行。
2. 价格测试意外外连：`price-probe` 在已模拟显式刷新之后，通过
   `initChannelPrices` 再次访问示例域名，最终复跑被执行审查阻止。
   相关 `price-feed` 重启用例也可走默认 fetch。两文件现对所有未脚本化 fetch
   fail closed，并显式模拟后台刷新。缓存先用后更新、请求合并与删除后不得复活
   的断言保留并增强。没有重试被拒的外部请求，也没有改变生产代码或网络权限。

首次基线全量 750 PASS；中间最终复跑因上述外连被阻止，不算 PASS。
完成隔离修复后重新运行全部测试才得到下面的最终 759 PASS。
浏览器所需扩大执行权限曾在执行器挂载阶段失败，未运行命令；随后在指定 dot 云电脑
的独立终端、同一代码工作区执行本地合成浏览器测试成功。没有借此运行被拒的网络请求。

## 修复后的独立复核

独立只读审查没有降低或删除产品断言，也没有开放真实网络。审查指出的两个清理边界
已继续修复：对子进程发送信号失败的 error 不能当作退出（例如 EPERM）；关闭浏览器
失败也必须执行应用关闭并恢复 fetch。新增三项回归覆盖 kill 拒绝和运行时 error。
同一独立审查者复核修复后，31 项 focused 测试通过，未发现新增阻塞。审查结论只覆盖
本次测试修复，不代表重新独立审查整个产品。

## 最终命令与结果

Node **22.22.2**，独立 checkout 和临时合成数据；无生产配置、模型凭据或聊天原文。

| 命令 | 最终结果 |
| --- | --- |
| `node --test test/*.test.mjs` | **759 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**，exit 0 |
| `node --test test/price-feed.test.mjs test/price-probe.test.mjs test/browser-process-lifecycle.test.mjs` | 31 PASS，exit 0 |
| `node test/local/run.mjs` | 9/9，exit 0 |
| `node test/test-prompt.mjs` | exit 0 |
| `node test/render-test.mjs` | 138 PASS，exit 0 |
| `node test/scroll-test.mjs` | 19 PASS，exit 0 |
| `node test/usage-e2e.mjs` | 31 PASS，exit 0 |
| `node scripts/sqlite-vec-smoke.mjs` | sqlite-vec 0.1.9，exit 0 |
| `node src/ops.js scan --strict` | 0 可疑调用，exit 0 |
| `node --check` 递归 src/scripts/test/ui | 256 文件，exit 0 |
| `bash -n deploy.sh deploy-all.sh manage.sh` / `git diff --check` | exit 0 |
| `node test/browser/social-interests.mjs`，dot 云电脑实际 Chromium | exit 0；0 页面异常，0 真实模型请求，0 QQ 发送；2 次明确合成模型响应 |

浏览器实际验证：真实设置页保存/重载/转义、390px 取消操作、过期版本保存冲突且保留输入、
会话“计划回复”与“未投递”区别、HTTP 与持久历史无合成秘密/隐藏推理、模式回退后重启
仍可查看同一历史会话；390px/1440px 均无页面横向溢出。
非秘密机器可读摘要及日志 SHA-256 见
[`evidence/2026-10-19-task-card-audit/result.json`](evidence/2026-10-19-task-card-audit/result.json)。
临时原始日志不作为永久可用承诺，回归代码和摘要保存在 Git。

## 真正缺口与最小下一步

- 当前 checkout 的聊天 API Base URL、model、provider 和 apiKey 默认均空；embedding
  也没有选定的真实配置。这不是某个已选供应商已失败，而是没有可用于本项目的实际
  服务配置。不能复制其他项目的授权、凭据或现有向量。
- 模型回放首先只需一个获准用于 QQAgent 的聊天模型配置，使用仓库合成对话和当前
  Planner/Replyer 主链，不需要生产聊天记录、不需要 QQ 登录或实群发送。结果必须
  记录具体模型与自然度/正确性观察，不能用脚本的预设台词替代。
- F4 还需选定同一 embedding profile 的文档/查询模型与维度，使用合成中文正反例
  测召回和距离阈值。换维度或模型不能直接沿用旧向量。
- 真实 QQ 和生产阶段继续保持暂停。没有远端操作或未知写入结果需要补偿。

本次修复只在测试和验证文档，运行时回退无需变更配置；如要撤销，可在工作分支正常
revert 本次提交，不强推、不清理数据。PR 保持草稿，直到真实验收的适用范围完成。

## 保存与发布边界

用户要求全部任务卡完成的项目才提交 GitHub。由于上述真实验收仍未完成，
本次只归档本地进度并保存本地提交，**未推送**。2026-10-19 只读核对远端工作分支
仍为 `dc012094febc8521b5253592c854f7b0910db0b3`；本轮未改变 PR 状态或正文。
远端该 SHA 没有 workflow runs 或 commit status，不能称为 GitHub CI 通过。
