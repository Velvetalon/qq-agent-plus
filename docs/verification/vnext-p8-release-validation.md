# vNext P8 Release Validation

- Verification date: 2026-09-25 (Asia/Hong_Kong)
- Worktree: `E:\Code\qq-agent-plus-p8`
- Branch: `p8-release-validation`
- Product HEAD: `9defe36be73eb342765a75034237b9a27bd9ae4c`
- Product commit: `feat(console): add P7 plugin and self-evolution observability`
- Runtime: `E:\node22\node.exe` (`v22.22.2`, x64, SQLite `3.51.2`)
- Host: Microsoft Windows 11 Home Chinese, version `10.0.22631`
- Scope: release validation only. No source, UI, configuration default, production
  data, production service, production QQ/OneBot, or real model credential was changed.

## Release Decision

**NOT APPROVED FOR PRODUCTION ENABLEMENT.**

P2-P7 focused behavior, local UI regressions, fault boundaries, and the temporary
SQLite/WAL restore rehearsal pass. The release gate is still incomplete because the
Linux deployment suite cannot run on this Windows host, the full unit suite retains
46 pre-existing platform/fixture failures, and real-model plus production QQ/OneBot
evaluation were not run. Production self-evolution must remain disabled pending
administrator approval and completion of the gray-release prerequisites below.

P2-P7 have no new failure group: the P8 full-unit failure set is byte-for-byte the
same 46 test names as the P2/P7 carry-forward set. The deployment/integration split
also contains only the known Windows `/bin/bash`, Windows SQLite `EBUSY`, and
Windows signal/file-mode groups.

## Definition Of Done

| Requirement | Status | Evidence / result |
|---|---|---|
| P2 focused registry/lifecycle/composition/context | PASS | 28/28, exit 0; `01-p2-focused.log` |
| P3 focused silence/termination/orchestration/store | PASS | 76/76, exit 0; `02-p3-focused.log` |
| P4 Notebook focused | PASS | 11/11, exit 0; `03-p4-notebook-focused.log` |
| P5 retrieval focused | PASS | 11/11, exit 0; `04-p5-retrieval-focused.log` |
| P6 reflection focused | PASS | 13/13, exit 0; `05-p6-reflection-focused.log` |
| P7 console/UI focused | PASS | 19/19, exit 0; `06-p7-console-focused.log` |
| prompt/local/render/scroll/usage | PASS | Prompt pass; local 9/9; render 138; scroll 19; usage 31; all exit 0 |
| Full Node 22 unit matrix | FAIL (carry-forward) | 608 tests: 559 pass, 46 fail, 3 skip, exit 1; identical to P2/P7 failures |
| Fault injection at real boundaries | PASS / partial FAIL | 63/63 non-delivery boundary tests pass; 3 `delivery-integration` cleanup hooks fail with Windows `EBUSY`; direct Sender boundary check passes |
| Deployment/integration where applicable | FAIL / BLOCKED | Windows host cannot supply `/bin/bash`/systemd/Docker; 31 known platform failures |
| Backup and restore rehearsal in temp | PASS | Real `messages.sqlite`, `-wal`, `-shm` copies restored; `integrity_check=ok`; 2/2 rows intact |
| Compare failures with P2/P7 carry-forward | PASS | 46 P7 names and 46 P8 names; diff entries `0`; no new failure group |
| Git/branch/tree/secret validation | PASS | Branch/HEAD expected; `git diff --check` 0; `git fsck --full` 0; no live secret pattern |
| Real-model evaluation | NOT_RUN | No administrator-approved redacted replay fixture or isolated model credentials; no real LLM contacted |
| Production QQ/OneBot evaluation | NOT_RUN | No production account, group, OneBot endpoint, or send was contacted |
| Gray release | NOT_RUN | Prerequisites and explicit administrator approval are still required |
| Production status | DISABLED | No production enablement, deployment, migration, or data change performed |

## Commands And Exit Codes

