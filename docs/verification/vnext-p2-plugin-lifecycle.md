# vNext P2 Plugin Lifecycle Verification

- Verification date: 2026-09-25 (Asia/Hong_Kong)
- Repository: `E:\Code\qq-agent-plus`
- Baseline: `ce1d040a0b6774b1be2ca7e832867d2735f37136`
- Runtime: `E:\node22\node.exe` (`v22.22.2`)
- Scope: P2 lifecycle, Tool/ContextProvider/SessionObserver extension points, real isolated `createApp().start()/stop()`, completion-event persistence and delivery, built-in tool ownership migration, narrow plugin tool-callback context, and focused regression.
- Explicitly out of scope: P3 `stay_silent`, Notebook, retrieval, Reflection, later UI/release work.

## Changes Verified

- `src/plugins/manager.js`: config-based enablement including explicit `startAll({ config })`, atomic multi-plugin startup rollback with disable/invalidate/drain before prepared stop callbacks, generation invalidation, snapshot abort, tracked timer resources, provider timeout/abort diagnostics, bounded provider/observer drain, per-observer timeout with retryable event failure, observer generation checks, bounded plugin cleanup, and hard-disable behavior.
- `src/console/app.js`: abort orchestrator runs before releasing plugin resources during shutdown.
- `src/plugins/context.js`: `createToolCallbackContext()` now preserves raw host context only for `legacy-tools`; ownerless and other-owner definitions receive restricted generic contexts. Generic plugins receive only the frozen safe base and redacted config; messaging, memory-tools, and runtime-control receive only the facade methods their existing core executors use. Config snapshots redact authorization/auth headers, bearer values, client secrets, cookies, URI credentials, and common token shapes.
- `src/tools/tools.js`: lifecycle/generation checks still use the raw host context, but every `coreExecuteTool` call, including the `ExperimentalToolBatch` prestart closure, now receives `createToolCallbackContext(def, hostCtx)`. The exported compatibility `buildToolDefs()` wrapper marks core definitions as `legacy-tools` so direct legacy callers retain raw host context. Multimodal recording and session audit updates continue to use the raw host session.
- `test/plugin-lifecycle.test.mjs`: explicit startup-config enablement and preservation of `setEnabled` overrides, atomic multi-plugin startup rollback and preservation of already-running plugins, stop-callback snapshot assertions, provider timeout, stop ordering/timer cleanup, hard-disable late-result rejection, transactional events, observer delivery, hung-observer timeout/retryability, bounded `stopAll`, and composition probes.
- `test/plugin-tool-context.test.mjs`: generic and ownerless callback probes (no `onebot`, `store`, `sender`, `memory`, `stickers`, `identityPilot`, `runSnapshot`, raw `session`, or API secret), legacy wrapper compatibility, scheduler prestart isolation, config-redaction assertions, and chat/run/signal-bound messaging, memory, identity, and runtime-control facades.
- `test/plugin-app-start.test.mjs`: real `createApp().start()/stop()` probe using a temporary data directory, loopback console port, OneBot port 1, observe mode, and disabled unrelated schedulers; verifies Tool/ContextProvider/SessionObserver registration, narrow plugin services, context collection, signal abort, timer cleanup, and observer worker cleanup without external sends.
- `docs/verification/p2-20260925/`: raw command output and exit-code evidence.

## Commands And Results

All commands below were run from `E:\Code\qq-agent-plus`.

