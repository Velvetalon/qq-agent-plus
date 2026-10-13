# Social Engine Local Verification Checkpoint

Date: 2026-10-14, Asia/Hong_Kong.
Status: FOCUSED_PASS, not full acceptance or deployment approval.
Baseline HEAD: `8233c83c5839a4e8fcc563302769d3569898332a`.
Verification was captured against the uncommitted checkout on that baseline.
The later user-authorized unfinished-code snapshot includes these changes;
see `delay/schedule/2026-10-14-github-wip-handoff.md`.

## Candidate Identity

The sorted JSON list of changed/new `src/`, `test/`, `ui/` paths plus
`scripts/notebook-memory-cleanup.mjs`, each with its full SHA-256, contains
42 files. SHA-256 of that UTF-8 JSON:

`ce0965c14b6ca530e2eb02c4d890f93a51287f1d44c5188ba136aea7822e4ae8`

Documentation and the preexisting `NEED_HELP.md` are excluded from this
candidate digest. The latter was preserved, not applied or modified.

## Verified Behavior

- Real Orchestrator -> durable completion queue -> Manager -> Reflection
  worker retains v3 human provenance and independent interaction roots.
  Three independent supporting interactions create a review candidate;
  adoption remains explicit, scoped and CAS protected.
- Reply/share and the sourced-image path run through actual tools, Manager,
  contexts and Sender. Only the model/OneBot boundaries are synthetic.
  Image pixels reach Replyer without forwarding the Planner transcript.
- Queued Notebook archival, Learned Self correction, target withdrawal and
  mode changes block obsolete writes before creating an outbox intent.
  Unrelated topic updates do not starve a valid reply.
- Material refs retain exact injected trait keys and earliest expiry.
  All injected refs are validated; more than 128 refs fail closed rather
  than silently dropping later refs. Unknown/missing/throwing validators
  cannot authorize delivery.
- External observation snapshots are immutable and duplicate recording
  does not renew TTL. Pending/leased/held intent sources survive retention;
  expiry still makes them unusable. Scope validation is not limited to the
  most recent 32 sources advertised to the Planner.
- Optional historical trait support fits the evidence character budget,
  preserving current evidence first. Twelve consecutive ordinary episodes
  persist without adopting a trait or becoming blocked by pool growth.
- A wrong caller CAS does not poison an otherwise valid candidate. An
  actually obsolete proposal remains stale; fresh exact-claim candidate
  cycles can accumulate again and are still review-only.
- Disabled social history remains readable and cancellable. Never-used
  reads create neither social tables nor Notebook/Reflection databases.
  Synthetic old SQLite/config migration, explicit mode selection, restart
  and threaded fallback preserve persona, runtime restrictions and history.

## Regression Commands

Run from the repository root with Node 22.22.2. This is the exact explicit-file
combined regression, not a wildcard repository test run:

```powershell
$node = 'E:\node22\node.exe'
$tests = @(
  'social-state', 'social-runtime', 'social-memory', 'social-console',
  'social-management-ui', 'social-app-integration', 'social-engine-integration',
  'orchestrator', 'delivery-integration', 'p3-active-silence', 'longtime',
  'plugin-tool-context', 'plugin-registry', 'plugin-lifecycle', 'plugin-app-start',
  'config', 'config-migration', 'store', 'time-control', 'time-control-integration',
  'self-evolution-account', 'self-evolution-notebook', 'self-evolution-reflection',
  'self-evolution-reflection-lifecycle', 'self-evolution-retrieval',
  'self-evolution-retrieval-e2e', 'self-evolution-learned-self-e2e',
  'self-evolution-vector-persona', 'self-evolution-console-account-e2e',
  'learned-self-evidence-gate', 'learned-self-policy', 'learned-self-injection-closure',
  'learned-self-profile-cleanup', 'p7-console-observability'
) | ForEach-Object { "test/$_.test.mjs" }
& $node --test --test-concurrency=1 @tests
```

