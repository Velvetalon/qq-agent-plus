# vNext P3 Active Silence Verification

- Verification date: 2026-09-25 (Asia/Hong_Kong)
- Repository worktree: `E:\Code\qq-agent-plus-p3-review`
- Branch: `p3-active-silence-review`
- Baseline commit: `6930f5a26ab3bd8302ef73875ea95f1b4dedf8c2`
- Runtime: `E:\node22\node.exe` (`v22.22.2`)
- Scope: P3 `stay_silent`, host-owned termination, batch preflight, participation/termination/outbound audit summaries, prompt-policy consolidation, and focused regression.
- Explicitly out of scope: P4 Notebook, P5 retrieval, P6 Reflection, P7 console presentation, P8 release work, Trigger Policy, Sender/Outbox/lease/ack semantics, and admin role text.

## Changes Verified

- `src/core/action-control.js`: strict `stay_silent` validation for the frozen `reasonCode` and `threadDisposition` enums and 240-character reason limit; terminal classification for `finish` and `stay_silent`; batch preflight; outbound-effect summaries; and host-only explicit-silence commit.
- `src/core/orchestrator.js`: complete tool-call results are preserved for invalid, trailing, failed-terminal, and uncertain-delivery batches without executing rejected side effects. A runtime unknown/held barrier stops all later calls in the assistant batch before the run is held for operator review.
- `src/plugins/builtin/runtime-control-tools.js`, `src/plugins/builtin/runtime-control.js`, `src/plugins/context.js`, `src/plugins/contract.js`, and `src/plugins/builtin/legacy-tools.js`: `stay_silent` registration, runtime-control ownership, pending-request context, and reserved-name enforcement.
- `src/pilots/experimental-tool-scheduler.js`: `stay_silent` is classified as terminal for both scheduler-enabled and scheduler-disabled paths; host preflight remains authoritative.
- `src/core/sessions.js`, `src/core/store.js`, `src/console/app.js`, and `src/plugins/manager.js`: participation, termination, and outbound summaries are persisted, included in session summaries/completion events, and carried on SSE/session-end payloads. `ChatStore.listRunEffects()` and `listHeldEffects()` provide the host summary without changing append/release semantics.
- `src/llm/participation-policy.js` and `src/llm/prompt.js`: one participation-policy source removes the former "must reply / must add a line / keep probing" conflict. Persona `roleText` is treated as immutable input.
- `test/p3-active-silence.test.mjs` and `test/orchestrator.test.mjs`: strict validation, native/inline parity, conflicting-batch preflight, prior-failure barrier, unknown-delivery halt, explicit-silence result class, zero outbound effects, role-text preservation, and scheduler on/off parity.

Review fixes made on top of the checkpoint candidate:

- Invalid terminal batches now reject every call in that batch before side effects, not only the terminal call. This covers duplicate terminals, terminal-not-last, `stay_silent` with external/unknown effects, and an unknown tool before `stay_silent`.
- `friend_request_propose` is treated as an external effect for conflict and explicit-silence accounting; `send_message`, `send_sticker`, `send_face`, and `send_poke` remain covered.
- A prior tool failure blocks `finish` and `stay_silent` with `FINISH_BARRIER_BLOCKED` in both scheduler modes.
- Once an external delivery becomes `sending`, `unknown`, or `held`, later calls in the same assistant batch are recorded as `SKIPPED_AFTER_UNCERTAIN_EFFECT` and are not executed.

## Contract Matrix

| Contract item | Status | Evidence |
|---|---|---|
| `stay_silent` accepts only `not_relevant`, `no_new_value`, `waiting_for_context`, `already_answered`, or `topic_moved` | PASS | Strict-validation and boundary-length tests; `test/p3-active-silence.test.mjs`. |
| `threadDisposition` accepts only `active`, `listening`, or `close`; optional reason is at most 240 characters | PASS | Strict enum/240-boundary tests and schema registration. |
| Tool callback records only a pending request; host owns final termination | PASS | Tool unit test plus `Orchestrator` explicit-silence integration test. |
| At most one terminal call and terminal must be last | PASS | Duplicate and terminal-not-last preflight tests; rejected calls execute zero callbacks. |
| Terminal plus external-visible or unknown same-batch effect is rejected before terminal commit | PASS | Unit and integration tests for send/unknown conflicts, with sender call count zero in both scheduler modes. |
| Calls after a terminal are structured skips with one result per original call | PASS | Preflight result assertions; `SKIPPED_AFTER_TERMINAL`. |
| `notebook_append + stay_silent` is allowed by the frozen contract | PASS | Preflight fixture marks `notebook_append` local-write and keeps both calls executable. P4 implementation is not present or tested here. |
| `send_message + finish` remains compatible | PASS | Preflight unit test keeps both calls executable. |
| Prior success, failure, unknown, or held effects cannot become `explicit_silence` | PASS | Unit coverage for sent/failed/unknown/held; unknown-delivery integration preserves one unknown and skips all later side effects. |
| `send_face`, `send_sticker`, and `send_poke` count as external effects | PASS | Effect classification includes all three; `friend_request_propose` is also retained as an external write. |
| Scheduler enabled/disabled behavior is identical for P3 safety rules | PASS | Conflicting batch, prior-failure terminal, and unknown-delivery tests run in both modes. |
| Native and inline tool calls share the same preflight | PASS | `resolveToolCalls` inline/native parity test. |
| Only `stay_silent` causes zero OneBot sends, accurate ack, and `explicit_silence` result class | PASS | `records explicit silence with zero outbound side effects`; session status remains `noreply` for legacy compatibility. |
| Participation, termination, and outbound summaries persist in the session and index | PASS | `SessionRegistry` fields plus integration assertions; outbound summary uses outbox and held-message state. |
| Participation, termination, and outbound summaries reach completion events and SSE end payloads | PASS by source inspection and integration assertions | `PluginManager.buildCompletionEvents`, orchestrator `session-end`, and console SSE payload include all three summaries. |
| Prompt policy is centralized without mutating admin `roleText` | PASS | `participation-policy.js` is the only participation policy source; prompt test asserts role text is unchanged and appears once. |
| Trigger Policy, lease/ack, Sender/Outbox unknown handling, independent wake, and future-task semantics are preserved | PASS by focused store/orchestrator/scheduler regression | 103-test boundary aggregate passed; no P3 changes to the store claim/ack/fail lifecycle. |
| Real-model evaluation is recorded separately from mock control-flow tests | PASS (boundary respected) | This report contains deterministic mock/control-flow verification only. No real-model or production QQ evaluation was run. |

