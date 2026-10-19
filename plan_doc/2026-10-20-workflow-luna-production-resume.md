# Workflow显式Luna执行与线上续做

2026-10-20，Asia/Hong_Kong。接续69cd4fb完整归档。用户明确要求：全局禁止普通subagent派发，所有执行者由workflow且显式model拉起；改完继续开发/测试/验证/线上更新，不再询问。

## 主协调者已决定的范围

已亲自读最新总交接、续做卡、实际177行发布稿、全局/仓库指令、部署规程与Embedding API关键实现。全局AGENTS已增加强制workflow/model规则，原架构/方案/最终验收边界不变。以下是既定方案，不交执行者决定方向。

1. 先实现并运行保存/测试异常清理的纯离线故障注入：从发布稿内Python heredoc解析AST，仅执行调用embedding_api的外层try/except片段；全API由测试stub替代，不能执行Bash整稿或读取服务器/凭据/环境秘密。
2. 主协调者验收后，用第二个新的workflow调用同一明确model做限域独立复核。每次agent选项必须model='gpt-6-luna'，不省略、不静默换模型、不以任务名代替选型；执行者不能再委派。
3. 主协调者同步只读重查生产、固定最新origin源码及既有权限。归档69相对930若仅文档/封存代码变化，业务代码142项仍可独立比对；实际发布revision和归档SHA须重建为当前固定目标，不能复制旧标签冒充最新。任何业务代码变化重新运行适用Linux门禁。
4. 在无并发和安全守卫条件下，用原服务用户、原app/data/node/service备份/发布；保留custom NanoGPT供应商与密钥、active/lifecycle、旧三个记忆开关、权限/时控和监听。按已获授权设置DeepSeek Flash、4B/2560、query=true/private=false和Embedding timeout60000；失败先保全/停供/诊断，不盲目重跑。
5. 检查源码/健康/配置/数据和真实向量进度；不因293条数强行取消隔离或伪造向量。OneBot既有断连与真实QQ/SC8仍分开，不重装协议端、不主动QQ测试。不tag/Release、不访问上游。

## Luna实现任务的所有权与验收

唯一允许新增/修改：`test/production-embedding-cleanup.test.py`、`delay/schedule/evidence/2026-10-20-workflow-resume/luna-fault-tests.json`。执行者只读归档发布正文、续做规范及通过QQ_DEPLOY_CLEANUP_SCRIPT指定的单份无秘密发布稿，不修改发布稿或业务实现。

测试Python>=3.10标准库unittest；默认读取冻结归档正文（只解析，不执行硬退出或Bash），可通过QQ_DEPLOY_CLEANUP_SCRIPT测试真实本地稿。准确定位包含settings和test调用、具有indexing_pause_confirmed的try节点，stub embedding_api及纯合成embedding_patch。

明确场景：成功无pause；save ok=false；save的HTTPError/URLError/TimeoutError/JSONDecodeError；test ok=false；test的同四异常；ok=true但非2560；非dict test结果；pause自身四异常；pause ok=false。允许合并重复断言，但须逐场景列结果/真实执行计数，至少18场景。异常必须仅尝试一次pause、保留失败；pause成功/失败分别明确indexingPauseConfirmed=True/False；无重试、无真实I/O。另用主协调者提供的旧控制流最小fixture重现HTTP异常/错误维度绕过pause（红基线），不得把fixture当实际服务器测试。

交付代码、实际命令/退出码/场景计数、局限。发现契约/设计缺口停止受影响工作并返回事实，不补设计，不读认证目录/ssh_remote.py/私有日志/环境或未跟踪备忘，不运行SSH、网络、实际脚本、不commit/push。最终验收、返修方案及上线裁决由主协调者完成。

## 发布后配置恢复的主协调者裁决

91be代码及全量备份已实际完成，首次配置POST因自我迭代账号门禁返回500，安全外层停供；主协调者确认142源码/权限/密钥未变且Embedding未启用后，已恢复新码服务，不回放发布或覆盖迁移数据。

实际OneBot既有断连使live selfId不可得，不能填default/猜号绕过。主协调者仅只读盘点现有qq-agent-snowluma容器与协议挂载：容器running、原3000/3001端口映射无误，未改/重启协议。进一步只读交叉验证得到唯一per-account协议配置，HTTP/WS端口及令牌均与Agent配置匹配，且唯一数字Notebook账号与之相同、无其他命名空间。由此可信地确定“已有配置账号”，不是实时登录证明，也不是改笔记归属。

据此仅补Agent onebot.selfId为该已配置账号（实际号不公开），保留所有协议端点/令牌、所有Note.account_id与权限；通过现有API的selfId配置入口使账号门禁满足，再按用户已授权配置4B及allowQuery=true/allowPrivate=false。若任何身份核验不唯一/不匹配则拒绝，不从聊天文本或笔记内容猜号。不重启/重装协议、QQ登录或主动发送。配置恢复不重跑备份/部署；API错误捕获后暂停新索引并保留诊断，保持已验证代码可用。OneBot实际连接状态继续单独报告。

## 现有笔记的派生索引队列

4B配置/线上固定文本已成功，但新profile统计ready/pending均0。主协调者亲自读owner实现确认：启用/改profile只启动worker，不为既有笔记自动回填队列；仅append/update会queue。用户已明确授权符合策略的既有笔记云端索引，故一次性在宿主侧复用NotebookStore只读get、现有isRecallableNotebookNote、EmbeddingClient.authorizeNote和公开queueEmbedding函数，为当前已验证账号且active/可召回/允许外发的旧笔记派生排队。保留private=false，不将chat私域笔记强行开放，不改正文、revision、scope或account_id；不重置已有当前profile job/lease/attempt。限500条，一次事务，确认主笔记表内容摘要前后不变，仅输出计数/原因。若全部因权限/策略不可索引，原样报告0，不伪造向量或降低门禁。
