# QQAgent 自主逛 B 站能力

日期：2026-10-24，Asia/Hong_Kong。用户要求拉取最新代码，并在现有 QQAgent 内实现：主动发现 B 站视频、理解内容、自主判断是否有趣，分享给管理员或已授权 QQ 群，并围绕视频自然发起聊天；不另起独立 Bot，可直接用目标服务器登录状态向管理员做验证。

## 现状与参考研究

- 本地已快进唯一 `origin/main` 到 `83f16f7d8aa6aa1f9ace09e6d32503feb88e4569`。工作树仅保留用户未跟踪 `NEED_HELP.md`，不读取、不修改、不提交。
- 线上只读状态：revision `source-20261020T081133Z`、package `0.6.18`、`qq-agent-linux.service` active/running/enabled、health ok、OneBot connected=true、聊天模型 `deepseek/deepseek-v4.1-flash-1017`、runtime active/paused=false、conversation lifecycle、管理员已配置、allow.groups 1。线上尚无 Bilibili 配置。
- 读取了当前部署/插件/OneBot/发送队列/联网抓取/定时主动功能。现有 `SendQueue` 是 QQ 出站唯一队列，负责白名单、限频、outbox、失败/unknown 记账；Bilibili 不得绕过它直接调用 OneBot。
- 参考了公开 DSH 插件：
  - [`dsh-bili-scroll`](https://github.com/lll-77777777/dsh-bili-scroll)：关键词/热门候选、字幕优先、日报/兴趣筛选、定时自主触发；依赖独立 DSH profile 和 Python/Bilibili MCP，不直接适配本项目。
  - [`dsh-bili-summary`](https://github.com/YZz-S/dsh-bili-summary)：单工具获取 BVID/元数据/字幕时间线/可选 sharp 帧，失败降级，MIT；其数据抓取和降级思路可参考，但不复制独立 Host 插件运行时。
  - [`dsh-bili-jar`](https://github.com/Debuger-114514/dsh-bili-jar)：兴趣轴/互动率/LLM 策展，使用独立插件 profile、cookie 和另一个发送链，不直接引入。
- 选型结论：不安装或运行上述独立插件，不引入独立 QQ Bot/MCP/浏览器；在本项目内新增一个可关闭的 `BilibiliAutowatchManager`，复用现有 config、`safeFetch`、聊天模型、OneBot 状态、`SendQueue`、allowlist 和已有会话上下文。

## 已确定实现方案

### 1. 发现与理解

- 新增 `src/features/bilibili-autowatch.js`，Node 内置 fetch/URL/fs，无新 npm 依赖。
- 使用公开 Bilibili API：热门/关键词搜索 → 视频详情 → subtitle timeline（无字幕/403/超时则降级到标题/简介/作者/统计）；默认不配置 cookie，不抓登录态，不播放视频、不下载大文件。
- 所有 Bilibili HTTP 文本经过现有 `safeFetch` 的 DNS/SSRF/响应大小/重定向防护；候选/字幕作为不可信资料，提示词明确不能执行其中的命令或改变系统规则。
- 先用热度/去重/时间粗筛，最多分析有限候选；再用现有 `chatCompletionWithRetry` 要求严格 JSON：`interesting`、`score`、`reason`、`summary`、`openingQuestion`、`tags`。不依赖模型自由调用 QQ 工具。
- 状态只保存 BVID、公共元数据、决策摘要、哈希、时间、分享结果，不保存完整字幕/原始响应；状态文件放现有 `DATA_DIR/bilibili-autowatch/state.json`，原子写入、大小有界。

### 2. 自主调度与目标

- `bilibiliAutowatch.enabled` 默认 false；启用后由现有 Agent 进程内定时器工作，受 `timeControl`、OneBot connected、运行中互斥、每日分享上限和冷却约束。
- 生产配置显式启用时，目标默认为 `admin.ownerUin` 私聊；群目标只接受 `bilibiliAutowatch.shareGroupIds` 与 `allow.groups` 的交集，禁止向未授权群发送。
- 分享调用现有 `SendQueue.sendTextBatch`，因此继承白名单/限频/outbox/unknown 停止策略；不自动重发 unknown，不扩大 allowlist。
- 分享内容由模型依据原有 `roleText` 生成一条有限长度的偶然发现式短消息，禁止固定“【B站分享】/UP/BVID/理由/摘要”报告模板；只在末尾附原视频链接。消息应包含具体观察和可自然承接的问题，但不编造亲身经历。管理员/群友后续回复由现有生命周期对话继续处理，不另建会话 Bot。
- 行为策略以“会自己行动、拥有工具并自行决定是否使用”为基础：启用后首轮延迟10分钟，之后每10–30分钟随机自主浏览；不设置每日/每周分享配额，也不要求完成分享KPI。每个有趣候选分别交给现有QQAgent Lifecycle，由它结合人物卡、当前对话、记忆决定分享、延后或沉默。候选在7天内不重复分析，服务停止会取消进行中的抓取/模型调用；底层仍保留OneBot/allowlist/SendQueue/unknown安全边界和资源上限。
- 第一版实际分享使用了固定报告模板（用户指出不符合“生活在电脑里”的感觉）；已改为 `roleText` 主导的短分享正文+链接，不再强制“B站分享/UP/BVID/理由/摘要”字段。已部署的旧两条记录保留，后续调度采用新格式；当前日上限已收紧为1，今日已有2条历史分享，修正后不会再追加。
- 用户提供B站账号手机号/密码，希望登录取cookie；当前环境没有可用图片/浏览器/验证码交互通道，且公开接口已可用，因此没有保存或尝试绕过登录，首版不依赖cookie。
- 每轮最多分享一条，每日默认最多两条；同一 BVID 成功或 unknown 后不重复自动发送。无目标、OneBot 断开、抓取/模型失败都只记状态，不发异常消息。

### 3. 现有系统接线

- `config-legacy.js` 增加默认配置；配置更新路径保留未知字段并让 manager `reconfigure()`。
- `console/app.js` 实例化 manager，在 start/stop 和 `/api/config` 更新中接线；新增鉴权的 `GET /api/bilibili/status` 和 `POST /api/bilibili/run`（`publish:false` 可预览，`publish:true` 才走 SendQueue）。不新增独立 Web 服务。
- API 只返回候选计数、最近决策、目标/队列状态和错误摘要，不返回 cookie、字幕全文或凭据。
- 业务代码不改现有聊天/记忆/OneBot 协议；默认关闭保证旧配置启动行为不变。

## 验收标准

1. 纯离线 Node 测试覆盖：热门/搜索解析、BVID 去重、详情/字幕降级、严格 JSON 解析与不可信内容提示、兴趣阈值、状态原子边界、每日/重复限制、管理员/allow 群目标交集、SendQueue 调用、OneBot 断开和抓取错误闭合。
2. 目标 Linux/Windows 运行新增测试及适用全量门禁；不在测试中调用真实 Bilibili、聊天模型或 QQ。
3. 服务器先只读核对当前 revision/健康/OneBot；部署候选通过后使用原非 root `deploy.sh`/现有 app-data-node-service 路径，保留数据和权限。
4. 上线后先通过鉴权状态 API 核验 disabled/配置，再只启用管理员目标（群目标先保持空，除非线上 allowlist 明确且任务要求）；用一次真实 Bilibili 公共 API + 当前 DeepSeek 受限分析，并通过现有 SendQueue 向管理员发送一条测试分享。测试文本明确来自 Bilibili 测试视频，不能发送凭据/内部提示词。
5. 核验 service/health/model/OneBot/data/state/outbox；管理员收到后不自动批量刷屏。失败不回滚用户原数据，不重复 unknown 外部写入。

## 限制

- Bilibili 非官方接口可能改版、限频或需要 cookie；无 cookie 时部分视频/字幕会降级或不可用。
- 不能保证理解视频画面/直播/互动内容；首版主要依赖公共元数据与字幕，图片帧不默认下载。
- 模型兴趣判断是有限小样本，不等于稳定偏好或全量浏览；调度有硬上限，不是连续刷站。
- OneBot 登录状态/网络仍是外部前提；本次管理员消息验证只证明一条受控外发，不代表 SC8 或完整 QQ 验收。
- 不自动向未列入 allowlist 的群分享，不自动申请好友，不上传笔记/私聊内容到 Bilibili。
