# 全部工作归档与准确续做点

日期：2026-10-20，Asia/Hong_Kong。按用户要求统一归档代码、全部进度和部署情况，再提交GitHub。用户随后明确授权：当前及后续实际收到的排队指令直接执行必要操作，不再提问。应自行核对技术前提、保持安全边界、如实记录，不凭授权伪造通过或猜测尚未收到的指令。**本记录是当前交接入口，不是发布成功报告；本轮归档阶段不继续部署、模型探测或Notebook索引。**

- [结构化证据](evidence/2026-10-20-complete-work-archive/result.json)
- [未发布运维实现：16份封存代码及哈希](../implementation/2026-10-20-production-update/README.md)
- [明确的续做任务卡](../task/DEPLOY-2026-10-20-resume.md)
- [执行分工规则快照](../coordination-policy-snapshot.md)
- [原部署方案与纠正记录](../../plan_doc/2026-10-20-production-code-update.md)及其[delay副本](../plan/2026-10-20-production-code-update.md)
- [本轮归档方案](../../plan_doc/2026-10-20-full-delay-archive.md)及其[delay副本](../plan/2026-10-20-full-delay-archive.md)
- [完整运维复核记录与最后补丁状态](2026-10-20-operator-review-log.md)

## 1. 最重要的实际状态

**归档只读核验时间：2026-10-20 03:32:58 +08:00。线上仍是旧代码，正式发布、模型切换和4B配置均未完成。**

| 项目 | 实际结果 |
| --- | --- |
| 归档前GitHub/local main | `930bfb900557b544888dfba29c9957cc3978018d`，fetch后相同 |
| 发布候选 | 同上930提交；源码归档及142项受控文件manifest已校验 |
| **线上实际revision** | **`059eba574a5e440fb9c385de5305f7afcc585a82`**，不是930 |
| 服务 | ubuntu/uid1000的systemd user服务qq-agent-linux，active/running/enabled，退出码0，重启次数0；仍是原进程 |
| healthz | ok=true，版本0.6.18；新旧包版本号相同，不能据版本号判断已发布 |
| 原运行状态 | active、paused=false、lifecycle，未切换Social或解禁会话 |
| 线上实际聊天模型 | **qwen/qwen3.8-27b-uncensored:thinking**，没有实际切到DeepSeek |
| 用户最新目标聊天模型 | NanoGPT `deepseek/deepseek-v4.1-flash-1017`；仓库测试/待发布配置已选定，待应用线上 |
| OneBot | 更新前就已断开，归档核验仍false；未重启/重装协议端或登录QQ |
| 旧记忆状态 | canonical selfEvolution、retrieval、reflection均true；293条Notebook仍存在 |
| 4B持久配置 | 尚未保存、未启用新版Embedding、没有由本次工作启动笔记云端索引 |
| 当前发布任务 | 无新运行pid/result标记、无部署锁；唯一一次尝试已明确失败且退出、记录归档 |
| 新备份 | application/data/unit备份均**尚未创建**；原有3份历史部署快照仍在原处 |

现有安装和维护目录（服务器路径，不是本机文件）：

```text
服务：qq-agent-linux.service
安装：/mnt/data/qq-agent/app
数据：/mnt/data/qq-agent/data
Node：/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node
控制台：原0.0.0.0:3210（未改绑定或防火墙）
隔离候选/预检/失败记录：/home/ubuntu/qq-agent-maintenance-20261020-cd1c4beb
```

## 2. 已实现且已提交的业务代码

业务代码本身以Git历史为权威，不复制整个仓库或node_modules进delay。以下提交均已在main/GitHub，本轮补的是尚未入Git的运维草稿与最新交接。

| 提交 | 工作 | 已有证据/边界 |
| --- | --- | --- |
| `4d59292` / `bc0a77d` | 接管origin较新的开发进度，保留云端恢复交付及Social语义门 | [云交付](2026-10-19-cloud-handoff-delivery.md)，不把历史模型结果迁移成新模型通过 |
| `188ba22` | 上游隔离，只使用本仓库origin | [仓库约束](../../AGENTS.md)，未添加/fetch upstream |
| `cd7b7d2` | face caption补发送前审核、options快照、CQ规范化、预检拒绝元数据；真实宿主/协议边界回归；回放凭据/无proxy修复 | [接管记录](2026-10-19-local-takeover-face-review.md)，新增13个caption测试，62专项通过；当时Qwen身份截断/超时失败保留 |
| `e3827c4` / `36a6bd9` | 接管交接及验证/临时凭据记录范围澄清 | 非“所有位置从未保存密钥”，明确私有会话/工具输入不在项目非持久化声明内 |
| `e870954` | 有界审核设置、读盘/保存/运行一致、runSnapshot不可变、实际请求/预留/timeout一致；recentMessageIds窄提示修复 | [工程修复](2026-10-20-thinking-review-repair.md)，两项复核P2已返修闭合，66专项通过 |
| `9cfc02c` | 工程结果及原Qwen身份请求402归档 | 402为NanoGPT对Qwen聊天请求返回Insufficient balance，不是Embedding失败证据 |
| `ef4e806` | 按用户改为DeepSeek Flash，精确白名单与旧Qwen聊天0dispatch拒绝；待上线配置说明 | [模型选择](2026-10-20-deepseek-chat-profile.md)，67专项通过 |
| `930bfb9` | DeepSeek本轮真实回放结果归档 | 12次HTTP200、65038报告tokens、原短问答及身份两轮正例，不是全场景通过 |

