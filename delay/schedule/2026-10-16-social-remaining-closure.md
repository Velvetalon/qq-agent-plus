# Social 剩余本地验收与安全修复：2026-10-16

环境仍为用户命名的 **Dot**，未改任何环境配置。只操作 qq-agent-plus。
产品及测试候选：`2899a54bb4d4a5ddaf163bb03a8435506f2c5e7a`。
分支 `fix/deploy-notebook-gate-20261016`，独立草稿 [PR #1](https://github.com/Velvetalon/qq-agent-plus/pull/1)，不合并、不发版。
main 基线 `2be4bccce643d4d40bdc4472e5703f3a109aac2e`；审计文档 SHA
`fb705fc0d54e040949812cea8d68305ce87b2f20` 不是产品版本。
计划：[剩余验收](../../plan_doc/2026-10-16-social-remaining-acceptance.md)。
逐项范围：[91 项对照](../../docs/verification/social-acceptance-20261016.md)。

## 两处真实失败与修复

1. 收到本账号 `group_ban` 通知后，已排队 Social 发送仍会继续。修复前实际
   app 测试计数为 4 次发送、期望 3（`/tmp/qq-social-mute-red.tap`）。现在
   只接受已认证 OneBot 身份一致、目标为本账号、会话已允许的标准通知，按
   account/group 持久化禁言时刻与到期时间；模型、工具和最终 Sender 均检查。
   只读状态不建表；比当前记录旧的解除通知不能清除禁言；临时切旧模式后收到
   合法解除可更新已有记录。没有调用禁言/解除等管理 API，也不自动重发。
2. 正式入站把转发展开后的正文标成普通 `message`，可进入转发者偏好证据。
   修复前真实 app 用例得到 `message`、期望 `forward`
   （`/tmp/qq-social-forward-red.tap`）。现在保留既有 event_kind 中的 forward，
   完成事件保持派生类型且不制造原始人类根；worker 不将其放入 traitEvidencePool。
   原文仍供对话读取，无数据库破坏性迁移或历史数据改写。

禁言字段依据 [OneBot v11 group_ban 标准](https://github.com/botuniverse/onebot-11/blob/master/event/notice.md)。
协议漏收/首次观察之前的通知、整群禁言扩展未在真实平台验证；同秒通知按到达
顺序处理，严格较旧时间才拒绝。不能据本地通过宣称平台禁言状态永远同步。
过去已扁平化的转发记录缺少可靠原始类型，不猜测/重写历史；若需历史修复应先
设计有来源的 dry-run 和逐项授权。当前修复只约束新入站。

## 连续主链新增证据

- A-H05：真实 createApp/注册插件/Notebook/sqlite-vec/Manager/worker/Sender；
  当前、其他账号/群/私聊、运行脚本及旧向量污染样本并存；工具、自动 context、
  反思三个消费者一致隔离。HTTP CAS 更正后仅见新版；错误 CAS 409；排队期间
  HTTP CAS 归档使草稿被阻止，下一 run 和反思不会复活旧材料。
- A-H06/A-S04：真实 producer 三次独立互动累计候选，审核采用、下一 Replyer
  注入；CAS 更正后下一 Replyer 移除。另三个真实分批引用分别发送和入队反思，
  只有一个人类 root/interaction，assistant 工具发送不成为人类证据。
- 运行矩阵覆盖 listen/wait/close/no_output、非法JSON/动作/目标/作用域、
  Planner 禁用工具、表情独立发送、交错话题/同人换题/旧目标发送、due 竞争、
  闭题/已答取消、队列期间权限/时间/模式变化、同轮去重和下一目标正常短答、
  真实 longtime 图片发送及 guard。所有调用均为合成外边界。
- Chromium 使用真实 HTTP/页面交互：兴趣来源确认/保存/冲突/取消，真实
  guarded session 的计划与未投递状态、完整响应无合成凭据；回退旧模式、
  stop/start 后重新打开同一历史会话；1440/390px 均无横向溢出。

未降低原 Notebook 断言或为通过而跳过用例。新参与者伪造用例最初在工具成员
校验即被拒，随后补上真实旁题群成员以确保进一步到达目标发送 guard；没有
放宽产品断言。longtime 使用临时合成 PNG，不读取真实用户图片。

## 固定候选全量门禁

Node **22.22.2**（子进程 PATH 一致），候选 `2899a54bb4d4a5ddaf163bb03a8435506f2c5e7a`：

| 检查 | 实际结果 |
| --- | --- |
| node --test --test-reporter=tap test/*.test.mjs | 749 PASS / 0 FAIL / 0 CANCEL / 0 SKIP，61.4 秒 |
| node test/local/run.mjs | 9/9，exit 0 |
| prompt / render / scroll / usage | 全部 exit 0；render 138、scroll 19、usage 31 |
| node scripts/sqlite-vec-smoke.mjs | exit 0 |
| node src/ops.js scan --strict | 0 可疑调用，exit 0 |
| node --check src/scripts/test/ui 递归 | 252 文件通过 |
| bash -n deploy.sh deploy-all.sh manage.sh | exit 0 |
| git diff --check | exit 0 |
| node test/browser/social-interests.mjs | exit 0；脚本异常0，真实模型请求0，QQ发送0；预期合成模型2次 |

完整命令/退出码/时长：`/tmp/qq-social-final-gates-epaiirys/results.json`，同目录
各门禁日志。浏览器截图与 JSON：`/tmp/qq-interest-browser-B7IWyW/`。这些临时
合成证据可能随环境回收，可执行回归及此记录已保存到 Git。源码固定后仅更新
验收与交接文档，不将文档提交误当再次运行全仓测试。

## 剩余事项与明确边界

91 行按原始契约逐项更新，不再用“依赖受阻”掩盖已恢复的本地组合。PASS 仅是
表中写明的宿主契约。A-P08/R02/R06/M02/L04 的语义效果以及 A-B01–12 仍为
LIVE_NOT_RUN：真实模型的选择、自然度、真实性、归纳与成本需另行授权与实际
观察，不能用脚本模型伪装完成。A-L08 原要求是拒绝未经授权的 global 扩域，
现已覆盖；审计额外提出的授权晋升正例不是原契约，不据此新增能力。

**仍有本地设计差异，不能宣告候选可部署：**
[2026-09-28 F4](../plan/2026-09-28-functional-repair.md) 要求只读 ready 向量，
而 `retrieval-provider.js` 在 embedding 未启用时仍进入 Notebook 列表和
RetrievalService 词法排序；其他消费者也保留无向量回退。这不是网络阻塞，也
不是此次 A-H05 向量开启轨迹的失败。统一撤销旧回退会改变 legacy/embedding
关闭时的产品行为与相应测试，属于跨检索策略调整；本轮只报告具体差异，不暗改
既有策略或把它算作验收通过。应由主对话明确继续该专项的范围后修复和回归。

服务器 **USER_PAUSED**：没有 SSH 重试、认证、盘点、备份、发布、健康检查或
回滚。原线上 SHA、备份位置、远端资源及健康状态本轮未知；无任何远端变更。
不因本地 749 通过宣称已部署。恢复须用户明确恢复线上操作；若需密码/令牌
传输或新长期授权，仍先经主对话逐次安全确认，不能让用户聊天重发密码。
未修改其他项目、共享服务、网络、端口或任何真实数据，未清理历史 profile。
