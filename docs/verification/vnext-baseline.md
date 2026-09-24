# vNext P0 Baseline

- Verification date: 2026-09-24 (Asia/Shanghai)
- Repository: `Velvetalon/qq-agent-plus`
- Branch: `main`
- Planned baseline: `e2abe9416afe154bd495b5190e66abbcc06e41b8`
- Package version: `0.6.8`
- Required Node.js: `>=22.13.0`
- Scope: P0 only. No production code, role text, send queue, data migration, or configuration defaults were changed.

## Status Summary

| Area | Status | Evidence / note |
|---|---|---|
| HEAD matches planned baseline | PASS | `git rev-parse HEAD` = `e2abe9416afe154bd495b5190e66abbcc06e41b8` |
| Fork remote | PASS | `origin/main` is the same revision |
| Upstream comparison | PASS | `HEAD...upstream/main` = `2 behind / 75 ahead`; difference recorded, not merged |
| Workspace safety | PASS | Existing user changes are `AGENTS.md`, `delay/`, `plan_doc/`; not reverted |
| Deployment revision | PASS | Server deployed revision is the planned HEAD |
| Deployment service | PASS | `qq-agent-linux` is `active` |
| Required runtime available locally | PASS | Explicit Node `v24.19.0`, SQLite `3.53.3` |
| Default test runtime | BLOCKED | Default `node` is `v16.14.2`, below package requirement |
| Unit suite under Node 24 | FAIL | 389 tests: 340 passed, 46 failed, 3 skipped; see log and failure groups below |
| Prompt/local/scroll/usage focused tests under Node 24 | PASS | Prompt, local 9/9, scroll 19/19, usage 31/31 |
| Render test under Node 24 | FAIL | Existing render assertions and an async DOM harness error failed |
| Production chat sample | BLOCKED | No raw production chat/log sample was accessed or stored for privacy and credential-safety reasons |

## Source, Git, and Deployment

### Local Git state

Commands:

```text
git status --short --branch
git log -1 --format=fuller
git remote -v
git branch -vv
git fetch origin main
git fetch upstream main
git rev-parse HEAD
git rev-parse origin/main
git rev-parse upstream/main
git rev-list --left-right --count HEAD...origin/main
git rev-list --left-right --count HEAD...upstream/main
```

Results:

- `HEAD`: `e2abe9416afe154bd495b5190e66abbcc06e41b8`.
- `origin/main`: same revision; local branch tracks `origin/main`.
- `upstream/main`: `75d36856dfe29400142ef6e134af5dbc1401f12e`.
- Relative counts: `HEAD...origin/main` = `0 0`; `HEAD...upstream/main` = `2 75`.
- The planned baseline is the current HEAD, so no reset or merge was performed.
- Existing workspace changes are:

  ```text
   M AGENTS.md
  ?? delay/
  ?? plan_doc/
  ```

  These are the previously requested planning/archive changes. They are intentionally left untouched.

Deployment evidence is in [deployment-check-final.log](p0-20260924/deployment-check-final.log). The remote publish directory is an artifact directory, not a Git checkout, so the deployed revision was checked using `/mnt/data/qq-agent/data/deployed-revision`.

- Deployed revision: `e2abe9416afe154bd495b5190e66abbcc06e41b8`.
- User service `qq-agent-linux`: `active`.
- Service runtime: `/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node`.
- Listening endpoints observed: `0.0.0.0:3210`, `0.0.0.0:5099`, `0.0.0.0:6081`; OneBot `127.0.0.1:3000` and `127.0.0.1:3001`.
- The deployment record says auto-update is disabled and the repository is the user's fork. No deployment operation was performed in this P0 run.

## Environment

Default shell commands reported:

```text
node --version       v16.14.2
npm --version        8.5.0
platform             win32 x64
```

The default Node is too old for this repository. A bundled runtime was available and was used explicitly for compliant local verification:

```text
C:\Users\v_whcnwwang\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --version
v24.19.0

process.versions.sqlite
3.53.3
```

