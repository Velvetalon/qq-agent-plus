# 真实模型离线回放与必选 Embedding 验收（2026-10-19）

## 范围与结论口径

用户指定 chat `deepseek/deepseek-v4.1-flash-1017`，后续明确将 embedding
作为必选能力，指定 NanoGPT `Qwen/Qwen3-Embedding-4B` / 2560 维及独立设置页。
使用已有同一密钥仅做进程内认证；没有把真实密钥保存到新的 QQ 配置，没有真实 QQ
发送、生产聊天外发、生产清理、部署、主线合并或 GitHub 写入。

真实模型 + 合成 OneBot 接收边界证明模型/宿主的离线行为，不等同真实 QQ 平台验收。
公开资料工具返回明确标注的虚构公告，不是声称抓取了真实发布。
`EXECUTED_REQUIRES_SEMANTIC_REVIEW` 只表示有真实输出，不是 PASS。
下面是逐个观察后的结论，不以零消息、mock 向量或接口 HTTP 200 代替语义通过。

最终结论：17 项中 **14 项有当前小样本支持，A-B07 FAIL，A-R06/B10 PARTIAL / OPEN**。
最后一轮后停止真实调用和继续调 prompt，保留反证，不把强角色风格的真实性问题偷偷改成通过。

## 最终采用的逐例证据

证据根目录保留在仓库外的 `qqagent-real-chat-20261019`。保留所有失败/中间轮次，
不覆盖原始 result/calls。不同修复检查点的证据分别标注，不冒充同一版本的一次整跑。
后期真实回放附 `code-manifest.json`，记录运行开始时源码和 fixture SHA-256。

| ID | 采用场景 / 证据目录 | 结果与理由 |
| --- | --- | --- |
| A-P08 | short-invitation、joke-idle / final-native-A | PASS，小样本：低参与度明确邀请仍回应；高参与度无人接话 tick 不追加调用/发送 |
| A-R02 | serious-help / final-native-repairs；persona-continuity / final-native-B2 | PASS，小样本：完整技术步骤压为 3 条；短算术 1–2 条，Git 回答围绕问题，感谢后不续答 |
| A-R06 | identity / final-native-B；meme-repetition / final-native-finalcheck | PARTIAL / OPEN：身份专门题诚实，但最终梗图输出虚构过去修改注释的经历，跨场景反例未解决 |
| A-M02 | fact-joke-wish / final-native-B2 | PASS：真实反思把已修 CSV、玩笑、未实现愿望、未验证推测分别记录，未创建提醒或 trait |
| A-L04 | unrelated-evidence / final-native-B2；split-evidence、assistant-only / final-native-finalcheck | PASS：三无关互动不提 trait；拆三批同 interaction，首批 noop 后两批 empty；assistant-only 0 新 session/调用/发送/候选/晋升且 audit 为 null |
| A-B01 | short-invitation / final-native-A | PASS：短问题直接接内容，一条可结束 |
| A-B02 | human-complete / final-native-A | PASS：群友完整对话只旁听，0 外发 |
| A-B03 | interleaved / final-native-A | PASS：选技术对象/主题，不混入娱乐支线 |
| A-B04 | cancel-inflight / final-native-finalcheck | PASS：HTTP Replyer 开始后注入撤回，0 发送，新增 session 明确审计 target-withdrawn-or-updated |
| A-B05 | joke-idle / final-native-A | PASS：玩笑之后无人回应，后续 tick 0 新调用/0 发送 |
| A-B06 | public-share / final-native-public-vision | PASS：无新的人类命令，配置兴趣机会产生 2 条具体更新；真实 sourceRef、topic 和意图投递审计成立；6-call 机会预算内已送达，但 replyerFinished=false，不宣称自然结束也通过 |
| A-B07 | meme-repetition / final-native-finalcheck | FAIL：最后同 fixture 复测仍“编译过了谁动谁死”→“能跑就别动，这是祖训”，同一包袱换词；第三图有新角度不能抵消第二图 |
| A-B08 | serious-help / final-native-repairs；serious-distress / final-native-A | PASS，小样本：认真技术回答保留关键事务/ack/库存步骤；低落情境停玩笑、询问实际困难 |
| A-B09 | technical-memory / final-native-B | PASS：retry/503/退避正常讨论，真实反思保留技术经历，而非按运维词粗暴删除 |
| A-B10 | identity / final-native-B；最终梗图反例 | PARTIAL / OPEN：专门题通过不能掩盖其他场景的无来源过去行动 |
| A-B11 | memory-create/recall/unrelated / final-native-memory | PASS：真实反思→Notebook→4B入库；新 ChatStore 重开同一 Notebook，相关题命中并答回命名缘由；无关 UTC 题 0 命中 |
| A-B12 | persona-continuity / final-native-B2 | PASS，小样本：同一强人设连续多轮未串旧答案，感谢后沉默；仍有“这种题也考我”等略强的角色措辞，不宣称自然度完美 |