## Commands And Results

All commands were run from `E:\Code\qq-agent-plus-p3-review` with `E:\node22\node.exe` (`v22.22.2`).

| Command | Exit | Status | Result / evidence |
|---|---:|---|---|
| `E:\node22\node.exe --test test/p3-active-silence.test.mjs test/orchestrator.test.mjs` | 0 | PASS | 43/43; [01-p3-orchestrator-node22.log](p3-20260925/01-p3-orchestrator-node22.log) |
| `E:\node22\node.exe --test test/p3-active-silence.test.mjs test/orchestrator.test.mjs test/tools.test.mjs test/tool-scheduler-wrapper.test.mjs test/experimental-tool-scheduler.test.mjs test/plugin-tool-context.test.mjs test/store.test.mjs test/plugin-lifecycle.test.mjs test/plugin-registry.test.mjs` | 0 | PASS | 103/103; [02-boundary-regression-node22.log](p3-20260925/02-boundary-regression-node22.log) |
| Node 22 syntax checks for all P3-touched files plus `git diff --check` | 0 | PASS | `STATIC_OK`; [03-static-checks.log](p3-20260925/03-static-checks.log) |
| `E:\node22\node.exe --test test/*.test.mjs` | 1 | FAIL (baseline/environment carry-forward) | 566 tests: 517 passed, 46 failed, 3 skipped; no P3 failure. Same 46-failure count as the P2 verification; [04-full-unit-node22.log](p3-20260925/04-full-unit-node22.log) |
| `E:\node22\node.exe test/test-prompt.mjs` | 0 | PASS | Prompt self-test passed; [05-prompt-node22.log](p3-20260925/05-prompt-node22.log) |
| `E:\node22\node.exe test/local/run.mjs` | 0 | PASS | 9/9 local regression groups; [06-local-regression-node22.log](p3-20260925/06-local-regression-node22.log) |

The full-unit failure groups remain the existing Windows updater/network, Linux `/bin/bash` and systemd deployment, Windows SQLite `EBUSY` cleanup, and baseline fixture/behavior failures described by the P2 verification. P3 did not add a failing test group or change the failure count.

## Acceptance Status

**P3 ACCEPTED WITH ENVIRONMENT AND REAL-MODEL GAPS**

The frozen P3 contract is implemented and covered by deterministic control-flow tests under the requested Node 22 runtime. The review found and fixed two pre-side-effect safety gaps in the checkpoint candidate: invalid terminal batches could previously execute preceding sends, and an unknown/held delivery could be followed by later side effects.

Carry-forward gaps:

1. The full unit suite remains red on this Windows host with the same 46 environment/baseline failures recorded by P2.
2. No real-model behavior evaluation was run; mock control-flow and prompt-text tests do not establish real model compliance.
3. No production QQ send or external OneBot action was performed.
4. P4 `notebook_append` is only represented as a preflight fixture; the notebook implementation and persistence acceptance remain P4 work.
5. P7 console presentation of participation/termination/outbound fields remains out of scope. P3 only guarantees durable and SSE-visible data.

## Rollback

The P3 work is committed on `p3-active-silence-review`. Rollback should revert only the P3 commit; do not run a broad checkout because later phase work may share this repository.

```powershell
git revert --no-edit <hash-returned-by-this-verification-commit>
```

Preserve the participation/termination/outbound audit fields and the terminal barrier if only disabling the explicit-silence capability. Do not delete persisted session summaries or weaken preflight, lease/ack, or unknown-delivery handling.
