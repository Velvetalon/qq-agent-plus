> 归档副本；原方案见[plan_doc版本](../../plan_doc/2026-10-20-production-code-update.md)。仅重定位相对链接，不代表计划已执行。

# 既有线上 Agent 安全更新

> 归档状态：这是方案和修订过程，不是部署成功日志。用户最新要求先完整归档；生产仍旧revision，备份/发布/模型及4B启用尚未执行。实际证据与续做点以[完整交接](../schedule/2026-10-20-complete-work-archive.md)为准。

2026-10-20，Asia/Hong_Kong。用户明确授权“更新线上代码”，服务器认证资料位于其提供的外部目录；此授权解除本次代码更新所需的服务器连接/部署暂停，不自动授权SC8、真实QQ测试、换账号、解禁会话或协议端重装。

## 主协调者亲自核对的现状

已读全局分工、仓库指令、LINUX/OPS/BAOTA部署规程、deploy.sh及configure/manage/install-service实现、当前交接和实际服务器元数据。由主协调者确定本方案，不委派方向/架构判断。

- 可信known_hosts已匹配；SSH为ubuntu，uid1000。公钥登录不可用，使用外部资料的SSH密码字段在内存认证，不读出/打印密码，不使用腾讯云/COS凭据。
- 服务qq-agent-linux为ubuntu的systemd user服务，active/enabled，linger=yes。
- 安装 `/mnt/data/qq-agent/app`，数据 `/mnt/data/qq-agent/data`，两者均属ubuntu，真实路径已确认；现有Node22.23.2在安装内.runtime。
- 现有revision `059eba574a5e440fb9c385de5305f7afcc585a82`，package版本0.6.18，监听0.0.0.0:3210。runtime active/paused=false，对话lifecycle；这些不因更新而改。
- 当前聊天Qwen thinking，NanoGPT网关；密钥在custom供应商providerKeys绑定，非inline。切模型须保留该provider ID、端点及所有密钥，不能仅把provider重命名为NanoGPT而丢失认证。
- 更新前healthz正常，但OneBot已断开；本轮不重启SnowLuma/QQ、不登录或主动发送真实消息。
- autoUpdate配置disabled，user timer active/enabled，更新service inactive；没有部署锁。磁盘可用约17GB。现有3个deploy-backups，需先额外保留以免脚本自动轮转造成唯一副本丢失。

## 固定目标与候选验证

唯一远程origin已fetch，HEAD与origin/main均为 `930bfb900557b544888dfba29c9957cc3978018d`。固定本次发布该提交，不追随上游或执行未经审查的远程更新脚本。

1. 从固定Git提交导出归档，不包含未跟踪备忘、凭据、data、.git或本机node_modules；记录SHA256。
2. 在ubuntu家目录创建新的0700维护目录，SFTP上传源码及不含秘密的验证工具；校验归档哈希及成员路径后解压至独立source目录，不改原安装/数据。
3. 用现有Node运行npm ci --omit=dev --ignore-scripts，并在隔离QQ_AGENT_DATA_DIR及非本地TCP/UDP拦截下运行Linux全量单测及语法/strict scan/local/prompt/render/scroll/usage/sqlite-vec门禁。此阶段原服务不停止，不读生产聊天内容，不发计费模型或QQ请求。门禁失败先分析，不直接发布。

## 备份与更新

候选通过后再次核对路径、属主、原revision、无并发部署/更新、单元drop-ins和空间。

- 维护目录保存原配置、部署元数据、单元及源代码回滚材料；权限0700/0600，原始材料只留服务器，不入Git。
- 先复制保留现有3份部署快照，再允许原deploy.sh执行其正常3份轮转；不做额外清理。
- 短暂停qq-agent-linux，等待停止，再生成包含全部业务持久数据的静止快照（SQLite使用一致备份机制，不丢WAL）；不改数据目录/历史、重试/held状态或其他服务。
- 从独立候选source以ubuntu运行原deploy.sh，显式传入原install/data/service/node，host/port沿用原值，设置QQ_AGENT_SOURCE_REVISION为固定提交，QQ_AGENT_MODEL为指定DeepSeek。保留内建code/config/unit失败回滚，不用deploy-all，不迁移/制造元数据、不以root部署。
- deploy.sh只通过原configure入口切model，保留custom供应商与密钥；健康后通过鉴权的最小配置patch补thinking=on、禁用聊天fallback、review2048/45000，使用既有配置API不手改秘密。保持lifecycle、runtime、OneBot、监听/端口、allow/deny、时控和autoUpdate状态。
- 此项初稿判断已被后续实际核对及用户明确选择取代：原selfEvolution主开关、retrieval、reflection均已开启，缺的是Embedding配置，并有293条Notebook。必须保留这三项状态。用户在确认云端索引/费用影响后选择一起启用4B；据此配置NanoGPT Qwen3-Embedding-4B/2560、allowQuery=true、allowPrivate=false，服务器内复用现有NanoGPT凭据，不改聊天供应商/密钥。先固定合成文本验证，再保存启用，不把配置成功冒充所有笔记均已可召回。