关键实现见 [审核策略](../../src/conversation/draft-review.js)、[Orchestrator](../../src/core/orchestrator.js)、[messaging上下文](../../src/plugins/context.js)、[Sender](../../src/onebot/sender.js)、[工具入口](../../src/tools/tools-core.js)、[配置读写](../../src/core/config-legacy.js)、[真实回放说明](../../test/live/README.md)。

## 3. 测试与真实效果必须分开

### 当前发布候选的目标Linux门禁：已完成

服务器隔离source、独立HOME/XDG/QQ_AGENT_DATA_DIR、非本地TCP/UDP拦截；原服务当时保持运行。Node22.23.2：

- **852/852 PASS，0 FAIL / CANCEL / SKIP**，exit0；没有靠skip/改弱断言消掉Windows失败。
- 280文件语法、strict scan、local9/9、prompt、render138、scroll19、usage31、sqlite-vec0.1.9均通过。
- 源码tar SHA256：`c3dc47754d3c81ef7776c1ee56ecc99898f7d957b6978cc755de27804b152a5b`。
- 142文件manifest SHA256：`afca77f6d8e867c64498bd6bf7a5eb0db9b84764653b1cbf68c817faf055f7f3`。
- 这些证明**候选可通过Linux门禁**，不证明已经同步到安装目录。

### Windows及历史云端结果：保留历史时点

[接管记录](2026-10-19-local-takeover-face-review.md)的精确188ba22基线772/44/3与新增后790/44/3失败同名；[后续工程修复](2026-10-20-thinking-review-repair.md)为804/44/3（851总项），新增14项全部通过。44个Windows平台/夹具失败本身没有在本轮修复。历史云端819/800等结果不覆盖本次模型/版本。

### 当前选定模型的真实回放