All commands used `E:\node22\node.exe --test --test-reporter=tap` unless noted;
`NODE_OPTIONS` was cleared. The complete command index is
[`00-matrix-command-index.txt`](p8-20260925/00-matrix-command-index.txt).

| ID / command | Exit | Result | Evidence |
|---|---:|---|---|
| `npm ci --cache %TEMP%\qq-agent-plus-p8-npm-cache` | 0 | 14 packages, 0 vulnerabilities | `00-npm-ci-node22.log` |
| `node --test test/plugin-tool-context.test.mjs test/plugin-lifecycle.test.mjs test/plugin-registry.test.mjs test/plugin-app-start.test.mjs` | 0 | 28/28 | `01-p2-focused.log` |
| `node --test test/p3-active-silence.test.mjs test/orchestrator.test.mjs test/tools.test.mjs test/tool-scheduler-wrapper.test.mjs test/experimental-tool-scheduler.test.mjs test/store.test.mjs` | 0 | 76/76 | `02-p3-focused.log` |
| `node --test test/self-evolution-notebook.test.mjs` | 0 | 11/11 | `03-p4-notebook-focused.log` |
| `node --test test/retrieval.test.mjs` | 0 | 11/11 | `04-p5-retrieval-focused.log` |
| `node --test test/self-evolution-reflection.test.mjs` | 0 | 13/13 | `05-p6-reflection-focused.log` |
| `node --test test/p7-console-observability.test.mjs test/layout.test.mjs test/memory-page-separation.test.mjs test/session-persona-label.test.mjs` | 0 | 19/19 | `06-p7-console-focused.log` |
| `node test/test-prompt.mjs` | 0 | Prompt self-test passed | `07-prompt.log` |
| `node test/local/run.mjs` | 0 | 9/9 groups | `08-local.log` |
| `node test/render-test.mjs` | 0 | 138 checks | `09-render.log` |
| `node test/scroll-test.mjs` | 0 | 19 checks | `10-scroll.log` |
| `node test/usage-e2e.mjs` | 0 | 31 checks, real local service | `11-usage.log` |
| `node --test test/*.test.mjs` | 1 | 608 tests, 559 pass, 46 fail, 3 skip | `12-full-unit.log`; `18-failure-set-comparison.txt` |
| Combined deployment/integration command | 1 | 43 tests, 12 pass, 31 fail | `13-deployment-integration.log` |
| `node --test test/deployment-scripts.test.mjs` | 1 | 6 pass, 2 fail | `13a-deployment-scripts.log` |
| `node --test test/deploy-all-preflight.test.mjs` | 1 | 0 pass, 24 fail | `13b-deploy-all-preflight.log` |
| `node --test test/deploy-image-mirror.test.mjs` | 0 | 3/3 | `13c-deploy-image-mirror.log` |
| `node --test test/linux-integration.test.mjs` | 1 | 0 pass, 2 fail | `13d-linux-integration.log` |
| `node --test test/delivery-integration.test.mjs` | 1 | 3 pass, 3 cleanup-hook failures | `13e-delivery-integration.log` |
| Combined fault-injection run, including `delivery-integration` | 1 | 66 pass, 3 cleanup-hook failures | `14-fault-injection-boundaries.log` |
| Backup/restore rehearsal script | 0 | SQLite/WAL/SHM restored and readable | `15-backup-restore-rehearsal.log` |
| Direct Sender unknown/definite failure check | 0 | Unknown blocked from retry; definite failure is not held | `16-sender-boundary-check.log` |
| Fault-injection run excluding `delivery-integration` | 0 | 63/63 | `17-fault-injection-excluding-delivery.log` |
| Git/secret validation | 0 | Clean index checks; no live secret pattern | `19-git-secret-validation.log` |

## Fault Injection Coverage

Only external model and OneBot endpoints were replaced. The injected failures run
through the real `PluginManager`, `ChatStore`/`node:sqlite`, `Orchestrator`,
`SendQueue`, `createApp()`, and the real console HTTP routes.