| Command | Exit | Status | Result / evidence |
|---|---:|---|---|
| `E:\node22\node.exe --test test\plugin-tool-context.test.mjs test\plugin-lifecycle.test.mjs test\plugin-registry.test.mjs test\plugin-app-start.test.mjs` | 0 | PASS | 28/28; final ownerless/redaction/rollback/hung-observer boundary fixes plus registry and real app startup; [22-final-boundary-context-lifecycle-registry-app-node22.log](p2-20260925/22-final-boundary-context-lifecycle-registry-app-node22.log) |
| `E:\node22\node.exe --test test\tools.test.mjs test\tool-scheduler-wrapper.test.mjs test\experimental-tool-scheduler.test.mjs` | 0 | PASS | 18/18; final tool-wrapper and scheduler regression; [23-final-boundary-tools-scheduler-node22.log](p2-20260925/23-final-boundary-tools-scheduler-node22.log) |
| `E:\node22\node.exe --test test\orchestrator.test.mjs test\store.test.mjs` | 0 | PASS | 45/45; final orchestration and persistence regression; [24-final-boundary-orchestrator-store-node22.log](p2-20260925/24-final-boundary-orchestrator-store-node22.log) |
| Node 22 syntax checks for changed files plus `git diff --check` | 0 | PASS | Final boundary static checks; [25-final-boundary-static-checks.log](p2-20260925/25-final-boundary-static-checks.log) |
| `E:\node22\node.exe --test test\plugin-app-start.test.mjs` | 0 | PASS | 1/1; isolated real app startup/shutdown probe, no external OneBot/LLM send; [15-real-app-start-probe-node22.log](p2-20260925/15-real-app-start-probe-node22.log) |
| `E:\node22\node.exe --test test\plugin-app-start.test.mjs test\plugin-lifecycle.test.mjs test\plugin-registry.test.mjs` | 0 | PASS | 18/18; [16-app-start-lifecycle-registry-node22.log](p2-20260925/16-app-start-lifecycle-registry-node22.log) |
| `E:\node22\node.exe --test test\plugin-app-start.test.mjs test\orchestrator.test.mjs test\store.test.mjs` | 0 | PASS | 46/46; [17-app-start-focused-node22.log](p2-20260925/17-app-start-focused-node22.log) |
| `E:\node22\node.exe --test test\plugin-lifecycle.test.mjs test\plugin-registry.test.mjs` | 0 | PASS | 16/16; [12-atomic-start-rollback-node22.log](p2-20260925/12-atomic-start-rollback-node22.log) |
| `E:\node22\node.exe --test test\plugin-lifecycle.test.mjs test\plugin-registry.test.mjs` | 0 | PASS | 17/17 including explicit per-call config; [14-explicit-start-config-node22.log](p2-20260925/14-explicit-start-config-node22.log) |
| `E:\node22\node.exe --test test\plugin-tool-context.test.mjs test\plugin-lifecycle.test.mjs test\plugin-registry.test.mjs` | 0 | PASS | 23/23; callback isolation, facade binding, lifecycle, and registry; [18-plugin-tool-context-lifecycle-registry-node22.log](p2-20260925/18-plugin-tool-context-lifecycle-registry-node22.log) |
| `E:\node22\node.exe --test test\tools.test.mjs test\tool-scheduler-wrapper.test.mjs test\experimental-tool-scheduler.test.mjs` | 0 | PASS | 18/18; tool execution and scheduler behavior; [19-tools-scheduler-node22.log](p2-20260925/19-tools-scheduler-node22.log) |
| `E:\node22\node.exe --test test\orchestrator.test.mjs test\store.test.mjs` | 0 | PASS | 45/45; real orchestration and store integration; [20-orchestrator-store-node22.log](p2-20260925/20-orchestrator-store-node22.log) |
| Independent two-plugin repro using `E:\node22\node.exe --input-type=module` | 0 | PASS | `error=boom`, empty status/registry/runtime, generations `2/2`, stops `second,first`; [13-independent-repro-fixed-node22.log](p2-20260925/13-independent-repro-fixed-node22.log) |
| `E:\node22\node.exe --test test\orchestrator.test.mjs` | 0 | PASS | 30/30; [02-orchestrator-node22.log](p2-20260925/02-orchestrator-node22.log) |
| `E:\node22\node.exe --test test\tools.test.mjs test\tool-scheduler-wrapper.test.mjs test\experimental-tool-scheduler.test.mjs` | 0 | PASS | 18/18; [03-tools-scheduler-node22.log](p2-20260925/03-tools-scheduler-node22.log) |
| `E:\node22\node.exe --test test\store.test.mjs test\time-control-integration.test.mjs test\run-budget-gate.test.mjs` | 0 | PASS | 29/29; [04-store-recovery-node22.log](p2-20260925/04-store-recovery-node22.log) |
| `E:\node22\node.exe test\local\run.mjs` | 0 | PASS | 9/9 local regression groups; [05-local-run-node22.log](p2-20260925/05-local-run-node22.log) |
| `foreach ($file in @('src\plugins\manager.js','src\plugins\context.js','src\plugins\contract.js','src\plugins\builtin\runtime-control.js','src\plugins\builtin\messaging.js','src\plugins\builtin\memory-tools.js','src\plugins\builtin\legacy-tools.js','src\core\orchestrator.js','src\core\store.js','src\tools\tools.js','src\console\app.js','test\plugin-lifecycle.test.mjs','test\plugin-app-start.test.mjs')) { & E:\node22\node.exe --check $file }; git diff --check` | 0 | PASS | Syntax and whitespace checks; [07-static-checks.log](p2-20260925/07-static-checks.log) |
| `E:\node22\node.exe --check` for changed callback/context files plus `git diff --check` | 0 | PASS | Syntax and whitespace checks for the security-fix diff; [21-security-static-checks.log](p2-20260925/21-security-static-checks.log) |
| Default `Orchestrator` composition inventory script using `E:\node22\node.exe` | 0 | PASS | 23/23 names and schemas, zero duplicate owners, migrated owners 2+4+4, Legacy 13; [08-default-composition-tool-compat.log](p2-20260925/08-default-composition-tool-compat.log) |
| `E:\node22\node.exe --test test\delivery-integration.test.mjs` | 1 | FAIL (environment) | 3/6 pass; three Windows `EBUSY` SQLite temp cleanup hook failures; [27-final-delivery-integration-node22.log](p2-20260925/27-final-delivery-integration-node22.log) |
| `E:\node22\node.exe --test test\*.test.mjs` | 1 | FAIL (baseline carry-forward) | 553 tests: 504 pass, 46 fail, 3 skipped. Failures remain the existing updater/network, Linux `/bin/bash`/systemd, Windows SQLite cleanup groups, and two Linux-integration assertions on Windows; [26-final-full-unit-node22.log](p2-20260925/26-final-full-unit-node22.log) |

