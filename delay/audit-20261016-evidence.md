# 2026-10-16 本次验证证据

代码基线：`2be4bccce643d4d40bdc4472e5703f3a109aac2e`；分支：`docs/progress-audit-20261016`。所有命令在本仓库根目录执行，Linux x64，Node `v24.19.0`，npm `11.9.0`；不是 CI 的 Node 22 环境。测试只使用合成临时 SQLite/数据目录与测试内部 mock，没有生产访问、部署、真实模型、embedding 或 QQ 外发。

## 环境与安装阻塞

`npm ci --ignore-scripts --no-audit --no-fund`：退出 1。锁文件中 `https://registry.npmmirror.com/ws/-/ws-8.21.3.tgz` 返回 **HTTP 403 Forbidden**；同时出现 tarball/解包告警。安装未成功，`ws`、`sqlite-vec` 缺失。不把下载拒绝推断为所有包自身损坏，也没有改 registry/lockfile、另建凭据或换源绕过。停止该下载路径。依赖残留只在忽略的 node_modules 中，未提交。

首轮 focused 使用默认 spec reporter：31 PASS / 8 FAIL，随后 shell 的 tail 覆盖了子命令退出码。为保存可复查退出码，以相同文件集合再运行一次 TAP；以下采用后一次结果，不累计两次通过数。

## V1 Focused

开始：`2026-10-16T04:08:53.695062+00:00`；退出：`1`；结果：**39 runner entries；31 PASS / 8 FAIL**。

```sh
node --test --test-reporter=tap --test-concurrency=1 test/prompt-safety.test.mjs test/social-app-integration.test.mjs test/social-console.test.mjs test/social-engine-integration.test.mjs test/social-management-ui.test.mjs test/social-memory.test.mjs test/social-runtime.test.mjs test/social-state.test.mjs test/functional-repair.test.mjs test/learned-self-evidence-gate.test.mjs test/learned-self-injection-closure.test.mjs test/learned-self-policy.test.mjs test/learned-self-profile-cleanup.test.mjs
```

仅保存 runner 的测试名与结论；不提交模型输入、SQL原文、聊天、密钥或完整 traceback。文件加载失败也计入 runner fail，不能解释为同数目的业务断言失败。

| 结果 | 用例/文件 |
| --- | --- |
| PASS | host embedding capability keeps credentials private and honors explicit query denial |
| FAIL/BLOCKED（见分类） | semantic search does not create document embeddings and reports index-not-ready |
| FAIL/BLOCKED（见分类） | temporary embedding failure retries with a bounded delay and reaches ready |
| PASS | only schemaVersion 3 plus evidenceVersion 3 qualifies as structured preference provenance |
| PASS | assistant-only proactive evidence cannot support traits, while human silence remains reflectable |
| PASS | three independent current human roots accumulate by interaction identity in one chat |
| PASS | one source, a forged reference, and global scope cannot become an adoptable candidate |
| PASS | LSR4 stores metadata, filters expired traits, exposes provider diagnostics, and supports correction |
| PASS | procedural claims reject per item; behavior candidates stay pending until explicit review |
| PASS | LSR1 audits trait entries, previews without writes, resets append-only, and rolls back by CAS |
| PASS | LSR1 reset is strict, account-scoped, read-only safe, and CAS protected across connections |
| PASS | LSR1 CLI is explicit, redacted, dry-run safe, and refuses missing databases |
| PASS | sanitizeUserText：半角/全角/繁体方括号的系统段标记都要弱化 |
| PASS | sanitizeUserText：繁体写法的段头也要弱化（[管理員] 曾经整条穿透） |
| PASS | sanitizeUserText：关键词内嵌零宽字符/空白不再穿透（2026-09-24 审查发现的绕过） |
| PASS | 昵称与引用预览进提示词前同样被弱化 |
| FAIL/BLOCKED（见分类） | Notebook 能力说明只进入动态用户提示一次，关闭时不注入 |
| FAIL/BLOCKED（见分类） | Notebook 正文能力提示不提升权限，也不覆盖当前消息或固定安全边界 |
| PASS | 提示词里的每个段头都能被弱化（清洗白名单不许落后于任何注入模块） |
| FAIL/BLOCKED（见分类） | test/social-app-integration.test.mjs |
| FAIL/BLOCKED（见分类） | test/social-console.test.mjs |
| FAIL/BLOCKED（见分类） | test/social-engine-integration.test.mjs |
| PASS | candidate UI shows support and counter evidence, escapes source text, and does not allow gated adoption |
| PASS | social UI separates share/react decisions, targets, materials, and failed delivery |
| PASS | notebook policy preserves technical discussion and isolates execution scripts |
| PASS | material refs require current, visible, recallable notes and exact policy revision |
| PASS | empty material validation does not open or initialize Notebook storage |
| PASS | cleanup is read-only by default and applies only matching explicit manifest revisions |
| PASS | historical preference support stays within the evidence budget without blocking new episodes |
| PASS | reflection accumulates same-candidate support from independent v3 interactions and requires review CAS |
| PASS | rejected trait output does not discard a valid episodic note and rejection status is accurate |
| FAIL/BLOCKED（见分类） | test/social-runtime.test.mjs |
| PASS | scene observation is lazy, scoped, idempotent, linked, and semantically reroutable |
| PASS | persistent interaction identity follows explicit replies without mixing platform and local ids |
| PASS | external observations are scoped, expiring host sources rather than model-created IDs |
| PASS | external source retention preserves unresolved intent evidence without reviving expired sources |
| PASS | send guard uses topic activity after the planning baseline and exempts ordinary acknowledgements |
| PASS | grounded intents are deduplicated, audited, bounded, and unknown leases are never replayed after restart |
| PASS | expired leases become held and explicit cancellation is auditable |