- DeepSeek Flash：原short-invitation及identity共12次HTTP200、65038报告tokens，1条短答与身份两轮4条合成输出；审核完整返回、拒绝虚构经历并承认机器人身份。12个返回cost字段为0，不是最终账单证明。源码129文件开跑manifest与当时最终源码匹配。[详情](2026-10-20-deepseek-chat-profile.md)。
- Qwen聊天：历史768-token截断/15秒超时及后来HTTP402均保留，不变成“自然沉默通过”，也不继续用旧Qwen失败阻塞已选DeepSeek。[历史](2026-10-19-local-takeover-face-review.md)。
- 4B独立合成记忆：历史17次HTTP成功、424报告tokens、6条笔记/2560维、重开/隔离/小校准通过；这不是新模型完整chat→reflection→4B→新会话召回验收。[详情](2026-10-19-local-takeover-face-review.md#5-指定模型真实测试结果分开报告)。
- 历史SC0–SC8、F4、PR1–PR4、LSR1–LSR4与91项账本仍由[任务卡复核](2026-10-19-task-card-recheck.md)、[收口记录](2026-10-19-real-model-embedding-closure.md)、[SC矩阵](2026-10-16-task-card-closure.md)追溯；17个真实语义/行为中14个小样本支持、B07/R06/B10缺口仍不能全关。

## 4. 本次线上更新做到了哪里

1. 已使用用户授权的外部SSH资料连接，核对known_hosts、非root所有权、现有目录/服务/Node/模型密钥绑定；未使用腾讯云/COS发布通道。
2. 发现现有NanoGPT是custom供应商ID，密钥在providerKeys而不是inline；未来切模型必须保留该绑定，不能简单重命名provider导致认证丢失。
3. 上传930源码到隔离维护目录，校验归档，npm依赖准备及上述Linux门禁已过。
4. 临时运维草稿静态复核发现Bash AND-list/独立否定命令的errexit陷阱及非原子重入门禁。主协调者修为独立身份断言、显式if失败与launch/worker双flock；12组mock及2项目标目录锁并发实验通过，未用生产服务做反例。
5. **唯一发布尝试在前置记忆状态断言失败，尚未停服务。** 主协调者初检把Embedding未配置误判成整个记忆功能关闭；实际canonical三个开关已true。此前“旧字段”说法也已纠正。失败退出且原pid未变；result/pid/log已在持双锁且确认无备份/部署写入后保存到attempts/01-prestop-guard，未抹去失败证据。
6. 用户获知293条笔记的云端索引和费用影响，明确选择一起启用4B、允许查询、默认不开放私密笔记。**授权已获得，设置尚未应用。**
7. 服务器现有凭据固定文本探针：15秒首次超时无HTTP响应，结果/费用未知；无认证HEAD确认DNS/TLS可达后，采用应用相同的30秒连接dispatcher、60秒有界请求，在原api.nano-gpt.com端点真实HTTP200、2560维、7报告tokens、约13.84秒。输入均为固定诊断文本，真实笔记输入0；不等于293条已经索引。
8. 本地草稿已按真实开关和追加授权修订，并补Embedding保存/测试的HTTP、超时、JSON、维度异常清理。**最后补丁只在本地；未再上传、未做专门故障注入、未获得补丁后的最终独立复核。**
9. 用户转问Luna分工与workflow/subagent区别；普通复核子代理不具备可核验的Luna型号信息。尚未实际指定gpt-6-luna，workflow的模型选择调用也未执行。Luna的故障注入任务仍待派发，不能写成已执行。
10. 用户最新要求完整归档，故本轮只读核验并提交资料，不继续发布。正式停服、备份、安装替换、模型切换、4B持久配置和实际笔记索引均未发生。

## 5. 本地与服务器执行稿不一致：续做的首要警告

| 草稿 | SHA256 | 状态 |
| --- | --- | --- |
| 本地最后异常清理补丁 | `8a610c64648c986539f64fd3b1f958202c64fb557ff5a7a3a0a588878ba602c6` | 已实现，最新语法/12组守卫复测通过；异常故障矩阵与最终复核未做 |
| 服务器维护目录中的执行稿 | `61e6343f272256c596b2906d558eca36938647d2f2b6ef95b220d7d00979abbe` | 14909字节，仍有已知P2：测试异常/错误维度可能跳过持久禁用分支 |

**不能直接运行服务器旧执行稿，也不能直接运行封存代码。** 16份[代码快照](../implementation/2026-10-20-production-update/README.md)均有硬退出保护；源凭据路径已替换为环境变量，维护目录改成不存在的审阅占位符。原始/归档哈希、正文变换及版本边界见[manifest](../implementation/2026-10-20-production-update/manifest.json)。

## 6. 仍未完成的工作

- 发布脚本最后异常路径故障注入与再次独立复核；确认实际Luna入口后只委派既定实现/自测，不外包架构或上线裁决。
- 重新核验线上状态/并发/授权，准备并验证真正业务备份和回滚，再发布、保留custom供应商密钥与active/lifecycle权限状态；不能把已有旧快照说成本轮备份。
- 应用DeepSeek聊天和4B配置，验证启用/查询/私密隔离、实际索引就绪/失败/待处理量；不为完成数字强行取消笔记隔离或伪造向量。
- OneBot既有断连待另行处理；未授权重装、换QQ、强制重试未知投递、清理生产历史或主动QQ测试。SC8真实平台验收继续USER_PAUSED；本次部署授权不等于全项通过。
- B07视觉新增性、R06/B10更广正反例、新模型完整记忆链和必要浏览器/真实平台验证仍开放。目标Linux候选门禁已通过，不再列作NOT_RUN；Windows44失败仍是未修复历史平台问题。

逐步接手条件、允许文件和停止条件见[续做卡](../task/DEPLOY-2026-10-20-resume.md)。

## 7. 归档与安全边界

保留全部既有delay历史，不重写旧测试/失败/费用为成功。代码提交链、当前状态、用户授权、错误假设纠正、复核发现及未完成任务都进入本次归档。业务实现已有Git历史；运维未完成代码另有16份封存快照。

不上传SSH/API/控制台/OneBot密钥、外部认证文件、原始聊天/293条笔记正文、SQLite、node_modules、运行时、源码tar或完整原始日志。原始证据留私有位置，Git仅有脱敏计数/结论/摘要哈希。这不承诺私有会话与工具执行输入不留记录。未读取、修改或提交未跟踪本地备忘；未访问上游、发tag/Release或新增生产动作。

归档材料已由通用只读子代理做内部事实一致性核对，限域PASS；未据此验证生产、原始证据、另15份代码或最后部署补丁。逐文件哈希、链接、JSON、16份硬退出及敏感信息检查另由主协调者执行，见[归档本地校验](evidence/2026-10-20-complete-work-archive/archive-validation.json)。不能把这次事实审阅记成Luna执行或补丁最终验收。

本次Git提交/推送只表示归档交付完成，**不表示生产升级或整个项目验收完成**。最终归档提交号以Git历史和push后远程回读为准。