仅这组固定小样本，没有扩大成通用模型质量结论。观察维度为对象/话题正确性、内容
新增性、时机、人设一致性、适度主动性、能否结束；不以一个总分遮蔽 B07 的真实失败。
已具备旁听、主动分享、正常长期记忆和认真回答的实际正例。没有真实生产前后样本，
不报告质量提升百分比。旧/新可直接比较的是相同 fixture 的截尾、旧问重复、梗图复读；
改过入站构造的图像 fixture 或跨会话记忆 fixture 不与旧不完整输入算同条件提升。

## 必选 Embedding 的实际链路

1. `embedding-native-001`：17 次实际 HTTP 成功，6 条合成笔记向量入库，均 2560 维。
   关闭再打开 SQLite 后查询，5 正例/3 负例中文小样本可分：正例最大余弦距离
   0.38898590207099915，负例最小 0.6850430965423584。间隙中点 0.5370144993066788
   得 TP=5、FN=0、FP=0、TN=3；另 2 正/1 负留出查询通过。它不是泛化质量保证。
2. 实际独立 UI 新配置保守阈值为 0.5；不自动覆盖已有阈值。修改阈值不改变向量 profile。
   单独校准中模型/维度换 profile 不读取旧向量，也不假装词法回退命中。
3. `final-native-memory`：13 次真实 chat、5 次真实 embedding，0 错误。真实 chat
   完成事件经 ReflectionWorker 写入经历并索引；下一 case 使用全新 ChatStore，只有
   重新打开的 Notebook 提供相关记忆，命中审计有 note ID/profile ID。无关题 0 命中。
4. 独立设置页、错误与降级、保存/取消/重复/刷新/重启、换网关不得复用旧 key、密钥
   掩码与 390px 实际浏览器结果见 [设置页验收](embedding-settings-20261019.md)。
   真实 key 未落入持久配置；浏览器保存/重启测试用明确的合成 key。

## 真实试验发现的修复及保留失败

- 初始 canary：Replyer 只返回普通文本，实际 0 发送。强化内部草稿/可见工具契约后
  复跑才成功，未由宿主把模型文本伪装为工具调用。
- participation 以前未传入 Social prompt；加入低/中/高软偏好，不覆盖直接邀请或
  相关性，不变成发言配额。
- 技术回答 5 条被 host cap=3 截掉尾部。模型看到 cap，工具 schema 宣告上限，整批
  预检剩余额度后让模型自己压缩。独立审查进一步发现 Sender 的 Markdown/QQ 长度
  分片会增加物理消息数，现与 Sender 共用 `prepareTextParts`。未知/partial 门不改。
  见 [批次/物理分片验证](social-message-cap-20261019.md)。
- 强角色多轮曾重答旧算术题。当前目标和历史背景分开，旧已发文本不是待发草稿。
- 公开分享 fixture 最初错误绑定了最近活跃而非共同兴趣所在 topic；修正合成入口。
  生产 prompt 补 dueIntent 的确切 topic，提前拒绝跨 topic 决定，保留租约/来源门。