| Failure case | Status | Real boundary and evidence |
|---|---|---|
| Plugin stop/restart and hard disable | PASS | `PluginManager` start/stop/disable, real `createApp()` start/stop, console enable/disable through `PUT /api/plugins/:id`; `01-p2-focused.log`, `06-p7-console-focused.log`, `17-fault-injection-excluding-delivery.log` |
| Provider timeout and cancellation | PASS | `PluginManager.collectContext` timeout aborts the provider signal and degrades without failing app; `provider timeout aborts...`; `17-fault-injection-excluding-delivery.log` |
| Observer retry and replay suppression | PASS | Real `ChatStore` extension-event claim/fail/retry and `PluginManager` observer delivery; hung observer is retryable and does not block `stopAll`; `17-fault-injection-excluding-delivery.log` |
| Notebook CAS conflict | PASS | Two real `NotebookStore` SQLite connections; one update wins, loser gets `NOTEBOOK_CAS_CONFLICT`; P7 HTTP route returns 409; `03-p4-notebook-focused.log`, `06-p7-console-focused.log` |
| Stale embedding response | PASS | Real index metadata validation rejects old revision/content/provider vectors; stale hits are ignored; `04-p5-retrieval-focused.log` |
| Reflection late result | PASS | Real reflection worker lease is stopped; late model result records `status=stopped` and writes no proposal/profile; `05-p6-reflection-focused.log` |
| Terminal barrier and unknown write | PASS | P3 preflight/terminal barriers pass; direct real `ChatStore` + `SendQueue` check records `unknown`, sends once, and blocks automatic retry; `02-p3-focused.log`, `16-sender-boundary-check.log` |
| P7 auth / 413 / 400 / 409 | PASS | Real HTTP app: 401 anonymous/query-token writes, 413 oversized body, 400 malformed/array body, 409 CAS/revision conflicts; `06-p7-console-focused.log` |
| Old session defaults | PASS | Real session file without new fields yields null/unavailable defaults; audit fields remain additive; `06-p7-console-focused.log` |
| Delivery integration cleanup hooks | FAIL (environment) | Three scenarios reach their assertions but Node test marks hooks failed because Windows keeps `messages.sqlite` locked (`EBUSY`); `13e-delivery-integration.log` |

## Failure Comparison

`18-failure-set-comparison.txt` compares the P8 full-unit TAP output with the
`08-failure-set-comparison-node22.txt` carry-forward list from P7/P2.

```text
P2/P7 carry-forward failing tests: 46
P8 full-unit failing tests:        46
Comparison diff entries:            0
Result: IDENTICAL FAILURE SET
```

The 46 names are the known Windows/Linux environment and pre-existing fixture set:
Linux `/bin/bash`, systemd/Docker deployment preflight, Windows SQLite
`EBUSY`/`EPERM` cleanup, Windows signal/file-mode behavior, GitHub TLS stubs, and
existing identity-pilot fixture mismatches. No P8 failure name was added or removed.

## Backup And Rollback Rehearsal

The rehearsal created only temporary data below `%TEMP%`:

```powershell
E:\node22\node.exe docs\verification\p8-20260925\backup-restore-rehearsal.mjs
```

It opened a real `ChatStore`, preserved a WAL-mode database, copied
`messages.sqlite`, `messages.sqlite-wal`, and `messages.sqlite-shm` with filesystem
operations while no writer was active, then opened the copy in a separate temp
directory. Both source and restored databases returned `integrity_check=ok`, and
the two source rows were present in the restored database. The temporary directory
was removed after all connections closed.

The direct Sender check then verified unknown delivery accounting and retry safety:

```powershell
E:\node22\node.exe docs\verification\p8-20260925\sender-boundary-check.mjs
```

Result: one call recorded `outbox.state=unknown`, the next call with the same run
was rejected without a second external call, and a definite `retcode=100` failure
recorded `outbox.state=failed` rather than held-unknown.

No production SQLite/WAL file was copied, replaced, checkpointed, or migrated.
Production backup must use the supported operations path:

