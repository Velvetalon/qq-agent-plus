# Local repair checkpoint, server work paused

Date: 2026-10-16 UTC. Repository: Velvetalon/qq-agent-plus only.

Latest user instruction supersedes the deployment resume plan: do not retry the
target server, authenticate, deploy or replace remote resources until the user
explicitly confirms resumption. No target-server action occurred after this
instruction. Dot's environment configuration and other projects are unchanged.

## Fixed source candidate

`9cd2c2449b467314f146adcb23d4a425c5fa8ad4` on
`fix/deploy-notebook-gate-20261016`. Main remains
`2be4bccce643d4d40bdc4472e5703f3a109aac2e`. The draft review is
[PR #1](https://github.com/Velvetalon/qq-agent-plus/pull/1); it is not merged and
does not authorize deployment. Later documentation-only commits retain this
tested product source. The earlier audit branch is documentation, not a release.

Changes in this checkpoint:

1. `3d068f6`: resolve 13 strict-scan false positives by recognizing real callback
   parameters and destructured bindings. Verified each reported name against its
   declaration. No ignore-list additions. Unknown standalone calls, alias keys
   and default-expression names remain reportable. Multiline literal/comment
   masking now preserves line numbers. The scanner remains a file-level
   heuristic, with scope/dynamic-code limitations documented in docs/OPS.md.
2. `9cd2c24`: reject malformed or oversized Social source lists before truncation
   can discard an invalid tail. Decision sources combined with reply targets
   cannot silently exceed the limit. Initiative parsing and durable store reject
   the whole invalid proposal; valid bounded input and idempotency remain valid.
   This is an existing source-integrity contract repair, not a new feature.
3. The prior Notebook explicit boundary repair (`2d58000`) remains included.
   Test assertions were not relaxed; the old scope/CAS and role-note policy stay.

Archived implementation scope:
`plan_doc/2026-10-16-local-development-closure.md`.

## Red/green evidence and limits

New `test/social-source-boundaries.test.mjs` was run against the old implementation
first: 0 PASS / 3 FAIL, exit 1. The failures independently reproduced:

- four allowed initiative IDs plus an invalid fifth being accepted after truncation;
- eight decision sources plus a ninth reply target returning an incomplete source list;
- eight valid durable references followed by a forged ninth being silently ignored.

Final tests also cover malformed reference containers, invalid source elements,
no partial intent persistence, valid acceptance and idempotency. All pass without
rewriting the failing assertions. `test/ops-scan.test.mjs` runs syntax-valid
fixture files through the actual CLI with `--strict --no-ignore`; valid callback
bindings pass, while unknown calls still cause exit 1 and retain exact line numbers.

## Final gates

Runtime: Linux x64, **Node v22.22.2**, matching the CI major version and the
historical supported test runtime. Installed only into the task-local npm cache
with `npm exec --cache /tmp/qq-agent-plus-npm-cache --yes --package=node@22.22.2`;
no system Node, global npm configuration, lockfile or repository dependency change.
The child test PATH used this Node binary, including subprocess tests.

Product source remained fixed at the candidate SHA throughout this run. Each test
used isolated synthetic data; local protocol/model mocks were allowed. No real
QQ sends, paid model/embedding calls, user-data writes or profile cleanup occurred.

| Command/check | Result |
| --- | --- |
| `node src/ops.js scan --strict` | exit 0, 0 suspicious calls |
| `node --test --test-reporter=tap test/*.test.mjs` (sorted explicit file list) | exit 0, 714 PASS, 0 FAIL/CANCEL/SKIP, 56.644 seconds |
| `node test/local/run.mjs` | exit 0, 9/9 case files |
| `node scripts/sqlite-vec-smoke.mjs` | exit 0 |
| `node test/test-prompt.mjs` | exit 0 |
| `node test/render-test.mjs` | exit 0, 138 PASS |
| `node test/scroll-test.mjs` | exit 0, 19 PASS |
| `node test/usage-e2e.mjs` | exit 0, 31 PASS |
| `node --check` for src/scripts/test/ui JS/MJS | 247 files, all exit 0 |
| `bash -n deploy.sh deploy-all.sh manage.sh` | exit 0 |
| `git diff --check` | exit 0 |

All CI test commands and the additional usage/vector checks passed locally;
this is not a claim that hosted GitHub Actions ran. Raw synthetic logs and JSON
exit-code summary are at `/tmp/qq-agent-plus-node22-closure-ebqx544l/` (ephemeral).
Earlier focused regression: `/tmp/qq-agent-plus-local-closure-focused.tap`,
33 PASS on Node 24 before the final added invalid-element cases; the Node 22
full run above is the authoritative final result.

## Acceptance reconciliation

The audit's dependency-based NOT_RUN results have fresh executable evidence now.
Do not retroactively edit the audit's historical results or turn its entire
200-row matrix green. The following bounded evidence is available in the final
full run:

| Contract slice | Actual test path and boundary |
| --- | --- |
| A-P07 / A-I03 / A-I07 source integrity | New source-boundary tests validate full input and durable rejection; not semantic equivalence of arbitrary paraphrases |
| A-E01 / A-E03 / A-H02 | social-runtime real Orchestrator → guarded Sender → v3 evidence; only model/OneBot edges mocked |
| A-E02 | social-runtime durable queue round-trips v3 while refusing to promote old rows |
| A-H01 | social-app-integration old synthetic DB → createApp → explicit mode → restart/fallback |
| A-H06 / A-L03 | social-engine-integration real producer → Manager → worker accumulates independent evidence without fabricated shared-window fixtures |
| A-I01 / due evaluation | social-runtime empty tick performs zero model calls; a sourced due intent is leased and evaluated |
| A-D02 / A-D03 / A-D04 / A-D08 | social-runtime queued target withdrawal, unrelated topic updates, mode changes and Notebook revocation |
| A-D06 / A-D07 | social-runtime confirmed partial output is retained and unknown remainder held |
| A-P04 / A-I04 partial | real read-tool observation → scoped external source → share passes; configured/shared-interest ingress is still missing |

These tests do not close every clause or combination in each named contract.
Remaining local work includes configured/shared-interest source ingress and
explicit exploration opportunities with independent budgets; all-case Social
acceptance mapping; additional main-chain combinations where the audit lists
missing evidence; and the older lexical-retrieval policy discrepancy. No new
exploration interface or service was introduced in this repair checkpoint.

Real-model naturalness/cost/latency and actual QQ behavior remain LIVE_NOT_RUN.
Server inventory, backup, deployment and health verification remain USER_PAUSED,
not failed local tests and not automatic resume candidates. Existing code tests
are now green, but the whole unfinished Social product is not declared complete
or ready to deploy. Continue local development from this checkpoint; the user
handles SSH independently.