Result: exit 0, 248 PASS, 0 FAIL, 0 SKIP, 45.376 seconds.
This timing measures synthetic tests, not production latency.

Additional commands/results:

| Command / Check | Result |
| --- | --- |
| `node test/render-test.mjs` | exit 0, 138 PASS |
| `node test/scroll-test.mjs` | exit 0, 19 PASS |
| `node test/test-prompt.mjs` | exit 0 |
| `git diff --check` | exit 0 |
| Chromium candidate UI, 1440x900 and 390x844 | no page overflow or script errors; mobile controls reachable |

Raw local regression log:
`C:\Users\LXN\Documents\Codex\2026-10-09\codex-threads-01a0cea4-9cd4-7932-a438\work\social-final-regression.log`.
UI harness and screenshots are in the same `work` directory.

## Independent Review

Read-only reviewer reran social-runtime, social-memory,
social-engine-integration and social-state: exit 0, 35 PASS, 0 FAIL.
An adversarial 129-ref case retained the overflow sentinel, rejected the
draft and never called the validator. No P1/P2 finding in that bounded audit.
The reviewer did not modify files or access production.

Reviewed SHA-256 prefixes: manager A73A47F0, reflection-store C586A5BE,
learned-self-provider F468A37C, notebook-store 4AF609B2, retrieval-provider
71B12BA3, conversation/context FF88A8F1, conversation/state 0BA97B4B,
orchestrator 2B282E1C, core/store F5674550, sender 8B6F89D9,
plugins/context F5215C73.

## Remaining Acceptance

- Full A-E/A-S/A-P/A-R/A-I/A-D/A-M/A-L/A-C/A-H matrix is not individually
  closed by the focused test count. Remaining main-chain combinations and
  behavior replay still require an explicit coverage/evidence pass.
- Explicit configured/shared-interest source ingress is not implemented.
  Current tested ingress uses real human messages and eligible read-tool
  observations. No autonomous exploration or new external service was added.
- Naturalness, real-model costs/latency and QQ delivery are LIVE_NOT_RUN.
  Synthetic output does not prove conversational quality or improvement.
- Full repository unit follow-up now FAILS; see the dated results below.
  The remaining composite `npm test` stages were not rerun in that follow-up.
- Production SSH, backup/reset/cleanup, deployment, unmute, live mode changes,
  paid model/embedding calls, QQ sends, commits, pushes and releases are NOT_RUN.

## Future Enablement And Fallback

After separate deployment/operation authorization, use existing authenticated
chat settings to explicitly select social for the intended scope. Keep the
current runtime restrictions, persona and credentials unchanged.
Fallback uses the same settings to restore legacy/threaded/lifecycle.
Retain social history, Notebook/profile versions and held/unknown operations;
never replay unknown writes or treat a mode switch as permission to clean data.
SC8 remains excluded until separately authorized.

## Full Unit Follow-Up

Date: 2026-10-14, Asia/Hong_Kong. This was a status verification, not a fix
pass. No implementation code or test assertion was changed.

All 108 top-level `test/*.test.mjs` files were passed explicitly to
`E:\node22\node.exe --test --test-concurrency=1`, with a temporary
`QQ_AGENT_DATA_DIR` fallback to keep repository/production data isolated.

Result: exit 1, 708 tests, 660 PASS, 45 FAIL, 3 SKIP, 126.054 seconds.
The earlier 248-pass result covers its stated focused scope only.

Observed failures include `/bin/bash` unavailable on Windows, updater
temporary Git/process-exit assertions, SQLite EBUSY cleanup, platform
permission/signal assertions and Notebook prompt-safety assertions.
Root causes and whether each failure predates this candidate have not been
individually established; do not label all failures as environmental.

Raw log:
`C:\Users\LXN\Documents\Codex\2026-10-09\codex-threads-01a0cea4-9cd4-7932-a438\work\social-all-unit-verification.log`.

Development remains incomplete and the full unit suite is not green.
