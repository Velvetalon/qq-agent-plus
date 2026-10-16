# 审计来源清单与远端核对

日期2026-10-16 UTC。基线 `2be4bccce643d4d40bdc4472e5703f3a109aac2e`。本清单只覆盖项目技术文档/归档patch；没有读取私有运维备忘或运行数据库。

## Git证据

- 初始工作区 `work` 分支，干净；HEAD与fetch后的origin/main一致。
- `git fetch origin`：退出0。
- `git ls-remote --heads origin`：退出0，仅 `refs/heads/main` → `2be4bccce643d4d40bdc4472e5703f3a109aac2e`。
- `git ls-remote origin 'refs/pull/*/head'`：退出0，无输出。因此没有可检查的可见未合并远端分支/PR head；这不证明已删除分支或旧云未推送成果不存在。未合并任何产品代码。
- 本次创建独立 `docs/progress-audit-20261016`。AGENTS默认main/上线节奏不适用于用户明确限定的文档审计；遵循本次指定的独立分支边界。
- main中的 `6acd177` 是Notebook gated guidance历史提交；`9069a4f` 修改共享角色笔记规则；`7ed9bf3`为功能修复；`059eba5`为LSR；`8233c83`和`2be4bcc`为Social WIP。这些提交均在当前main祖先链，不能说后续未核验的Notebook修复已经推送。

## 历史 Social 源码指纹核对

以下11个SHA-256前8位全部与 `docs/verification/social-engine-closure.md` 记录一致。它证明记录指向的这11个文件内容在当前远端，**不是重跑历史测试**；未重建42文件总digest，不能据此验证所有历史外部日志。

| 源码 | 当前SHA-256 |
| --- | --- |

| `src/plugins/manager.js` | `a73a47f045e722e6b1378d2da355f4c996f207186c5448dca345fce3b8a1192d` |
| `src/plugins/self-evolution/reflection-store.js` | `c586a5bebf5b0292bc2c3093df4685700aaf03d99b6cb398543a5421fea22291` |
| `src/plugins/self-evolution/learned-self-provider.js` | `f468a37c0c867ce446a3693eaf2d35ae4a4e36cb40b324a107247cb91625d025` |
| `src/plugins/self-evolution/notebook-store.js` | `4af609b2627daae5e93a740b8fa9cbd2a151762cdc8705f8f6ea7df672e91e7d` |
| `src/plugins/self-evolution/retrieval-provider.js` | `71b12ba3b60e62681515cd4f0f2aa60d97c3de7a529e57246122adcdb53719e1` |
| `src/conversation/context.js` | `ff88a8f14ef19bbc26138108dea0737c1ce03e328ed584176ad816ff54770de8` |
| `src/conversation/state.js` | `0ba97b4b6e2faea4cff4f19fe615f4c260b21ad7a150d459d0a56a4f46e1c9e7` |
| `src/core/orchestrator.js` | `2b282e1c47c92273a63b97d4ab6cbfa7d1b60374345ffda07b10f4ec0626dd8b` |
| `src/core/store.js` | `f567455008cd103e624e7e61fdd73b5a2ae82298bb00672566f7109e95702d78` |
| `src/onebot/sender.js` | `8b6f89d91412882cd42a2cb0bb897e6c45e748c90ca1ea10a5b148b8311a3da8` |
| `src/plugins/context.js` | `f5215c734788f8800a26936286815f8d48b0bbd29e2547283fce3ffd2ceb7487` |

## 文档来源与冲突优先级

1. 本次用户约束优先：仅审计/文档，禁止开发、生产和付费调用。
2. 本次 CURRENT_PROGRESS 是当前结论；旧 schedule、验证报告和归档原文保持原状作为历史。
3. 10-13 Social设计/验收及接管契约取代冲突的LSR单会话/纯沉默旧规则；09-28功能修复取代更早lexical降级目标。未实现新要求就是偏差，不能以旧测试仍通过解释为完成。
4. 旧索引指向不在当前树中的09-24 plan_doc及旧云work日志，标为无法验证，不补造。归档patch保留但未应用。

## 全量 delay 与相关规划/验收文件

下表固定在审计基线，校验原证据仍在；本次新增文件不计入旧来源。

