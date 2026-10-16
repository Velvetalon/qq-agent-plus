# Deployment preflight and bounded Notebook repair

**Later user instruction:** all target-server connection retries, authentication,
deployment and replacement are paused until explicit user confirmation, even if
connectivity recovers. The resume design below is historical preparation, not
permission to resume. Continue project-local development and isolated validation.

Date: 2026-10-16 UTC. Project: Velvetalon/qq-agent-plus only.
Environment display name: Dot (legacy configuration label AlnaslEngine); no
environment settings were changed. This is a deployment-attempt handoff, not a
release or replacement of the broader progress audit.

## Versions and decision

- Remote main: `2be4bccce643d4d40bdc4472e5703f3a109aac2e`.
- Audit documentation only: `docs/progress-audit-20261016` at
  `fb705fc0d54e040949812cea8d68305ce87b2f20`.
- Repair candidate: `2d5800068b74a3c6a5a0561ac7dcd69b2b7f05e3`, branch
  `fix/deploy-notebook-gate-20261016`; pushed and verified with ls-remote.
- Remote branch enumeration before repair found only main and the audit branch.
  Latest visible tag is v0.6.8, peeled commit
  `f4732e0d55c898e9e1fbbfcef66244fb2ce1917c`; repository releases API returned
  an empty list. Old tags are not proof of the currently installed version.
  Actions API returned no runs for the main SHA; no remote green CI is claimed.
- **HOLD: no production deployment, merge, tag or release.** The candidate is
  still based on Social WIP, whose full acceptance remains incomplete. Strict
  scanning is also nonzero. Do not deploy the audit documentation branch.

## Connection and remote state

Target: ubuntu at 162.14.67.217, TCP port 22. A Python TCP/banner probe returned
`ConnectionRefusedError [Errno 111] Connection refused`. A separate system SSH
probe returned exit 255, `Connection refused`, with an empty SSH configuration,
BatchMode, no identity agent, public-key/password/keyboard-interactive/GSSAPI
authentication disabled, strict host verification and a ten-second timeout.

No SSH handshake, host-key verification or authentication was reached. This
does not establish whether the refusal originated at the host or a network
control. No credential was searched, printed, supplied or transmitted. No
network/SSH/firewall settings, global Docker services or other projects changed.
This is a connectivity blocker, not a bad-password diagnosis or approval denial.

Remote installed SHA, service/container ownership, ports, data directories,
health and deployment entry are **UNKNOWN / NOT_INSPECTED**. Remote backup:
**NOT_CREATED**, so no backup path can be claimed. Changed remote resources:
**NONE**. Rollback: **NOT_NEEDED / NOT_EXECUTED**, since deployment never began.
The existing service was left untouched; its health is not asserted.

## Repair and local evidence

Read AGENTS.md, current delay handoffs, audit progress/evidence, Social contract,
deployment Linux/OPS/BAOTA docs and local CI definition. Archived the bounded
implementation plan before changing source at
`plan_doc/2026-10-16-deployment-notebook-gate.md`.

Unchanged original Notebook prompt-safety tests initially returned exit 1,
5 PASS / 2 FAIL. Restored five missing explicit capability/safety statements in
the shared ROLE_NOTE_POLICY; retained the existing no-report statement, role
voice, scope/CAS, partial-read and operational-memory restrictions. No test
assertions, classifiers, schemas, lockfiles or stored data changed.

Linux x64, Node v24.19.0 (not the CI Node 22 runtime). Initial npm ci failed with
ENOENT creating the default cache. Retried with only
`--cache /tmp/qq-agent-plus-npm-cache`: original-lockfile
`npm ci --ignore-scripts --no-audit --no-fund` succeeded, 16 packages installed.
No registry substitution or global npm setting changes. Prior mirror 403 from
the audit was not reproduced on this successful attempt.

All tests use synthetic temporary data and local mocks. No paid model calls,
real QQ messages, historical profile cleanup or real-user write tests.