## V2 Self-evolution

开始：`2026-10-16T04:07:42.942947+00:00`；退出：`1`；结果：**44 runner entries；38 PASS / 6 FAIL**。

```sh
node --test --test-reporter=tap --test-concurrency=1 test/self-evolution-account.test.mjs test/self-evolution-console-account-e2e.test.mjs test/self-evolution-learned-self-e2e.test.mjs test/self-evolution-notebook.test.mjs test/self-evolution-reflection-lifecycle.test.mjs test/self-evolution-reflection.test.mjs test/self-evolution-retrieval-e2e.test.mjs test/self-evolution-retrieval.test.mjs test/self-evolution-vector-persona.test.mjs
```

仅保存 runner 的测试名与结论；不提交模型输入、SQL原文、聊天、密钥或完整 traceback。文件加载失败也计入 runner fail，不能解释为同数目的业务断言失败。

| 结果 | 用例/文件 |
| --- | --- |
| FAIL/BLOCKED（见分类） | test/self-evolution-account.test.mjs |
| FAIL/BLOCKED（见分类） | test/self-evolution-console-account-e2e.test.mjs |
| FAIL/BLOCKED（见分类） | test/self-evolution-learned-self-e2e.test.mjs |
| FAIL/BLOCKED（见分类） | test/self-evolution-notebook.test.mjs |
| PASS | reflection plugin accumulates v3 candidates, requires review CAS, and rollback changes learned context |
| PASS | disabled self-evolution creates no new DB/worker/model/embedding calls and reads old data |
| PASS | same observation window creates one idempotent job and rejects direct reflection sources |
| PASS | expired job leases are recoverable and the old owner cannot commit late |
| PASS | budget defers without spending a model attempt and failures retry finitely |
| PASS | empty reflection is a noop, duplicate evidence is not called again, and invalid output changes no business state |
| PASS | review mode approves a three-root candidate and rejects another without mutating Base Persona |
| PASS | bounded_auto never adopts behavior traits and leaves valid candidates for explicit review |
| PASS | bounded_auto applies Notebook operations without approval and keeps history |
| PASS | reflection rejects transient run summaries instead of writing them as Notebook notes |
| PASS | review approval respects Notebook CAS and does not create a profile on a stale note |
| PASS | review approval cannot widen a chat note into global scope |
| PASS | candidate review rejects a changed Base Persona before adoption |
| PASS | profile rollback creates a new traceable version and changes the learned context |
| PASS | capability gaps dedupe by real request and keep failure categories separate from interest |
| PASS | stop releases the lease and a late model result cannot commit |
| PASS | plugin worker leaves candidates pending and review rejects a stale profile CAS |
| PASS | disabled reflection creates no database or model call, while old data remains read-only readable |
| PASS | budget blocking persists until the next UTC period and then recovers |
| PASS | separate host interaction IDs accumulate bounded v3 sources without shared fake windows |
| PASS | behavior-change evidence bypasses the valid-session threshold |
| PASS | invalid completion evidence keeps otherwise valid candidates ineligible |
| PASS | completion provenance defaults to chat_run and rejects reflection origins |
| PASS | completion evidence preserves structured human sources without inferring preference from silence |
| PASS | reflection prompt specifies the canonical nested proposal schema |
| PASS | reflection worker sends bounded conversation, current profile, and Notebook input |
| PASS | bounded_auto accumulates extended preference keys without bypassing review |
| FAIL/BLOCKED（见分类） | test/self-evolution-retrieval-e2e.test.mjs |
| PASS | retrieval provider is absent from snapshots when retrieval is disabled |
| PASS | fully disabled self-evolution has no database or provider side effects |
| PASS | append, close, reopen, and retrieve returns one current-account chat block |
| PASS | irrelevant notes, account namespaces, and chat scopes do not leak into recall |
| PASS | archive and revisions invalidate later recall |
| PASS | retrieval pages visible notes so an older relevant note remains a candidate |
| PASS | embedding disabled or failed keeps lexical recall and avoids repeated external calls |
| PASS | embedding client validates a fake HTTP boundary and isolates profile identity |
| FAIL/BLOCKED（见分类） | Notebook writes queue a derived sqlite-vec index, survive restart, and reject stale scope |
| PASS | legacy canonical evidence deduplicates text without qualifying traits or inferring failures |
| PASS | expired leased jobs at max attempts terminate and do not block the next job |
| PASS | role note validation allows a concrete temporary experience without durable keywords |

