# vNext P3 Learned Self Revision Verification

- Verification date: 2026-09-26 (Asia/Hong_Kong)
- Worktree: `E:\Code\qq-agent-plus-closure-revision`
- Branch: `closure-reflection-revision`
- Baseline: `3a9e97c`
- Implementation commit: recorded in the delivery summary for this branch.
- Scope: Reflection plugin/worker/store revision correctness only. Orchestrator,
  scheduling thresholds/budgets, console, and UI were not changed.

## Change

Reflection now reads the authoritative `learned_self_heads` revision by account
at job start. `basePersonaHash` remains attached to proposals and is used only
for Base Persona stale invalidation. The plugin default no longer returns
revision `0` when configuration omits `basePersonaHash`.

The regression starts the real reflection plugin and worker over SQLite, runs
two jobs with no configured `basePersonaHash` (`0 -> 1 -> 2`), then performs a
rollback to revision `1` as revision `3` while a third job is in flight. The
third job is rejected by Learned Self CAS, the rollback context is preserved,
the Base Persona remains unchanged, changed Base Persona reads are stale, and
another account remains at revision `0`.

## Verification

| Command | Result |
|---|---|
| `E:\node22\node.exe --test --test-reporter=tap test\self-evolution-reflection.test.mjs` | PASS, 14/14 |
| `E:\node22\node.exe --check src\plugins\self-evolution\reflection-plugin.js` | PASS |
| `E:\node22\node.exe --check src\plugins\self-evolution\reflection-worker.js` | PASS |
| `E:\node22\node.exe --check src\plugins\self-evolution\reflection-store.js` | PASS |
| `E:\node22\node.exe --check test\self-evolution-reflection.test.mjs` | PASS |
| `git diff --check` | PASS |

## Rollback

Revert only the implementation commit identified in the delivery summary, or disable
`selfEvolution.reflection` while preserving the Reflection SQLite database,
jobs, profile versions, heads, and audit rows. Do not delete persisted Learned
Self history.

## NOT_RUN

- Real LLM/model evaluation: NOT_RUN; the regression uses a deterministic
  reflector boundary.
- Production QQ/OneBot evaluation: NOT_RUN.
- Production deployment, migration, and gray release: NOT_RUN.
