# Learned Self LSR1 Verification

Date: 2026-10-11 (Asia/Hong_Kong)  
Scope: non-destructive Learned Self profile audit, quarantine reset, CAS
rollback, and the explicit dry-run/apply CLI.

## Commands

| Command | Exit code | Result |
| --- | ---: | --- |
| `E:\node22\node.exe --test test\learned-self-profile-cleanup.test.mjs` | 0 | PASS |
| `E:\node22\node.exe --test test\self-evolution-reflection.test.mjs test\self-evolution-reflection-lifecycle.test.mjs test\self-evolution-account.test.mjs test\self-evolution-console-account-e2e.test.mjs test\self-evolution-learned-self-e2e.test.mjs test\p7-console-observability.test.mjs` | 0 | PASS |
| `E:\node22\node.exe --check src\plugins\self-evolution\reflection-store.js` | 0 | PASS |
| `E:\node22\node.exe --check scripts\learned-self-profile.mjs` | 0 | PASS |

The focused suite covers 3 tests. The existing self-evolution/console
regression command covers 40 tests. SQLite databases are created under a
temporary test directory and removed by the test hook.

The polluted LSR1 fixture is seeded directly into an isolated temporary
SQLite database because LSR3 now correctly rejects creation of procedural
traits through reflection APIs. No production database is seeded or opened.

## Actual Assembly Evidence

- `ReflectionStore.auditProfile()` reads the existing
  `learned_self_versions` chain and reports bucket scope, chat key, evidence
  references, and the contiguous source revision without writing.
- `previewProfileReset()` performs a head CAS check and returns a
  `quarantine_all` diff without creating a revision.
- `resetProfile()` appends an empty profile revision only after
  `confirm === true`, typed revision validation, actor/reason validation, and
  an in-transaction head CAS check.
- `rollbackProfile()` remains append-only and was exercised after reset:
  revision `1 -> 2` reset, then `2 -> 3` rollback.
- Existing versions, proposals, jobs, observations, and Notebook data remain
  untouched by reset. A stale second connection receives
  `REFLECTION_CAS_CONFLICT`.
- `scripts/learned-self-profile.mjs` opens an existing database explicitly,
  uses read-only mode for audit/dry-run, requires `--apply --confirm` for
  writes, redacts account/chat/evidence identifiers and profile values, and
  refuses missing database paths without creating files.

## Status

- LSR1: PASS
- Production SQLite migration: NOT_RUN
- Production profile reset: NOT_RUN
- Production deployment: NOT_RUN
- Real model / QQ behavior validation: LIVE_NOT_RUN

## Rollback

No destructive migration was run. To reverse a test reset, use the existing
profile revision as the rollback target with the current head revision and
Base Persona hash. Production rollback remains operator-authorized and was not
attempted.
