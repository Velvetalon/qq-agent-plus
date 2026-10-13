# Social Engine GitHub WIP Handoff

Date: 2026-10-14, Asia/Hong_Kong.
User request: record current progress under delay and commit/push all unfinished
project code to the user's GitHub repository.
Target: `origin/main`, `Velvetalon/qq-agent-plus`.
Previous HEAD: `8233c83c5839a4e8fcc563302769d3569898332a`.

This is an unfinished-work checkpoint, not a release or deployment approval.
Implementation is frozen for this save operation. The snapshot commit contains
all current tracked changes and new project source/tests/plans/docs, including
unfinished code. Production credentials, databases, raw chat records, local logs
and the preexisting private operations memo `NEED_HELP.md` are not included.
No test failure was hidden, skipped or relaxed to make this snapshot green.

The checkpoint commit can be identified by:

```text
git log -1 --format="%H %s"
```

## Development Status

| Stage | Status | Completed / Remaining |
| --- | --- | --- |
| SC0 | PASS | WIP audit, baseline, frozen contract and writer ownership |
| SC1-SC3 | PARTIAL | v3 producer/queue, causal interactions, reply/share/image handoff, guarded delivery, due ticker and sourced intents implemented; configured/shared-interest ingress and complete case coverage remain |
| SC4-SC5 | PARTIAL | scoped Notebook policy, episode/candidate separation, independent evidence, review/CAS, subject isolation, material revocation and cleanup adapter implemented; full acceptance remains |
| SC6 | LOCAL_PASS | protected management, disabled history/lazy reads, old-store restart/fallback and desktop/mobile UI checks pass |
| SC7 | INCOMPLETE / FULL_UNIT_FAIL | focused integration passes, but full unit suite is not green and behavior/coverage acceptance is not complete |
| SC8 | NOT_AUTHORIZED | no production deployment, reset, cleanup, unmute or live-mode change |

Implemented repairs include preserving v3 facts through the durable queue;
retaining Learned Self material keys/expiry through provider assembly; guarding
all injected material instead of truncating after eight refs; rejecting wrong
caller CAS without poisoning a valid candidate; bounding historical evidence
without blocking new episodes; and reusing fresh exact-claim candidate cycles.
External snapshots remain immutable, TTL is not renewed by duplicates, and
unresolved intent source evidence survives retention.

## Verification Results

| Verification | Result |
| --- | --- |
| Explicit 34-file combined regression | exit 0, 248 PASS, 0 FAIL, 0 SKIP |
| Independent runtime/memory review | exit 0, 35 PASS, no P1/P2 finding in bounded scope |
| UI render | exit 0, 138 PASS |
| UI scroll | exit 0, 19 PASS |
| Prompt self-test | exit 0 |
| Chromium candidate UI, desktop/mobile | no page overflow or script errors; mobile review controls reachable |
| Full top-level unit suite, 108 files | exit 1, 708 tests: 660 PASS, 45 FAIL, 3 SKIP |
| Complete `npm test` composite | NOT_RUN after the failed full unit stage |
| Real-model naturalness/cost/latency and QQ behavior | LIVE_NOT_RUN |

The 248-pass focused result is not a statement that all development or all tests
are complete. The final full-unit run used synthetic temporary data on Windows,
Node 22.22.2, and `--test-concurrency=1`.

## Open Full-Unit Failures

Counts below sum to the observed 45 failures. Symptoms are recorded without
claiming every failure is environmental or predates this work.

| Test File | Failures | Observed Symptom |
| --- | ---: | --- |
| `test/auto-update-runner.test.mjs` | 5 | temporary Git repository / updater process-exit assertions |
| `test/deploy-all-preflight.test.mjs` | 24 | `/bin/bash` unavailable on Windows |
| `test/deployment-scripts.test.mjs` | 2 | Linux configuration/runtime launcher assertions |
| `test/identity-pilot-nodiff.test.mjs` | 1 | subprocess suite failure |
| `test/identity-store.test.mjs` | 8 | SQLite EBUSY cleanup and file-permission assertions |
| `test/incident-pilot.test.mjs` | 1 | disabled existing pilot behavior assertion |
| `test/linux-integration.test.mjs` | 2 | permission and SIGTERM/clean-exit assertions |
| `test/prompt-safety.test.mjs` | 2 | Notebook capability/safety wording assertions |

No fixes for these 45 failures were started after the latest save/push
instruction. Baseline comparisons and individual root-cause decisions remain.
GitHub's Linux CI may have a different failure set; no green CI is claimed.

## Next Work

1. Reconcile this commit with any later changes and read the frozen contract.
2. Reproduce each open failure on its supported platform. Close actual handles
   for EBUSY; do not skip cleanup/safety assertions or classify all failures as
   platform-only. Preserve real Linux deployment checks.
3. Resolve Notebook prompt assertions against the approved semantics while
   retaining identity, permission and untrusted-material safety boundaries.
4. Implement explicit configured/shared-interest ingress from the archived
   design, without new unapproved exploration, services or spending.
5. Map every remaining A-E/A-S/A-P/A-R/A-I/A-D/A-M/A-L/A-C/A-H hard case to
   executable evidence. Finish local combined paths and synthetic replay.
6. Rerun full unit and composite checks, then obtain independent review.
   Live-model/QQ verification and SC8 need separate authorization.

## Evidence And Ownership

- Contract: `plan_doc/2026-10-13-social-takeover-contract-v1.md`.
- Design/development/acceptance: the three 2026-10-13 social documents in
  `plan_doc`.
- Detailed evidence: `docs/verification/social-engine-closure.md`.
- Original resumed progress: `delay/schedule/2026-10-13-social-engine-resumed.md`.
- Changed source/test/UI/cleanup-script candidate digest, 42 files:
  `ce0965c14b6ca530e2eb02c4d890f93a51287f1d44c5188ba136aea7822e4ae8`.
- Both former implementation writers are interrupted; the independent reviewer
  completed read-only. There is no other active repository writer.
- Canonical local checkpoint remains active/incomplete. Its lease is released
  after the save operation so another coordinator can resume safely.
- Raw logs/screenshots stay outside Git in the current chat's local `work`
  directory. No production operation was performed in this continuation.
