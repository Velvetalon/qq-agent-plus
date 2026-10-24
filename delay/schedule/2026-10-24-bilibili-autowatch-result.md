# B站自主浏览功能结果

日期：2026-10-24，Asia/Hong_Kong。

## 采用方案

本次复核了用户提供的[ChatGPT架构讨论](https://chatgpt.com/share/6adbc07c-24b0-83e9-b747-e7038d37a5e8)。其中最关键的结论是：当前B站模块如果自己生成分享文案并直发，就算把文案改得口语化仍是搬运脚本；正确边界是“B站后台提供新经历，真正QQAgent Lifecycle获得一次聊天机会”。该结论已落实到88588bd/9d6b88d：B站模块不再直接调用SendQueue分享。

没有安装独立 dsh Bot。参考了公开的 [`dsh-bili-scroll`](https://github.com/lll-77777777/dsh-bili-scroll)、[`dsh-bili-summary`](https://github.com/YZz-S/dsh-bili-summary) 和 [`dsh-bili-jar`](https://github.com/Debuger-114514/dsh-bili-jar)：它们共同的有效点是“定时一轮、字幕优先、有限候选、模型策展、默认限制评论/发送”，但各自依赖独立 DSH profile、Python/MCP/cookie 或自己的发送链，不适合直接塞进现有服务。

用户指出第一版“固定报告模板+高频轮询”不像活在电脑里的QQAgent。进一步阅读分享链接后确认，真正的架构问题是B站模块自己生成文案并直接发送，绕开了QQAgent Lifecycle。已按 `dsh-bili-scroll` 的整体逻辑和链接中的架构建议重构，而不是只改发送文本：后台每日轮次、字幕优先、轮次状态、近期候选抑制、B站只形成活动记录；再通过现有Orchestrator Lifecycle唤醒真正QQAgent，由人物卡、最近聊天、记忆和这次发现决定分享、延后或沉默。最终Lifecycle代码为 [`88588bd`](https://github.com/Velvetalon/qq-agent-plus/commit/88588bd463606774179bd8532bd681bf7a573e14)，之后按用户要求移除每日/每周行为层配额、改为10–30分钟随机自主浏览和多候选交接，提交为 [`d3c1e47`](https://github.com/Velvetalon/qq-agent-plus/commit/d3c1e47ed7fd15513f0395f4a58cfcbf9f7edc51)。

本项目实现为 `src/features/bilibili-autowatch.js`：公开 B站 API + 现有安全抓取层 + 现有 DeepSeek + 现有 `SendQueue`。所有分享仍经白名单、限频、outbox、unknown 停止策略；管理员目标取 `admin.ownerUin` 且必须在 `allow.private`，群目标必须同时出现在 `shareGroupIds` 与 `allow.groups`。入站回复继续走已有 lifecycle 对话。

## 实际部署

- 本地已快进 `origin/main` 到 `83f16f7`，之后推送提示词重构及B站实现提交。
- 线上最终 revision：`d3c1e47ed7fd15513f0395f4a58cfcbf9f7edc51`，服务 active/running/enabled，NRestarts=0，health ok，OneBot connected=true。配置为10–30分钟随机浏览，`maxSharePerRun=0`、`maxSharesPerDay=0`、`maxOffersPerWeek=0`；该版本把发现作为活动记录交给现有Lifecycle，仍不保存字幕全文。
- 首次上线候选 `5710319` 已先做静止业务备份：SQLite quick_check=ok，聚合计数 messages=11114、outbox=54、conversation_threads=2；后续代码修正沿用原数据与部署快照。
- B站最终配置：enabled=true、每日一轮 `intervalMinutes=1440`、启动延迟600000ms、每日最多1条、`requireSubtitle=true`、管理员分享开启、群目标0；allow.groups 当前仍有1个但未自动启用群分享。
- 低频修正后没有追加新的测试消息；今日已有第一版旧模板分享2条，当前日上限1因此不会再发。旧记录保留，后续新轮采用角色主导的自然短消息格式。

## 运行/测试

- B站离线专项最终 **8/8 PASS**；覆盖默认关闭、热门/搜索解析去重、详情/字幕降级、严格JSON、兴趣阈值、preview、管理员/allow群交集、OneBot断开、每日上限、近期候选抑制和状态恢复。
- 本地公开B站热门接口预览成功：HTTP200、code0、取得5条候选；无登录、无模型、无QQ发送。
- 目标Linux候选全量：833 PASS / 18 FAIL / 26 SKIP；18个失败均来自上游83f提交已移除 reflection/capability 功能的旧测试（如 reflection history/profile/leased jobs/UI），不是B站测试；严格未定义调用扫描通过。Windows全量仍有历史平台环境失败，不宣称全量绿。
- 生产实际第一版自动/手动轮次共产生3候选、2条旧格式分享；用户反馈和架构复核后，已重新部署Lifecycle集成版本。随后执行一次受控真实轮次：2个候选均被字幕/兴趣条件跳过，`offered=0`、`shared=0`，没有直接QQ发送。当前状态记录权限0600，未保存cookie或字幕全文；后续只产生活动记录并唤醒QQAgent，是否发言由Lifecycle决定，B站模块不再直发。

## “活人感”修正

用户指出第一版的固定模板：`【B站分享】`、UP、BVID、理由、摘要和结尾问题，像搬运脚本而不是原有QQAgent偶然发现后想告诉管理员。

已改为：

- 内容判断 prompt 注入原有 `roleText`/管理员附加规则；风格不由B站模块另设。
- 模型返回有限 `shareText`，正文是一条短的偶然发现式表达，具体观察+可选开放问题；只在末尾附视频链接。
- 删除固定报告字段、营销式摘要和机械问题；状态仍保留短摘要/分数供去重和审计。
- 调度从每3小时/每日最多2条收紧为每日一轮/每日1条；同一候选7天内不重复分析，服务停止取消进行中任务。

## 账号与限制

用户提供了B站账号手机号/密码，希望登录拿cookie。当前会话/执行环境没有可用的图片输入、浏览器登录和验证码交互通道；公开接口已能完成首版发现/详情/字幕链路，所以**没有把密码写入脚本、服务器、Git或日志，也没有绕过验证码登录**。若后续需要登录态视频/字幕，需在有浏览器/验证码交互的安全入口完成扫码/登录，再单独接入cookie保管。

仍有限制：B站公开非官方接口可能限频/改版；无cookie时部分视频/字幕降级；首版不看视频画面/直播，只用公共元数据和字幕；兴趣判断是有限模型小样本，不是持续理解全站；OneBot虽然当前 connected，但本次分享不等于SC8或完整QQ验收。
