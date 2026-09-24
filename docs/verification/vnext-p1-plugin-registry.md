# vNext P1 Plugin Registry Verification

- Verification date: 2026-09-24 (Asia/Shanghai)
- Baseline: `e2abe9416afe154bd495b5190e66abbcc06e41b8`
- Scope: contract, registry, manager/context skeleton, Legacy Adapter, and Orchestrator run snapshot only.
- Explicitly out of scope: `stay_silent`, Notebook, prompt style, Sender/Outbox, send queue, configuration defaults, role text, new execution path.

## Implementation

Added:

- `src/plugins/contract.js`: plugin/tool/provider/observer validation, effect metadata, owner checks, reserved `finish` name, and terminal authority guard.
- `src/plugins/registry.js`: staging, duplicate detection, stable plugin/tool ordering, atomic publication, revision, and provider/observer registration.
- `src/plugins/manager.js`: enablement state, generation tracking, frozen config/tool/plugin snapshots, and read-only tool handles.
- `src/plugins/context.js`: narrow per-run context skeleton with fixed chat/session identifiers, signal, config snapshot, visible participants, message IDs, and tool handles.
- `src/plugins/builtin/legacy-tools.js`: registers the existing `tools-core.js` definitions as one required `legacy-tools` owner with internal effect metadata.
- `test/plugin-registry.test.mjs`: focused P1 contract, atomicity, ordering, compatibility, and snapshot tests.

Changed:

- `src/core/orchestrator.js`: default manager registration and one run snapshot at `#runAgent` entry. Existing filtering, `toOpenAiTools`, and `executeTool` remain the execution path. The snapshot summary is attached to the Session audit.
- `src/tools/tools.js`: accepts an optional config snapshot for schema annotation and uses `ctx.runSnapshot.config` for scheduler/multimodal settings; old call signatures still work.

No changes were made to `src/tools/tools-core.js`, prompt construction, Sender/Outbox, lease/ack, lifecycle commit, send queue, config defaults, role files, or multimodal result semantics.

## Schema and Order Diff

Runtime comparison used the real `buildToolDefs()` output from `src/tools/tools-core.js` and the Registry's Legacy Adapter output:

- Tool count: `23` before, `23` after.
- Name/order equality: `true` for all 23 positions.
- OpenAI schema equality (`name`, `description`, `parameters`): exact deep equality.
- Legacy ownership: all 23 tools have `ownerPluginId = legacy-tools`.
- Scheduler classification is unchanged because scheduler classification still runs by existing tool name in `experimental-tool-scheduler.js`. `finish` remains terminal only there; the P1 registry does not add a second terminal execution path.

The verified order is:

```text
send_message, send_sticker, list_stickers, get_sticker_image,
sticker_note, collect_sticker, send_face, schedule_wake, send_poke,
get_recent_messages, read_forward, get_active_members, get_message_detail,
get_message_images, memory_append, memory_query, person_memory_lookup,
friend_request_propose, memory_remove, report_feedback, web_search,
web_fetch, finish
```

## Test Commands and Exit Codes

All commands used the explicit bundled Node `v24.19.0` runtime. Logs are in `docs/verification/p0-20260924/`.

| Command | Exit | Status | Result |
|---|---:|---|---|
| `node --test test/plugin-registry.test.mjs` | 0 | PASS | 4/4 |
| `node --test test/orchestrator.test.mjs` | 0 | PASS | 30/30; standalone rerun after one combined-run timing failure |
| `node --test test/tools.test.mjs` | 0 | PASS | 5/5 |
| `node --test test/tool-scheduler-wrapper.test.mjs test/experimental-tool-scheduler.test.mjs` | 0 | PASS | 13/13 |
| `node --test test/experimental-multimodal-context-install.test.mjs test/experimental-multimodal-context.test.mjs` | 0 | PASS | 11/11 |
| `node test/test-prompt.mjs` | 0 | PASS | Prompt self-test passed |
| `node test/local/run.mjs` | 0 | PASS | 9/9 |
| `node --test test/*.test.mjs` | 1 | FAIL (baseline carry-forward) | 393 tests: 344 pass, 46 fail, 3 skipped |

The 46 full-suite failures match the P0 failure classes: updater/network tests, Linux shell/systemd deployment tests on Windows, Windows temp-directory cleanup `EPERM`, and pre-existing behavior/fixture mismatches. The new P1 tests pass and no new failure group appears. Full output is in [test-unit-p1-node24.log](p0-20260924/test-unit-p1-node24.log).

The combined P1-focused command once had the existing debounce timing test fail at `elapsed=345ms`; the same `orchestrator.test.mjs` command was rerun standalone and passed 30/30. This is recorded as a timing-flake observation, not suppressed.

Static checks:

```text
node --check src/plugins/contract.js                 exit 0
node --check src/plugins/registry.js                 exit 0
node --check src/plugins/context.js                  exit 0
node --check src/plugins/manager.js                  exit 0
node --check src/plugins/builtin/legacy-tools.js     exit 0
node --check src/tools/tools.js                      exit 0
node --check src/core/orchestrator.js                exit 0
git diff --check                                      exit 0
```

## Acceptance Decision

- Registry/contract/manager/context skeleton: PASS.
- Legacy Adapter and exact 23-tool schema/order compatibility: PASS.
- Same run uses one snapshot for tool filtering, schema annotation, and scheduler/multimodal config: PASS by implementation and focused Orchestrator/tool tests.
- Duplicate owner/name, illegal schema, reserved tool, and terminal-authority rejection: PASS.
- Existing Sender/Outbox, unknown delivery, three conversation modes, and multimodal focused regressions: PASS in the listed focused tests.
- Full suite: FAIL due to P0 carry-forward failures; no P1-specific failures identified.

P1 merge gate: **CONDITIONALLY SATISFIED for P1-scoped changes**, with the P0 full-suite failures carried forward and not reclassified as P1 regressions. Do not enter P2 until the integrator accepts this baseline carry-forward and reviews the Registry snapshot/owner contract.

