# Learned Self LSR3 Verification

Date: 2026-10-11 (Asia/Hong_Kong)  
Scope: procedural/script trait rejection, execution-state separation, and
bounded-auto human review.

## Commands

| Command | Exit code | Result |
| --- | ---: | --- |
| `E:\node22\node.exe --test test\learned-self-policy.test.mjs` | 0 | PASS |
| `E:\node22\node.exe --test test\self-evolution-reflection.test.mjs test\self-evolution-reflection-lifecycle.test.mjs test\self-evolution-learned-self-e2e.test.mjs test\p7-console-observability.test.mjs` | 0 | PASS |

## Actual Assembly Evidence

- `working_habit` is no longer in the low-risk automatic trait set.
- Host-side validation rejects `result=120`, retry/queue/schedule/wake,
  delivery/status/message-id patterns, and fixed-script values before proposal
  persistence.
- `executionState` and `preferenceEvidence` are separate reflection inputs;
  execution diagnostics remain available for capability-gap reasoning but do not
  qualify as preference evidence.
- `bounded_auto` still applies permitted Notebook operations, but behavior
  traits remain `pending` and emit
  `REFLECTION_BEHAVIOR_REVIEW_REQUIRED`. Human approval uses the existing CAS
  review path.
- Existing tests that intentionally exercise the old auto-apply contract opt
  into `autoApplyBehaviorTraits: true` in their isolated fixtures only; the
  production default is false.

## Status

- LSR3: PASS
- Procedural/production profile replay: NOT_RUN
- Real model behavior validation: LIVE_NOT_RUN

## Rollback

No production data or deployment was touched. Pending proposals remain
reviewable/rejectable, and the existing profile rollback path is unchanged.