| Check | Result |
| --- | --- |
| Existing prompt-safety + social-memory + learned-self-policy | 15 PASS, exit 0 |
| Original audit V1 explicit 13 files on fixed candidate | 58 PASS, 0 FAIL/SKIP, exit 0 |
| All self-evolution-*.test.mjs on fixed candidate | 59 PASS, 0 FAIL/SKIP, exit 0 |
| Initial serial full unit run | 708 PASS, 0 FAIL/SKIP, exit 0; began before final removal of a duplicated prompt sentence, so final frozen run is authoritative |
| Frozen candidate 2d580006, default-concurrency full unit run | 708 PASS, 0 FAIL/SKIP, exit 0; 58.031 seconds |
| Local mock regressions | 9/9 PASS, exit 0 |
| sqlite-vec smoke / prompt self-test | Both exit 0 |
| Render / scroll / usage | 138 / 19 / 31 PASS, all exit 0 |
| JS/MJS syntax | 245 files exit 0; changed policy rechecked after final edit |
| Shell syntax and git diff --check | Exit 0 |
| Strict undefined-call scan | Exit 1, 13 suspicious call sites; NOT green |

Strict scan findings: conversation/context.js validator; core/orchestrator.js
onReadResult/onImageResult; features/retrieval.js mapNote; plugins/context.js
action; notebook-store.js apply; reflection-plugin.js getBasePersona/getMode/
getExpectedProfileRevision; reflection-store.js now/isEnabled;
reflection-worker.js value; vector-memory.js createRequire. Scanner and all
flagged modules are unchanged from main. These require triage; no ignore list
was expanded and no conclusion that all are real runtime defects is claimed.

Raw local evidence (ephemeral, synthetic, not production):
`/tmp/qq-agent-plus-prompt-predeploy.tap`,
`/tmp/qq-agent-plus-notebook-fixed.tap`,
`/tmp/qq-agent-plus-focused-final.tap`,
`/tmp/qq-agent-plus-self-final-b_924b_e/results.tap`,
`/tmp/qq-agent-plus-gates-nus38_m3/`,
`/tmp/qq-agent-plus-final-unit-0ybsxolx/unit.tap`.

## Resume conditions and reversible deployment design

1. Have the authorized server/network operator diagnose the TCP refusal; this
   worker must not change shared firewall, network or SSH configuration or
   bypass restrictions. Recheck the direct authorized route after new evidence.
2. Verify the SSH host identity through a trusted channel. If actual password/
   token transmission or new lasting authorization is necessary, report the
   exact target and operation to the parent for the required sensitive-action
   confirmation. Do not request passwords in chat or treat deployment approval
   as a waiver. No authentication action is currently pending or attempted.
3. Read-only inventory only this project's known units/metadata, filtered
   container labels/mounts, listening ports, code SHA, existing data paths and
   health. Do not print config secrets, raw process environments or logs that
   might contain credentials. Never assume documented default paths are actual.
   Unclear ownership is a stop condition, especially for shared OneBot.
4. Resolve remaining candidate gates and review Social acceptance scope before
   deployment. Broader Social feature work requires a separately agreed scope;
   do not merge this bounded patch as proof of full WIP readiness.
5. After ownership and gates pass, retain the actual install/data paths, bind
   address, service identity, configuration, account sessions and runtime mode.
   Use a project-owned versioned staging location and consistent SQLite-aware
   backups plus code/config/unit snapshots, preserving all older backups. Record
   their exact non-secret paths before replacement. Avoid generic backup helpers
   that prune old archives and avoid full-stack installers/global changes.
6. Check quiescence and side effects before restarting an active bot: if preserving
   the current mode could trigger prohibited model calls or QQ sends, stop for a
   scoped decision rather than silently activating or changing runtime mode.
7. Use the verified project service user and deployment entry, with recovery
   available; no destructive migrations. Verify actual remote deployed SHA,
   unit/process state and read-only health response. On failure restore only
   this project's recorded prior code/config/unit; retain data and unknown sends.
   No completion claim without actual remote evidence.