- 模型把 sourceRefs 输出成 ID 字符串，而修复 prompt 没给完整 schema/允许 topic。
  现在一次有界修复获得完整对象契约和实际允许集合；严格 validator 没有放宽，伪造
  scope 的真实 Orchestrator 单测仍 0 发送。真实重跑获得主动分享正例。
- 首次集成记忆的 embedding 查询被外层固定 5 秒切断，先前索引请求已花 5.1 秒。
  client 上限 60 秒、provider 外层 65 秒，5.1 秒实际 PluginManager 回归通过。
  此前失败没有被算召回成功，外层不会抢先遮蔽 client 自己的明确错误。
- 梗图初轮媒体缺 OneBot 正常 `[图片]` 标记，不能算视觉验收。修正后确有真实 image_url
  请求，但第二张仍近义复读；保留失败，只做一次最后的同 fixture 新增性上下文复测。
- replay 旧 audit 可能取到以前 case 的持久 session 或 waiting follow-up。现在按 wake/tick
  前后新 ID 采样，所有新 session 保留、无新 run 明确 null。旧 assistant-only 原始 batch
  继承的 delivered audit 不作为本次证据，改用 finalcheck；旧独立 0 calls/0 outputs仍是事实。

## 有界调用与成本

完整每次运行最多 100 次顺序 chat 请求、800,000 reported/reserved tokens、每次最多
2,048 输出 token、60 秒请求超时、30 分钟共享绝对截止时间；保守 UTF-8 admission
单次上限 128,000，给真实图片载荷留空间。实际用量返回后释放保守 reservation。
集成 embedding 另有 32 次/50,000 字符上限，且不能越过该共享截止时间。
独立 embedding 校准上限 32 次/50,000 字符/10 分钟。失败后锁闭，无自动外连重试。

初始 shell proxy 不可达，1 次无 HTTP 回应的尝试后转到原要求的 dot native 环境；没有
改网络权限或接触受保护 session 路径。最初 full-native-001 达到 100-call 上限而没有
跑完最后反思，标 PARTIAL，不采信旧脚本只写 EXECUTED 的粗状态。原始记录保留。

包含失败、canary、开发修复复测在内，共 268 次 chat dispatch，267 次取得 HTTP 回应，
已报告 1,789,190 tokens。266 个回应的返回 cost 为 0 USD，1 个回应没有 cost；另 1 次
未获回应。不能据此说实际账单为零。每次成功回应延迟中位数 2,046 ms，P95 6,194 ms，
最大 21,377 ms，含 Planner/Replyer/reflection/repair，非用户端整轮延迟。
Embedding 共 24 次尝试、23 次 HTTP 回应、1 次被旧 5 秒外层取消，报告 707 tokens；
全部未返回 cost，所以 embedding 费用及取消请求是否计费未知。没有执行扣费/余额接口。

## 最终本地门禁与独立复核

- Node 22.22.2，全量 **800 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**。
- prompt PASS；render 138；scroll 19；usage 31；local 9/9；sqlite-vec 0.1.9 smoke PASS。
- `ops scan --strict`：0 可疑调用；`git diff --check` 无问题；全部 src/ui/live 模块语法检查通过。
- 归档后再次全量复跑仍 800 PASS，包含最后的 embedding budgetStops 记录修正。
- 待提交文件秘密模式检查仅命中两处明确的无效 URL 合成测试，无真实 key、环境配置或原始回放入 Git。
- 真正 Chromium 独立设置页六组验证通过，provider/OneBot 边界明确为合成，外网/QQ发送 0。
- 最终独立审查 **86 focused PASS**，无 P0/P1；确认以上三项真实语义缺口，未将其归入 PASS。

独立只读复核发现并复核修复物理分片计数和 replay session 归属；未发现 P0/P1。
检查与 mock 测试只证明覆盖范围，不替代上述真实语义观察。
所有更改仍为当前工作分支的本地进度，不代表全部任务卡已结束；SC8 **USER_PAUSED**，
真实 QQ 平台行为未跑，也没有暗中解除这些门槛或发布到 GitHub。