The final boundary focused aggregate (28+18+45 = 91 tests) passed with exit 0; evidence is [22-final-boundary-context-lifecycle-registry-app-node22.log](p2-20260925/22-final-boundary-context-lifecycle-registry-app-node22.log), [23-final-boundary-tools-scheduler-node22.log](p2-20260925/23-final-boundary-tools-scheduler-node22.log), and [24-final-boundary-orchestrator-store-node22.log](p2-20260925/24-final-boundary-orchestrator-store-node22.log).

## Contract Matrix

| Contract item | Status | Evidence |
|---|---|---|
| Trusted built-in JS only; no dynamic install, marketplace, or sandbox | PASS | Registry composition and scoped source review; no P2 code adds an install/eval path. |
| Disabled plugins create no own DB, timer, model request, or context injection | PASS | `disabled plugin has no start, context, timer, or tool side effects`; 16-test lifecycle log. |
| Start failure rolls back registration/runtime state atomically | PASS | Multi-plugin rollback test now asserts stop callbacks see rolled-back plugins disabled/excluded with `isActive` false; independent repro shows empty registry/status/runtime, generation invalidation, and stop order; final boundary lifecycle log plus repro log. |
| `startAll({ config })` evaluates `isEnabled` with that explicit config, unless overridden by `setEnabled` | PASS | Explicit-config startup regression; 17-test lifecycle/registry log. |
| Stop order rejects new work, invalidates generation, aborts snapshots, clears timers, boundedly drains, and releases | PASS by focused test and implementation | Stop-order/timer test; manager bounded drain and cleanup paths. |
| Provider timeout/error degrades with diagnostics and shared budget | PASS | Provider failure and timeout tests; 16-test lifecycle log. |
| Completion events are transactionally enqueued in existing ack/complete/lifecycle paths | PASS by store/orchestrator tests and source inspection | Store 15/15, orchestrator 30/30, lifecycle event transaction test. |
| Observer delivery is at-least-once and idempotent; delivered events are not replayed | PASS | Observer delivery test and store claim/retry tests. |
| Hung observer delivery is bounded, retryable, and cannot block `stopAll` | PASS | `hung observers time out as retryable failures and do not block stopAll`: explicit drain with a never-resolving observer returns within bound, failed event is reclaimable, a later event is delivered, and `stopAll` returns with a bounded timeout; [22-final-boundary-context-lifecycle-registry-app-node22.log](p2-20260925/22-final-boundary-context-lifecycle-registry-app-node22.log). |
| Hard disable rejects late old-run side effects | PASS | `hard disable rejects a late tool result...`; 17-test lifecycle log. |
| Generic and ownerless plugin tools cannot receive raw OneBot, ChatStore, sender, memory, stickers, identity, session, run snapshot, or API secret | PASS | `generic plugin tool callbacks receive only the safe base context` and `ownerless tool definitions receive the restricted generic context`; final boundary callback log. |
| Trusted built-in facades require both the owner id and a known built-in tool name | PASS | `trusted owner facades require both owner id and built-in tool name`; 23-test callback/lifecycle log. |
| Trusted built-in facades remain functional and bind current chat/run/signal | PASS | Messaging, memory/identity, and runtime-control facade tests; 23-test callback/lifecycle log. |
| Scheduler prestart uses the restricted callback context | PASS | `ExperimentalToolBatch prestart uses the restricted tool callback context`; 23-test callback/lifecycle log. |
| Legacy raw execution remains available only through explicit compatibility | PASS | `legacy owner still receives the raw host context` and `legacy buildToolDefs wrapper marks core definitions for raw compatibility`; final boundary callback log. |
| Config snapshots redact auth headers, cookies, URI credentials, and token-shaped values while preserving normal config | PASS | `snapshotPluginConfig redacts auth material and token-shaped values`; final boundary callback log. |
| No replay of already-acked QQ input | PASS by existing lease/ack/recovery coverage | Store/recovery 29/29 and orchestrator 30/30. |
| runtime-control, messaging, and memory-tools have one owner; Legacy retains remaining tools and old order/schema | PASS | Default composition inventory: 23/23 names and schemas; owner counts 2+4+4+13. |
| Real production `createApp().start()` with a probe plugin | PASS (isolated) | `plugin-app-start.test.mjs` starts the real app against a temporary data directory, loopback console port, and `127.0.0.1:1` OneBot endpoints; validates plugin runtime/status, context collection, abort, timer cleanup, and observer timer cleanup without external OneBot/LLM sends. |

