# Learned Self LSR2 Verification

Date: 2026-10-11 (Asia/Hong_Kong)  
Scope: structured user/assistant evidence normalization, independent-session
thresholds, and cross-chat scope gating.

## Commands

| Command | Exit code | Result |
| --- | ---: | --- |
| `E:\node22\node.exe --test test\learned-self-evidence-gate.test.mjs` | 0 | PASS |
| `E:\node22\node.exe --test test\self-evolution-reflection.test.mjs test\self-evolution-reflection-lifecycle.test.mjs test\self-evolution-learned-self-e2e.test.mjs test\p7-console-observability.test.mjs` | 0 | PASS |

The focused LSR2 suite covers 4 tests. Structured evidence uses explicit
`evidenceVersion >= 3` or explicit evidence-role fields. Legacy events without
that schema remain readable and are not misclassified as assistant-only during
migration.

## Actual Assembly Evidence

- Completion evidence now preserves `userEvidence`, `assistantContext`,
  `delivered`, `userConfirmed`, `structuredEvidence`, and bounded preference
  evidence separately.
- Assistant-only proactive and pure explicit-silence windows are audited with
  `REFLECTION_EVIDENCE_GATE` and do not create reflection jobs.
- Structured behavior-trait jobs require three independent valid sessions and
  two distinct user evidence references by default.
- Explicit observation windows can aggregate multiple chat scopes; global trait
  proposals require evidence from at least two chats.
- Host-side `validateReflectionOutput` and enqueue-time gating both enforce the
  contract. The model prompt is supplemental only.

## Status

- LSR2: PASS
- Legacy evidence migration path: PASS (covered by existing regression tests)
- Production replay: NOT_RUN
- Real model / QQ behavior validation: LIVE_NOT_RUN

## Rollback

No production state was changed. The gate is host-side and reversible by code
rollback; no production database migration was introduced.