## V3 sqlite-vec smoke

开始：`2026-10-16T04:07:44.263764+00:00`；退出：`1`；结果：**BLOCKED：依赖模块未加载**。

```sh
node scripts/sqlite-vec-smoke.mjs
```

## V4 Prompt self-test

开始：`2026-10-16T04:07:44.295912+00:00`；退出：`1`；结果：**BLOCKED：依赖模块未加载**。

```sh
node test/test-prompt.mjs
```

## V5 Render

开始：`2026-10-16T04:07:44.362415+00:00`；退出：`1`；结果：**134 PASS / 1 FAIL（ws 缺失）**。

```sh
node test/render-test.mjs
```

## V6 Scroll

开始：`2026-10-16T04:07:48.038064+00:00`；退出：`0`；结果：**19 PASS**。

```sh
node test/scroll-test.mjs
```

## V7 Shell syntax

开始：`2026-10-16T04:07:50.609902+00:00`；退出：`0`；结果：**PASS（仅语法，不执行部署）**。

```sh
bash -n deploy.sh deploy-all.sh manage.sh
```

## 失败分类与计数

- V1：39 runner entries，31 PASS / 8 FAIL / 0 SKIP。8 个失败中，**2 个实际 Notebook 提示词断言失败**（prompt-safety:127、177）；2 个 functional-repair 因 sqlite-vec 不可用未到索引行为（期望 index-not-ready 实际 extension-unavailable；期望 processed=1 实际0）；4 个 Social 文件因缺 ws 在 import 阶段失败（app-integration、console、engine-integration、runtime）。后6项属于环境阻塞，不能用它们判断实现本身成功或失败。
- V2：44 runner entries，38 PASS / 6 FAIL / 0 SKIP。5个文件缺 ws（account、console-account-e2e、learned-self-e2e、notebook、retrieval-e2e）；1个 vector-persona 索引测试扩展不可用。38项通过包括 Reflection worker/store、生命周期、旧事件门禁、局部检索。部分 retrieval 用例实际走 lexical，**不是 sqlite-vec 验收通过**。
- V3：缺 sqlite-vec；V4：缺 ws；V5：134个渲染断言通过，1处 createApp 导入缺 ws，不能记录成138通过或全绿。
- V6为脚本内19项滚动逻辑检查，不是浏览器窄屏视觉验收。

## V8 静态检查

逐一执行 `node --check <file>`，集合为 `src/ scripts/ test/ ui/` 下全部 `.js/.mjs`：**245文件，全部退出0**。使用 Python pathlib 递归枚举并逐项收集退出码，未漏过子目录。Shell 检查另见V7。语法通过不证明功能或依赖可加载。

## 未运行与边界

- 全量 `npm run test:unit`、组合 `npm test`、`test:local`、usage-e2e、ops strict scan：NOT_RUN；已知依赖加载失败，未通过扩大失败扫描伪装完成。未重新执行与当前审计无关的部署/更新进程集成。
- 历史Windows 660/45/3及248/35专项结果没有在此环境复现；不能推断那45项已修复、仍全存在或都是Windows原因。
- 浏览器桌面/窄屏完整QA：NOT_RUN；历史截图在旧外部工作区，本次不可取。
- 真实模型自然度、成本/延迟、embedding语义阈值及QQ发送：LIVE_NOT_RUN（本次禁止）；合成fixture不是运行输出。
- 生产SSH、备份/reset/清理、部署、模式切换、解除禁言、Release/tag：NOT_RUN（本次禁止）。

## 复跑条件

在获准且能正常安装锁定依赖的环境，先让 npm ci 与 sqlite-vec smoke 成功，再按V1/V2逐个文件复跑和补齐矩阵标注的主链缺口，最后运行CI定义的全部检查及 npm test。保留失败、退出码、基线SHA和fixture范围；不要修改业务或断言来制造通过。本次不继续处理403下载，也不自动尝试收费外部服务。

## 文档提交检查

2026-10-16：仅6个delay文档列入提交；200个矩阵ID唯一，所有新增文档链接的本地目标/固定基线文件存在，两个既有入口的原正文逐字保留。新增文本按私钥、GitHub token、AWS access key、长API key、URL内嵌凭据模式扫描，0命中，并人工审阅内容和提交路径。扫描不代表绝对秘密检测保证。业务代码/测试/锁文件没有变更；暂存diff通过空白检查。远端提交包含性由push后的ref查询单独核验，准确SHA在最终交付回报中给出。