`npm ci` was **NOT_RUN**: dependencies were already present, and reinstalling with the default Node 16 would not be a valid project-runtime verification. No lockfile was changed.

## Test Commands and Exit Codes

All logs are under [docs/verification/p0-20260924](p0-20260924). The Node 24 commands used the explicit Node binary and npm CLI; the script children received the Node 24 directory first in `PATH`.

### Default Node 16 environment

| Command | Exit | Status | Result |
|---|---:|---|---|
| `npm run test:unit` | 9 | BLOCKED | Node 16 rejects `node --test` |
| `npm run test:prompt` | 1 | BLOCKED | `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` |
| `npm run test:render` | 1 | BLOCKED | `structuredClone is not defined` |
| `npm run test:scroll` | 0 | PASS | 19/19 passed |
| `npm run test:usage` | 1 | BLOCKED | `node:sqlite` unavailable |
| `npm run test:local` | 1 | BLOCKED | Node 16: 1/9 passed; remaining cases fail to import `node:sqlite`/`structuredClone` |
| `npm run test:legacy-selftest` | 1 | BLOCKED | `node:sqlite` unavailable |
| `npm test` | 9 | BLOCKED | Node 16 rejects `node --test` before the suite starts |

### Node 24.19.0 environment

| Command | Exit | Status | Result |
|---|---:|---|---|
| `node npm-cli.js run test:unit` | 1 | FAIL | 389 tests: 340 pass, 46 fail, 3 skipped |
| `node npm-cli.js run test:prompt` | 0 | PASS | Prompt self-test passed |
| `node npm-cli.js run test:render` | 1 | FAIL | Several existing render assertions fail; final SSE DOM harness throws `TypeError` |
| `node npm-cli.js run test:scroll` | 0 | PASS | 19/19 passed |
| `node npm-cli.js run test:usage` (standalone) | 0 | PASS | 31/31 passed; real local `:3210` service started by the test |
| `node npm-cli.js run test:local` | 0 | PASS | 9/9 local regression groups passed |
| `node npm-cli.js test` | 1 | FAIL | Unit phase stops at 340/389 before chained prompt/render/scroll/usage phases |

The Node 24 unit failure set is not a single newly introduced defect. The log contains environment/platform-dependent groups including updater/network tests, Linux shell/systemd deployment tests on Windows (`/bin/bash` unavailable), Windows temporary-directory cleanup `EPERM`, and existing behavior/fixture assertion mismatches. Representative names and full output are retained in [test-unit-node24.log](p0-20260924/test-unit-node24.log); no test was removed or rewritten to make the baseline green.

Render failures retained in [test-render-node24.log](p0-20260924/test-render-node24.log) include:

- `renderHealthCard` reads `baseUrl` from an undefined object.
- Person-image experiment default/page assertions fail.
- Service/update/secret control view assertion fails.
- The session SSE section later throws `TypeError: Cannot read properties of undefined (reading 'firstElementChild')` in the DOM test harness.

The first parallel usage run also hit `EADDRINUSE 127.0.0.1:3210` because another test process was active. It was rerun standalone and passed 31/31; the standalone result is the authoritative usage result.

## Tool Contract and Runtime Order

The following inventory was obtained by importing the real `buildToolDefs()` and printing each definition in array order. `toOpenAiTools()` produced 23 schemas in the same order. `executeTool()` resolves by name, parses/repairs JSON arguments through the existing parser, checks the run signal, calls the definition, and returns the result plus parsed arguments; unknown tools and invalid JSON are errors. The `tools.js` wrapper delegates to `tools-core.js` when the scheduler is disabled and preserves multimodal result observation.