```bash
bash manage.sh backup /mnt/data/backups/qq-agent-20260925
```

Restore into an empty service-owned data directory while the service is stopped,
then start in observe mode; do not use `git checkout` as a data recovery mechanism.

## Code Rollback

Latest product commit rollback:

```powershell
git revert --no-edit 9defe36be73eb342765a75034237b9a27bd9ae4c
```

Whole vNext P2-P7 batch rollback on a disposable maintenance branch, without deleting
any SQLite/WAL or Notebook/Reflection data:

```powershell
git switch -c rollback/p8 ce1d040a0b6774b1be2ca7e832867d2735f37136
```

Feature-level rollback:

- Disable `selfEvolution` and `selfEvolution.reflection` in configuration; retain
  Notebook, profile history, jobs, and gap data.
- Hide the Plugin/Self-evolution UI entries if needed; do not delete their stores.
- If migration fails, stop the plugin and preserve the database for audit.

## Blockers And Gray-Release Prerequisites

| Blocker / prerequisite | Required action |
|---|---|
| Linux verification | Run the full Node 22 suite, deployment scripts, systemd/Docker preflight, and integration tests on a Linux runner; this Windows host has no WSL or `/bin/bash`. |
| Full-suite release gate | Classify or resolve the 46 carry-forward failures; do not call the suite green. |
| Delivery cleanup hooks | Rerun `delivery-integration` on Linux or fix the Windows test hook lifecycle; the product assertions pass, but the test result is red on this host. |
| Real-model evaluation | Use an administrator-approved, explicitly redacted replay fixture and isolated test credential; compare legacy/bridge/new policy/selfEvolution. Do not substitute mock control flow. |
| Production QQ/OneBot | Obtain separate administrator approval for a test account/group and observe the defined stop signals. This P8 run contacted neither. |
| Production backup | Run the supported backup/restore procedure against the actual deployment; the P8 rehearsal covers a temporary SQLite copy only. |
| Rollback owner/revision | Record the operator, maintenance branch, prior deploy revision, and backup path before any gray start. |
| Gray order | 1. plugin bridge + silence with `selfEvolution=false`; 2. test-environment Notebook; 3. review-mode reflection; 4. limited-group gray. Never start all four at once. |
| Stop signals | Any unknown external write, plugin start/migration failure, auth failure, sustained CAS conflict, stale reflection application, or unexpected send volume stops the gray and disables the plugin. |
| Admin approval | No production enablement without an explicit administrator decision naming the revision, owner, window, and rollback path. |

## Residual Gaps And Production Status

- No committed P4/P5/P6 phase verification report was found on the product branch;
  their task contracts were read and P8 ran the focused suites directly. This is a
  documentation gap, not a hidden PASS.
- Real model behavior is **NOT_RUN**. Mock/model-stub control flow is not evidence of
  real model compliance.
- Production QQ/OneBot behavior is **NOT_RUN**. No production credential or endpoint
  was used.
- Gray release is **NOT_RUN**. The release remains in test-environment validation.
- Browser-level manual QA, Linux service deployment, production data backup, and
  production migration remain release-time prerequisites.
- Production enablement status: **OFF / NOT APPROVED**.

## Evidence Manifest

Raw logs and reusable verification scripts are under
`docs/verification/p8-20260925/`:

- `00-matrix-command-index.txt`, `00-npm-ci-node22.log`
- `01-p2-focused.log` through `14-fault-injection-boundaries.log`
- `13a-deployment-scripts.log` through `13e-delivery-integration.log`
- `15-backup-restore-rehearsal.log`
- `16-sender-boundary-check.log`
- `17-fault-injection-excluding-delivery.log`
- `18-failure-set-comparison.txt`
- `19-git-secret-validation.log`
- `20-evidence-sha256.txt`
- `run-matrix.ps1`, `backup-restore-rehearsal.mjs`, `sender-boundary-check.mjs`

The verification commit contains only these docs/evidence files; prior product
commits and the P2-P7 source tree are unchanged.