## Acceptance Status

**P2 ACCEPTED WITH ENVIRONMENT GAPS CARRIED FORWARD**

The final boundary fixes, frozen tool-callback security boundary, focused lifecycle/registry, tools/scheduler, orchestrator/store suites, and isolated real-app composition probe all pass. P2 is accepted within its scoped contract. The following environment gaps are carried forward and are not classified as P2 regressions:

1. The final full-unit rerun completed with 504 passed, 46 known environment/baseline failures, and 3 skipped tests on this Windows host.
2. The final standalone delivery integration rerun has the same three Windows SQLite `EBUSY` cleanup failures.

No P2-specific failure was found. The remaining failures are retained as carry-forward verification gaps for the Windows/Linux test environment.

The final-boundary evidence is limited to P2 callback ownership, startup rollback ordering, observer delivery bounds, and config redaction. Raw `tools-core.js`, orchestrator host construction, Sender/Outbox/lease/ack, P3 behavior, and the public module architecture were not changed. No commit was created.

## Rollback

The candidate remains uncommitted. The final boundary workstream added `test/plugin-tool-context.test.mjs` and changed `src/plugins/manager.js`, `src/plugins/context.js`, `src/tools/tools.js`, `test/plugin-lifecycle.test.mjs`, and `test/orchestrator.test.mjs`; the report and evidence were updated alongside them. Earlier P2 candidate changes also include `src/console/app.js` and `test/plugin-app-start.test.mjs`. It did not modify `src/tools/tools-core.js` or the orchestrator host-context construction.

Rollback must be selective because the worktree also contains earlier P2 candidate changes. Do not run a broad checkout. To remove only the new callback-context test:

```powershell
Remove-Item -Force test/plugin-tool-context.test.mjs
```

The related report/evidence can be removed separately if the coordinator rejects the whole P2 verification candidate:

```powershell
Remove-Item -Recurse -Force docs/verification/p2-20260925
Remove-Item -Force docs/verification/vnext-p2-plugin-lifecycle.md
```

Rollback does not touch P0/P1 files, user data, credentials, deployment state, or databases.