| # | Tool | Parameters | Scheduler class |
|---:|---|---|---|
| 1 | `send_message` | `messages`, `replyToMessageId`, `atUserId` | ordered-action |
| 2 | `send_sticker` | `stickerId`, `replyToMessageId`, `atUserId` | ordered-action |
| 3 | `list_stickers` | `query`, `limit` | ordered-read |
| 4 | `get_sticker_image` | `stickerId` | ordered-read |
| 5 | `sticker_note` | `stickerId`, `note`, `tags`, `usage` | ordered-action |
| 6 | `collect_sticker` | `messageId`, `note` | ordered-action |
| 7 | `send_face` | `name`, `text`, `replyToMessageId`, `atUserId` | ordered-action |
| 8 | `schedule_wake` | `minutes`, `note` | ordered-action |
| 9 | `send_poke` | `targetUserId` | ordered-action |
| 10 | `get_recent_messages` | `limit`, `offset` | parallel-read |
| 11 | `read_forward` | `messageId` | ordered-read |
| 12 | `get_active_members` | `limit` | parallel-read |
| 13 | `get_message_detail` | `messageId` | parallel-read |
| 14 | `get_message_images` | `messageId` | ordered-read |
| 15 | `memory_append` | `category`, `userId`, `target`, `content` | ordered-action |
| 16 | `memory_query` | `userId` | parallel-read |
| 17 | `person_memory_lookup` | `userId` | parallel-read; `identityPilot` |
| 18 | `friend_request_propose` | `userId`, `reasonCode`, `reason`, `verificationMessage` | ordered-action; `friendProposal` |
| 19 | `memory_remove` | `category`, `userId`, `target`, `content` | ordered-action |
| 20 | `report_feedback` | `level`, `message` | ordered-action |
| 21 | `web_search` | `query` | parallel-read |
| 22 | `web_fetch` | `url` | parallel-read |
| 23 | `finish` | `summary`, `topic`, `hypotheses`, `evidence`, `facts`, `decisions`, `rejectedDirections`, `openQuestions`, `nextStep`, `threadDisposition`, `ttlMinutes`, `clearHandoff` | terminal |

Observed invariants:

- `finish` is the only terminal tool in the current scheduler.
- Unknown/unclassified tools are not optimized; the scheduler treats them as ordered.
- With the scheduler disabled, the wrapper calls the legacy execution path directly.
- With it enabled, only consecutive `parallel-read` calls are pre-started; results are returned to the host in original call order. Ordered reads and actions are never pre-started.
- `finish` after a prior tool failure is blocked by the finish barrier. Calls after a terminal call are skipped with `SKIPPED_AFTER_FINISH_BARRIER`.
- Inline tool calls are parsed by `src/tools/inline-tools.js`, converted to the same OpenAI-shaped call structure, then enter the same orchestrator/tool execution path. The parser supports XML-like blocks, wrapped JSON, function-name-plus-JSON, and a bare named JSON response; native `tool_calls` take priority.

## Three Conversation Modes

The actual config accepts `legacy`, `threaded`, and `lifecycle`; global mode can be overridden per allow-listed group when `conversation.unifiedMode` is false. Private chats use the global mode. The defaults are `conversation.mode = legacy`, `unifiedMode = true`, and no group overrides.

### `legacy`

Only mention, keyword, and probability trigger policy can start a run. It is the rollback/default mode. Each run has its own Session and uses the normal lease/ack path.

### `threaded`

After the agent sends a message, the intended participant receives a deterministic continuation window; replies to the bot trigger deterministically. Other messages use legacy trigger policy. Thread checkpoints are persisted only after a successful send and are associated with a `threadId`, while each execution remains a separate Session.

### `lifecycle`

An initial legacy trigger opens a persisted lifecycle. While active/listening, each incoming batch in that chat reaches the model, which may send or finish without sending. The current defaults are 5-minute listening idle, 20-minute active idle, 30-minute hard lifetime, 10-minute rollover window, 100 initial context messages, 32,000 measured prompt-token rollover threshold, and 240,000 transcript character cap. Lifecycle transcript/checkpoint/lease work is committed through `commitLifecycleRun`; raw image-bearing transcript deltas force the multimodal rollover path.