## 验收与失败处理

验证systemd active/退出码/重启次数、healthz、本次deployed-revision及受控源码哈希、config权限、实际model/provider/key-presence、review设置和保护字段不变；只记录布尔/计数与脱敏元数据，不打印密钥、QQ身份/聊天或完整日志。确认OneBot断开是部署前已有状态，不宣称QQ端到端通过。

部署失败由脚本先恢复code/config/unit；必要时按维护备份在停服务状态恢复原数据，不能自动用旧代码打开已升级的不兼容数据。若SSH中断先查锁、进程和结果，不重复未知状态的部署。保留维护材料和回滚位置供用户，不自动清理、不tag/Release。

最终把实际发布revision、Linux门禁、健康、模型、原有OneBot限制与回滚信息记入delay，普通提交推送origin仅归档计划/结果。归档提交只有文档，不为追逐文档HEAD重复线上部署。

## 发布前独立复核补正

候选Linux852/852及辅助门禁已通过，生产尚未停服时，独立只读复核发现临时运维脚本的Bash守卫缺陷：AND-list首项及独立!命令不能依赖set-e中止，另有标记检查/写入非原子。主协调者亲自确认并改为独立身份断言、显式if失败、launch/worker双flock锁；本地用mock验证root/错误uid/活动更新/停止失败反例，并在独立维护目录验证并发锁，不用生产服务做反例。

同时把manifest恰142项及其本地归档派生SHA256、实际既有记忆开关与用户授权的Embedding启用状态、完整旧autoUpdate字段与timer状态、systemd退出码/重启次数、业务库quick_check及历史计数验收补为显式条件。没有主动QQ测试不等于测得线上总发送为0，结果须保留这一区别。原缺陷与返修复核结论都保留，不把初稿说成已经通过。

## 实际状态纠正与用户追加授权（03:05）

首次运行在前置memory状态断言被拒绝：serviceStoppedForUpdate=false、deployFinished=false，进程已退出，原服务PID2774819一直active。原因是主协调者初检把Embedding空配置误判成整个记忆功能关闭；后续已明确核对canonical selfEvolution存在，enabled/retrieval/reflection均true，已有293条Notebook。此前“旧字段”表述也予以纠正；不以错误断言关闭用户已开启的功能。

在告知符合权限的笔记将发NanoGPT建索引并可能产生费用后，用户通过选择题明确选择“一起配置并启用4B语义检索”。因此保持三个旧开关true及reflection.mode，使用现有NanoGPT供应商凭据在服务器端配置4B，allowQuery=true、allowPrivate=false，不改账号/聊天隔离。

15秒固定文本探针超时，未取得HTTP响应，不当余额错误或零费用。随后无认证HEAD诊断证明原网关DNS/TLS可达，并按应用相同的30秒连接dispatcher、60秒有界请求重新做一次受控固定文本实验；原https://api.nano-gpt.com/api/v1端点返回HTTP200、真实2560维、7报告tokens，约13.84秒。不是盲目自动重试/换模型/换密钥，不包含任何真实笔记。线上Embedding timeout显式60000，避免默认8秒小于实际延迟。

仅在确认首次失败、进程已退出、无服务中断/备份或部署写入后，归档该次result/pid/log再允许下一次受双flock保护的发布；不抹去失败记录。发布后通过独立Embedding设置API保存启用及固定文本测试，观察真实向量计数/队列；若认证/余额错误则暂停新增索引、保留数据和已完成向量，不自动换凭据或绕过隔离策略。
