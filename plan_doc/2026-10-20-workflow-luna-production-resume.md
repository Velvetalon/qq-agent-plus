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