Across all modes, the lease/ack boundary and held/unknown outbound-delivery behavior remain authoritative. Session status still uses `done`, `noreply`, `error`, and `aborted`; the current `noreply` classification is based on `session.sent.length === 0`, so it is not yet the explicit `stay_silent` semantic proposed by later phases.

## Scheduler, Dispatch, and Multimodal Combination

### Scheduler

The scheduler is an experimental wrapper controlled by `config.toolSchedulerPilot.enabled` (default `false`) and `maxParallelReads` (bounded to 2..8, default 4). It does not replace the orchestrator's main loop or tool execution contract. It wraps `tools.js`, preserves legacy behavior when disabled, and records session metrics such as parallel waves, calls, finish-barrier blocks, and trailing skips.

The scheduler's parallel-safe set is `get_recent_messages`, `get_active_members`, `get_message_detail`, `memory_query`, `person_memory_lookup`, `web_search`, and `web_fetch`. Ordered reads are `list_stickers`, `get_sticker_image`, `read_forward`, and `get_message_images`. Ordered same-round actions include all send/poke/wake and memory/feedback/proposal writes. The scheduler modifies tool descriptions only while enabled to guide same-round batching; it does not alter base schemas while disabled.

### Multimodal

The main run filters `get_message_images` and `get_sticker_image` when `api.vision` is disabled or the selected model is classified as `no-vision`. Tool image parts are returned as a text-only `tool` result followed by a `user` message containing text plus `image_url` parts, preserving the provider's required tool-result pairing. Inline image data is omitted from audit snapshots and causes lifecycle rollover rather than being persisted in the provider transcript.

The separate `multimodalContextPilot` has `enabled=false`, `graduated=false` by default. When enabled, successful image-tool results record bounded source references; `finish` copies them into the handoff draft, and an image-bearing lifecycle commit is rewritten to a compact text continuation with source IDs and summary/facts/decisions/open questions. It does not persist raw image bytes. This was verified by the focused multimodal unit tests that passed inside the Node 24 run; real QQ/model image behavior was not exercised in this P0 run.

### Existing external/proactive dispatch

The ordinary chat orchestrator owns message batching, lease claiming, trigger selection, run timeout, sender/outbox effects, and post-run drain. Separate proactive/daily/Qzone schedulers remain outside the plugin work described by P0. Their defaults are disabled in the checked-in configuration (`proactive.enabled=false`, `dailyMoments.enabled=false`, `qzoneInteractions.enabled=false`, `pacing.enabled=false`). No external send was performed for this baseline.

## Human Sample and Privacy Boundary

No raw production private/group chat, API key, QQ credential, token, or hidden reasoning was copied into this repository or the evidence directory. A fixed production sample is therefore `BLOCKED` for this P0 run. The later real-model evaluation must use an administrator-approved, explicitly redacted replay fixture and record only the minimum message IDs/text needed to reproduce trigger, tool, send, and silence behavior.

## Known Gaps and P1 Gate

### FAIL / BLOCKED items carried forward

- The default Windows command environment is Node 16 and cannot run the project's required SQLite/test features. Use the explicit Node 22+ runtime in future local verification.
- Full unit suite is not green on this Windows host: 46 failures include platform-dependent deployment/update tests, temporary-directory cleanup failures, and behavior/fixture mismatches. These failures must be triaged before using the suite as a release gate; they are not silently attributed to P1.
- Render suite has existing assertion failures and a DOM harness exception.
- No production chat sample or real-model behavior was validated.
- The local usage test is port-sensitive when run concurrently; standalone execution passed.

### P1 recommendation

P1 may begin only from the unchanged planned baseline and with this document treated as the comparison record. Before merging P1, rerun the focused PASS set under the deployed/runtime Node 22+ environment, classify the 46 unit failures into expected platform blockers versus genuine baseline defects, and preserve the existing 23-tool order/schema and three-mode semantics. P1 must not use these baseline failures as justification to modify production defaults, role text, Sender/Outbox, lease/ack, lifecycle commit, or multimodal result handling.