| 文件 | SHA-256 |
| --- | --- |
| [delay/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/README.md) | `bbc885a98943713290f30fe2a9bc8ab9ea2d9428cf14de769c63ae4542524a62` |
| [delay/archive/2026-09-25-pre-closure-plan/schedule/handoff-2026-09-24.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/schedule/handoff-2026-09-24.md) | `a84dd7293513349ce31927d38278721e287872931c79bb903c4a8bfeedb6231a` |
| [delay/archive/2026-09-25-pre-closure-plan/schedule/p2-interrupted-2026-09-24.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/schedule/p2-interrupted-2026-09-24.md) | `d06606154cdfaa4e0e84757cbf1f8b730178aeba1e5c9ad29b73e4ff9b4cc421` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P0-baseline.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P0-baseline.md) | `9f46cb847002bab7e8e2df8698d03384df4b235e4e95bfcc73494d5b6875419a` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P1-plugin-registry.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P1-plugin-registry.md) | `d21a17f6febac5fc93583b3bec50a3eeee3690ecd0219231fafea7ce792eb61b` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P2-plugin-lifecycle.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P2-plugin-lifecycle.md) | `3af2451cee47b1f8e1774f8f3b167c03c3d9f00fdb8c3231dbcacf791fad76af` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P3-active-silence.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P3-active-silence.md) | `0549f7646799355008ce76ce80715f9b22866f5f4fd97122c27c95d80a551448` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P4-notebook.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P4-notebook.md) | `d85d475c0f220ba89cf05f2ce5ab0a550c01777c79865a3843a12c890319cf1c` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P5-retrieval.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P5-retrieval.md) | `5299de301a9aade73dabe852a80d0c1619603b68287dc31604fd7d0a4069f8a7` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P6-reflection.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P6-reflection.md) | `34a1032c530624c7e7bc1fb869a2fb638073cdc7d9047c7055ef08eba32ccaf2` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P7-console-observability.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P7-console-observability.md) | `bc031439569a0faba8f3d71061df6001126f3d82a6ae3ddd6a707719584491bd` |
| [delay/archive/2026-09-25-pre-closure-plan/task/P8-release-validation.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/P8-release-validation.md) | `9142cfaa852660cc438c48e7c65c996767e636ada39d6f3e9b7c5c92f7d24820` |
| [delay/archive/2026-09-25-pre-closure-plan/task/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-25-pre-closure-plan/task/README.md) | `74395302df1014950eaa9e7ab6a38475aa64c263eeeb6f07a1f6ae50bd9bd5e6` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/README.md) | `4875ff8902ee472382949207e2d5289e7808cff758316373eacd4a6a047150e3` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/plan/2026-09-25-self-evolution-closure.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/plan/2026-09-25-self-evolution-closure.md) | `abe9645c63fefd0190e07d3f9fda5d00d0d81e6d8e88a0a0cd4a6e29d19833e8` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P0-account-namespace.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P0-account-namespace.md) | `3247b6d2d1d301094c9488400e15bac0759b66b9f5a8269a27e4c9b6819d7e21` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P1-notebook-scope.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P1-notebook-scope.md) | `5c0001d3290acbafdce2b4294a2a7b742275709776838f1a10296508d7a940c1` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P2-retrieval-context.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P2-retrieval-context.md) | `0d69df5607a6991b4a53f9c04187075a560664e8358ad79cdc8d93d53889544a` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P3-learned-self-revision.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P3-learned-self-revision.md) | `97c93dfef22dbe28d1f6d84a80c94c80b0670d4fde06a987c4d3fe457626c073` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P4-reflection-scheduling.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P4-reflection-scheduling.md) | `571cede005ab71c0d9cddb0672874bf9fbd9e30559475a4c77efa412aba41f82` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P5-notebook-prompt.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P5-notebook-prompt.md) | `27744438bcf99c0e5400ab5b044518aa67512e442ee7cfb464f8216508a9b33d` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/P6-closure-verification.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/P6-closure-verification.md) | `9d9dfff107fe4baabec123c775314b8ffe0ea9acdcad61bff8966ad1080a8fee` |
| [delay/archive/2026-09-27-pre-vector-persona-plan/task/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-27-pre-vector-persona-plan/task/README.md) | `fa311a71a0313189c82176ff58f8f4f8149a9709baa681fde61c2e1cd81d74a7` |
| [delay/archive/2026-09-28-pre-functional-repair/plan/2026-09-27-self-evolution-vector-persona.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/plan/2026-09-27-self-evolution-vector-persona.md) | `3b8f460bd40b94de850f2e7a7c8f98e9f419302ac021d09b00de5b586c5b6749` |
| [delay/archive/2026-09-28-pre-functional-repair/task/A-evidence-budget.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/A-evidence-budget.md) | `1f61558b96204c80637aea2113734ff6def5a3046efb6d5c9a89e21d679cf8b7` |
| [delay/archive/2026-09-28-pre-functional-repair/task/B-reflection-deadline.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/B-reflection-deadline.md) | `5a44da93968c3d458353a9bd28604420410023649e6518d6dbff2a1b7fb79c11` |
| [delay/archive/2026-09-28-pre-functional-repair/task/C-vector-retrieval.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/C-vector-retrieval.md) | `37aecbc7da96f2eafe4ae3a45c169ef7a1ee56ac77f26272991f3ae5c565a942` |
| [delay/archive/2026-09-28-pre-functional-repair/task/D-role-notes.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/D-role-notes.md) | `de3fafc1d24873576a456c6d2f217b157fad38254de9e67b5adc4f334d592c3e` |
| [delay/archive/2026-09-28-pre-functional-repair/task/E-integration-closure.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/E-integration-closure.md) | `fd11c638a326307781ae0fc0f719d7b50146d4bc26337a9efa6744af2fa754fe` |
| [delay/archive/2026-09-28-pre-functional-repair/task/P0-baseline-and-vec-smoke.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/P0-baseline-and-vec-smoke.md) | `ec902a35387563abe747c0e02b1686e7be965590eb9e93d56c43b30b8fb875f6` |
| [delay/archive/2026-09-28-pre-functional-repair/task/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-09-28-pre-functional-repair/task/README.md) | `f554cbf665b4bfcf6413600c0fbc46525309ed4a29c7b2683dca4bf3b0744ec5` |
| [delay/archive/2026-10-13-pre-social-stash/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-10-13-pre-social-stash/README.md) | `0ee313700e6419f2c2a9e0953b10fd7b44379954c6643539fea9af55c448d7f4` |
| [delay/archive/2026-10-13-pre-social-stash/reflection-store.partial.patch](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/archive/2026-10-13-pre-social-stash/reflection-store.partial.patch) | `6a82e657ae9ce47e4a1746858099f2327a70ed33765f13337df45abefac64d26` |
| [delay/plan/2026-09-28-functional-repair.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/plan/2026-09-28-functional-repair.md) | `29d97ca7ec7dd5e12d95f080b8915600af0a060a503d8e6934f37c7b35bfb33d` |
| [delay/plan/2026-10-09-learned-self-repair.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/plan/2026-10-09-learned-self-repair.md) | `bfa8c72f596f9275d33ba16f71b6d1a3077e2f1f50587776dc6ee2ca56903c71` |
| [delay/schedule/2026-10-13-social-engine-resumed.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/schedule/2026-10-13-social-engine-resumed.md) | `55239ba2a4d19726b966fded29aefcea181ca7d87f5c5a20de1fbc0306657416` |
| [delay/schedule/2026-10-13-social-engine.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/schedule/2026-10-13-social-engine.md) | `a5857d2a80f46dd5e9964dc6f75bbf24599aa55ddb8843a1ddf384d91bcab36e` |
| [delay/schedule/2026-10-14-github-wip-handoff.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/schedule/2026-10-14-github-wip-handoff.md) | `a604bd047796dc4f01d66e30e94b95489c06274a667d4025b27e02b3e0f7b6e8` |
| [delay/task/LSR1-profile-cleanup.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/LSR1-profile-cleanup.md) | `10e6dd195da745c8cf8e72c52558afd99ec031ceb3237317f0dd3585906f5fe3` |
| [delay/task/LSR2-evidence-gate.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/LSR2-evidence-gate.md) | `9eaafbe97362989a98ffa85b597ad057dc23c0e3c1167cab20834d4b7ef6deb5` |
| [delay/task/LSR3-reflection-policy.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/LSR3-reflection-policy.md) | `03d52cce6d059dc39bbd2953ae18fcea3d63640ef5a2b7a12c3521b47e224075` |
| [delay/task/LSR4-injection-closure.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/LSR4-injection-closure.md) | `e5d42f0f2171b64d82cf8c0845530c40c73746a1b6c412a43eba69dc3b50d601` |
| [delay/task/PR1-config-authorization.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/PR1-config-authorization.md) | `eb1a1e7fba8df4142c4f5213486f7ef77b126793b980053dd67f90eeb6d81bfe` |
| [delay/task/PR2-index-retrieval.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/PR2-index-retrieval.md) | `caf1ffc29e101eeb9c36c1a1ae706cbe0d71990ddeffd1aef974304a866f5d52` |
| [delay/task/PR3-evidence-budget.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/PR3-evidence-budget.md) | `abdb07f849ab36ef19e48b454017bff125951f96ff6bb746937f827b08ba066d` |
| [delay/task/PR4-role-console-closure.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/PR4-role-console-closure.md) | `8f63557194420581a6e46400016079b7cbd536a13b900f8b85dbd10300b90fb7` |
| [delay/task/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/delay/task/README.md) | `21e46c174ee1885f5a1d68de6dbc72e864f1f2b523125c3f2330bd7b7f958534` |
| [docs/verification/social-engine-closure.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/social-engine-closure.md) | `19ee45e8ad21973185dbd5d22419ef18ec3ed88416dd41e9b867103b2b6ccd9e` |
| [docs/verification/vnext-functional-repair-pr1.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-functional-repair-pr1.md) | `4b9b63350f59258c00fa6d434a3a017d32cfe3a83b554eeb0015138fb35945b2` |
| [docs/verification/vnext-functional-repair-pr2.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-functional-repair-pr2.md) | `f6257040395a5f2aaaa6e8395d1d0618ad97ef32b0867c7686249d20057d5fec` |
| [docs/verification/vnext-functional-repair-pr3.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-functional-repair-pr3.md) | `8f725643adc3fadc92e76f0e88f9ba33ec5d82a0e1d28362568a23b6bec83489` |
| [docs/verification/vnext-functional-repair-pr4.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-functional-repair-pr4.md) | `fc7e73ee47b5e0f9f8ca4e1c54f4dfa37897092eb47597d2e08e78eb1406ff31` |
| [docs/verification/vnext-learned-self-lsr1.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-learned-self-lsr1.md) | `639a50210db80c09761d4b8102fd52f33e5936840429da7ee595faa5a8bdf609` |
| [docs/verification/vnext-learned-self-lsr2.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-learned-self-lsr2.md) | `138502c1ebd626cb09eb5242608f605dc511817b55328342bd69666f63cdbb36` |
| [docs/verification/vnext-learned-self-lsr3.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-learned-self-lsr3.md) | `40a9df9a753177ab23593173bb5112b8195afa5cff8f1c02666e912390ab4034` |
| [docs/verification/vnext-learned-self-lsr4.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/docs/verification/vnext-learned-self-lsr4.md) | `480ef97dc5e396db34dedd2e7485b26ffcd05de82ad65082481e7c42fa6532ef` |
| [plan_doc/2026-10-13-social-conversation-acceptance.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/plan_doc/2026-10-13-social-conversation-acceptance.md) | `ac2ee58b819e965496a05ebf9869143f3c9ded119118852da7b2fd0e12c6f061` |
| [plan_doc/2026-10-13-social-conversation-development-plan.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/plan_doc/2026-10-13-social-conversation-development-plan.md) | `8c560331721251e381f6f28071ede0b59fffc745ae9fe76ba0e100b582f98fa4` |
| [plan_doc/2026-10-13-social-conversation-engine.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/plan_doc/2026-10-13-social-conversation-engine.md) | `29ae2c97b30717517236f62e6bbf9848e69b175b11a2ef6ec21c10d776cb8a4b` |
| [plan_doc/2026-10-13-social-takeover-contract-v1.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/plan_doc/2026-10-13-social-takeover-contract-v1.md) | `8354f00b727bded9383ba31931e86d4aef949e3c6959faf1ae20db053f6d9f47` |
| [plan_doc/README.md](https://github.com/Velvetalon/qq-agent-plus/blob/2be4bccce643d4d40bdc4472e5703f3a109aac2e/plan_doc/README.md) | `f9b5dc2a85efc6d534436f2ae171d389d71a7e6ee80eaa19c1ff185207cf4f34` |
