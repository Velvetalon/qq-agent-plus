# vNext P7 Console Observability Verification

- Verification date: 2026-09-25 (Asia/Hong_Kong)
- Repository worktree: `E:\Code\qq-agent-plus-p7`
- Branch: `p7-observability-work`
- Baseline commit: `8bade7f` (P2–P6 accepted)
- Runtime used for evidence: `E:\node22\node.exe` (`v22.22.2`); the project requires Node >= 22.13
- Contract: coordinator-frozen `P7-D0` (see the task brief for `WS-P7-OBSERVABILITY`)
- Scope: plugin status/control read model, self-evolution admin API (Notebook / Learned Self / Reflection / Capability Gaps), session audit fields and presentation, plugin + self-evolution console pages, verification docs.
- Explicitly out of scope: P8 release validation, a second admin port, plugin upload/install/execute routes, Trigger Policy, Sender/Outbox/lease/ack or unknown-write semantics, admin `persona.roleText`.

## Changes Verified

- `src/console/app.js` (single writer for backend routes)
  - New routes: `GET /api/plugins`, `PUT /api/plugins/:id`, `GET /api/self-evolution/status`, `GET /api/self-evolution/notebook`, `PUT /api/self-evolution/notebook/:id`, `POST /api/self-evolution/notebook/:id/archive`, `GET /api/self-evolution/reflection/{jobs,proposals,gaps,profiles}`, `POST /api/self-evolution/reflection/proposals/:id/review`, `POST /api/self-evolution/reflection/profiles/:revision/rollback`.
  - `authorizeWrite(req)` for write routes: `x-console-token` header or `qq_agent_token` cookie only; a query-string `?token=` that satisfies the legacy `authorize()` is still rejected with 401 on write routes, and no response echoes a credential.
  - `readJsonBody(req)`: 2 MiB cap (413 `BODY_TOO_LARGE`), malformed JSON (400 `INVALID_JSON`), non-object body (400 `INVALID_BODY`). Body validation runs before feature-state checks so request-level errors are never masked by `409`.
  - `apiFailure()`/`sendStoreError()`: every failure returns `{ error, code, details? }`; store error codes map to 400/404/409 as declared by `NotebookError.httpStatus`/`ReflectionError.httpStatus` (CAS conflicts are 409).
  - `accountNamespace()`: current OneBot `selfId`, explicit `'default'` only when `selfId` is absent. Every route reports the namespace it used (`accountId`, `accountSource`).
  - Self-evolution host wiring: `createSelfEvolutionPlugin()` and `createReflectionPlugin()` are registered on the orchestrator's `PluginManager`, and started only when `selfEvolution.enabled` / `selfEvolution.reflection.enabled` are true. The reflection reflector adapter calls `chatCompletion` only from the reflection worker (never from the chat path) and reparses the reply through `core/json-repair.js`.
  - `buildSessionView()` + the SSE payload now carry `pluginSnapshot`, `pluginContext`, `retrieval`, `contextBudget`, `participation`, `termination`, `outbound` with `sessionAuditView()` defaults.
- `src/core/sessions.js`: exported `sessionAuditView()`; session index summaries include the same normalized audit fields so list / SSE / detail cannot diverge.
- `src/plugins/manager.js`: `status()` read model extended to `{id,name,version,apiVersion,required,enabled,generation,running,startedAt,lastError,capabilities,canEnable,canDisable}` (existing fields preserved); start/stop failures are recorded in `lastErrors`.
- `src/plugins/self-evolution/reflection-store.js`: added read-only `getProposal({ proposalId, accountId })` so the review route can resolve a proposal (and its batch) inside the current namespace without a full table scan.
- `ui/index.html`, `ui/app.js`, `ui/style.css`: new **插件** page (inventory + restricted enable/disable) and **自我迭代** page (Notebook / 习得自我 / 反思作业·提案 / 能力缺口), rendered through the existing `esc()` and the authenticated `api()` helper; session detail gained a 运行审计 panel and `sessionDetailFingerprint()` so audit changes force a re-render.
- `test/p7-console-observability.test.mjs`: new P7 coverage (7 tests).
- This document plus `docs/verification/p7-20260925/` evidence.

## Contract Matrix

| Contract item | Status | Evidence |
|---|---|---|
| Data sources are `PluginManager.status()`, `NotebookStore`, `ReflectionStore`, `RetrievalService`, `SessionRegistry` | PASS | Routes read only from those sources; retrieval is reported as unavailable rather than synthesized. |
| Account namespace = current OneBot `selfId`, explicit `'default'` only when absent, never mixed | PASS | `accountNamespace()` in `src/console/app.js`; API tests assert `accountSource: 'selfId'` with `selfId=20002` and `'default'` with an empty `selfId`. |
| Reuse existing `authorize(req)` (header/cookie/query compatibility for reads) | PASS | Read routes keep the legacy gate; `GET /api/plugins?token=…` returns 200. |
| New write routes reject query tokens | PASS | `authorizeWrite()`; `PUT /api/plugins/self-evolution?token=…` → 401. |
| 401 responses leak no credential | PASS | Test 2 asserts the response body does not contain the console token. |
| `readBody` max 2 MiB → 413 | PASS | Oversized `PUT /api/plugins/self-evolution` → 413 `BODY_TOO_LARGE`. |
| Malformed JSON → 400 | PASS | Truncated JSON on the rollback route → 400 `INVALID_JSON`; array body → 400 `INVALID_BODY`. |
| CAS/revision conflicts → 409 | PASS | Notebook update/archive, reflection review and profile rollback all return 409 with the store error code. |
| HTML/script rendered through existing `esc()` | PASS | UI test asserts `&lt;script&gt;`/`&lt;img …` escaping in notebook, proposal and session-audit rendering. |
| No upload / install / execute-code routes | PASS by source inspection | The P7 route block only exposes the listed inventory/status/read/write routes. |
| `GET /api/plugins` + `PUT /api/plugins/:id` (built-ins only, required cannot be disabled) | PASS | Test 3: inventory shape, `runtime-control` → 409 `PLUGIN_REQUIRED`, `legacy-tools` → 403 `PLUGIN_NOT_CONTROLLABLE`, unknown id → 404. |
| Enable/disable goes through the manager lifecycle, never a bare `enabled` mutation | PASS | `setPluginEnabled()` calls `PluginManager.setEnabled` + `startAll`/`disable`; tests assert `running` flips and `startedAt > 0`. |
| Plugin status fields `{…,running,startedAt,lastError,capabilities,canEnable,canDisable}` with existing fields preserved | PASS | Test 3 asserts the exact key set; `plugin-app-start`/`plugin-lifecycle` still pass. |
| `GET /api/self-evolution/status` | PASS | Reports namespace, plugin state, notebook/reflection DB existence, worker state, budget, learned-self revision, retrieval status. |
| `GET /api/self-evolution/notebook` (admin visibility, `includeArchived` allowed) | PASS | `search({admin:true, includeArchived})`; test 4 asserts archived entries appear only with `includeArchived=1`. |
| `PUT /api/self-evolution/notebook/:id` with `expectedRevision` CAS | PASS | Test 4: stale revision → 409 `NOTEBOOK_CAS_CONFLICT`; correct revision → 200 (`revision` 1 → 2). |
| `POST /api/self-evolution/notebook/:id/archive` | PASS | Test 4: stale → 409, correct → 200 with `status: 'archived'`. |
| `GET /api/self-evolution/reflection/{jobs,proposals,gaps,profiles}` | PASS | Test 5 reads all four; profiles returns `headRevision` for the client-side CAS. |
| `POST .../proposals/:id/review` (approve/reject + expected revision) | PASS | Test 5: stale revision → 409 `REFLECTION_REVIEW_STALE`; unknown proposal → 404; invalid decision → 400; reject → 200 `decision: 'reject'`; approve → 200 `reviewed: true`, `profileRevision` 0 → 1. |
| `POST .../profiles/:id/rollback` (expected head revision) | PASS | Test 5: stale head → 409 `REFLECTION_CAS_CONFLICT` without writing a version; correct head → 200 `revision: 2`. |
| Disabled self-evolution: historical reads allowed if the DB exists, no new DB/worker/model calls, writes rejected with an explicit error | PASS | Test 1: seeds a notebook DB, then reads it with the feature disabled (`readOnly: true`), asserts the reflection DB is never created, the notebook file is untouched, no runtime is started, and writes return 409 `SELF_EVOLUTION_DISABLED`. |
| Session summaries/SSE/detail expose participation, termination, outbound, pluginSnapshot, pluginContext, retrieval audit and context budget with old-session defaults | PASS | Test 6 compares a session file written without the new fields (`pluginSnapshot: null`, `retrieval.unavailable`, `contextBudget.promptChars: 0`) and then with them (`registryRevision: 3`, `blocks[0].revision: 4`, `integrated: true`). |
| `roleText` untouched | PASS | `sessionAuditView()` adds fields only; no route or renderer reads or writes `persona.roleText`. |
| Session detail re-render fingerprint includes audit fields | PASS | `sessionDetailFingerprint()`; UI test asserts a fingerprint change for each audit field and equality when nothing changed. |
| UI: Plugins page + Self-evolution 4-tab page, static style, authenticated helper, dense/operational | PASS | `ui/index.html` nav/views; UI test renders the plugins page (no toggle for non-controllable plugins) and the self-evolution page with all four tabs. |
| Integration: the two built-ins are registered with the account/base-persona/reflector adapters; no new LLM call on the chat path | PASS by source inspection + regression | Reflection model calls happen only inside `ReflectionWorker.runOnce`; `test/self-evolution-reflection.test.mjs` and the focused regression still pass. |
| Retrieval lexical integration read-only and disabled by default; no invented data | PASS | `/api/self-evolution/status` reports `{enabled:false, integrated:false, available:false, adapter:'unavailable'}`; no retrieval adapter is wired into chat or into session audits. |
| No Sender/Outbox/lease/ack or unknown-write changes | PASS | Diff touches no `src/onebot/sender.js`, `src/core/store.js` claim/ack path, or run-lease code; `test/delivery-integration.test.mjs` results are identical to baseline. |

## Interpretation Notes (frozen-contract tension)

1. **"Register only when enabled" vs. runtime enable/disable.** `PluginManager.register()` marks a definition with `enabled: false` as explicitly disabled, so a plugin that is not registered cannot be enabled later. The frozen contract also requires `PUT /api/plugins/:id` to enable a disabled built-in. Resolution: both built-ins are **registered at app construction** (registration creates no DB, no worker and no model call) while `start` remains gated by `selfEvolution.enabled` / `reflection.enabled`. `syncSelfEvolutionPluginOverrides()` aligns the manager's explicit overrides with configuration immediately before `startAll`. If the coordinator prefers literal conditional registration, the enable route must be dropped or replaced by a restart-only flow — that is a shared-semantics change, so it was not made unilaterally.
2. **Retrieval adapter.** `NotebookStore` does not expose its `DatabaseSync` handle, and `createSqliteIndexAdapter()` needs one; wiring retrieval into the chat path would also change prompt/context semantics. Per contract, `/status` and session audit report retrieval as `unavailable` instead of inventing hit data.
3. **New store method.** `ReflectionStore.getProposal()` was added (read-only, namespace-scoped) because the review route must resolve a proposal id to its batch; alternative `listProposals({limit:500})` scans could miss older proposals. No existing store semantics changed.
4. **Write-route auth ordering.** Body size/JSON validation runs before the feature-state check so that malformed or oversized requests return 400/413 rather than 409.

## Commands And Results

All commands were run from `E:\Code\qq-agent-plus-p7` with `E:\node22\node.exe` (`v22.22.2`) and `NODE_OPTIONS` cleared.

| Command | Exit | Status | Result / evidence |
|---|---:|---|---|
| `node --test --test-reporter=tap test/p7-console-observability.test.mjs` | 0 | PASS | 7/7; [01-p7-api-tests-node22.log](p7-20260925/01-p7-api-tests-node22.log) |
| `node --test test/plugin-registry.test.mjs test/plugin-lifecycle.test.mjs test/plugin-app-start.test.mjs test/plugin-tool-context.test.mjs test/p3-active-silence.test.mjs test/self-evolution-notebook.test.mjs test/retrieval.test.mjs test/self-evolution-reflection.test.mjs test/layout.test.mjs test/memory-page-separation.test.mjs test/session-persona-label.test.mjs test/p7-console-observability.test.mjs` | 0 | PASS | 88/88 (focused P2–P6 + P7 regression); [02-focused-regression-node22.log](p7-20260925/02-focused-regression-node22.log) |
| `node test/render-test.mjs` | 0 | PASS | ALL PASSED 138 (real `ui/app.js` in a DOM stub); [03-ui-render-node22.log](p7-20260925/03-ui-render-node22.log) |
| `node test/scroll-test.mjs` | 0 | PASS | ALL PASSED 19; [04-ui-scroll-node22.log](p7-20260925/04-ui-scroll-node22.log) |
| `node test/usage-e2e.mjs` | 0 | PASS | ALL PASSED 31 (real service + real endpoints); [05-usage-e2e-node22.log](p7-20260925/05-usage-e2e-node22.log) |
| `node --test --test-reporter=tap test/*.test.mjs` | 1 | FAIL (baseline/environment carry-forward) | 608 tests: 559 passed, 46 failed, 3 skipped; [06-full-unit-node22.log](p7-20260925/06-full-unit-node22.log) |
| Same command in a temporary worktree at baseline `8bade7f` | 1 | FAIL (baseline/environment) | 601 tests: 552 passed, 46 failed, 3 skipped; [07-full-unit-baseline-8bade7f-node22.log](p7-20260925/07-full-unit-baseline-8bade7f-node22.log) |
| Failure-set comparison of the two runs above | 0 | PASS | Identical failing test names (46 = 46, no additions); [08-failure-set-comparison-node22.txt](p7-20260925/08-failure-set-comparison-node22.txt) |
| `node --check` on every changed JS file plus `git diff --check` | 0 | PASS | [09-static-checks-node22.log](p7-20260925/09-static-checks-node22.log) |
| `node test/test-prompt.mjs` | 0 | PASS | Prompt self-test passed; [10-prompt-self-test-node22.log](p7-20260925/10-prompt-self-test-node22.log) |
| `node test/local/run.mjs` | 0 | PASS | 9/9 local regression groups; [11-local-regression-node22.log](p7-20260925/11-local-regression-node22.log) |

The 46 full-suite failures are the known Windows/Linux environment set (systemd/docker preflight, `/bin/bash` deployment scripts, Windows SQLite `EBUSY`/`EPERM` temp cleanup, Windows file-mode assertions, GitHub TLS stubs). P7 adds 7 tests and 7 passes and changes no failure name.

## Operator Notes (usage, recovery, migration, rollback)

- **Plugins page** (控制台 → 插件): shows id/name/version/API version/required/state/generation/capabilities/last error for every registered plugin. Only `self-evolution` and `self-evolution-reflection` expose a 启用/停用 button; required built-ins show no control. Enabling/disabling writes `selfEvolution.enabled` (and `selfEvolution.reflection.enabled`) through `updateConfig`, then starts or stops the plugin through `PluginManager`, so the store/worker lifecycle matches the toggle.
- **Self-evolution page** (控制台 → 自我迭代): Notebook lists notes with inline edit + archive (each write sends the revision the page rendered, so a stale tab gets a clear 409 instead of overwriting); 习得自我 lists profile versions with rollback; 反思作业/提案 shows jobs and pending proposals with approve/reject (revision = current head shown in the header); 能力缺口 lists deduplicated gaps. When the feature is disabled the page still renders historical data and labels it read-only.
- **Recovery**: if a write returns 409, reload the page (or re-read `GET /api/self-evolution/notebook` / `…/profiles`) and retry against the new revision; nothing was partially written. If a plugin start fails, `/api/plugins` reports `lastError` and the plugin stays registered-but-stopped.
- **Migration**: no schema or config migration is required. A deployment without `selfEvolution` in `config.json` is treated as disabled: no Notebook/Reflection database is created until an administrator enables it from the Plugins page.
- **Rollback**: hide or remove the two nav entries in `ui/index.html` to drop the pages while keeping the backend routes (data stays readable). Removing the P7 routes from `src/console/app.js` and the plugin registration block restores the pre-P7 behaviour; the `sessionAuditView()` defaults are additive and old session files remain valid. Nothing in P7 deletes or rewrites existing Notebook/Reflection data.

## Acceptance Status

**P7 PASSES THE FROZEN P7-D0 CONTRACT WITH TWO DOCUMENTED INTERPRETATIONS**

All required P7 tests are present and green, focused P2–P6 regressions are unchanged, and the full-suite failure set is identical to the baseline commit. The two interpretation points above (registration vs. start gating, and the unavailable retrieval adapter) are recorded for coordinator adjudication rather than silently resolved.

Carry-forward gaps / NOT_RUN:

1. **NOT_RUN** – no real model call was made: the reflection reflector adapter is wired but only exercised through `ReflectionWorker`/store tests, so real model compliance for reflection output is unproven.
2. **NOT_RUN** – no live OneBot/QQ verification and no real send was performed; account-namespace behaviour was verified with a stubbed `selfId`.
3. **NOT_RUN** – no browser-level (Playwright/manual) run of the new pages; UI verification is the DOM-stub render test plus source assertions.
4. **Not exercised end-to-end** – `PUT /api/plugins/self-evolution` start-failure handling (`PLUGIN_START_FAILED`) is implemented but not fault-injected in tests.
5. The full unit suite stays red on this Windows host with the same 46 environment failures recorded for P2/P3 (see evidence 08).

## Rollback

- Code: `git revert <p7 commit>` (or `git checkout 8bade7f -- src ui test` on a disposable branch) restores the pre-P7 tree. P7 contains no data migration, so no data rollback is required.
- UI-only: remove the `view-plugins` / `view-self-evolution` sections and their nav buttons from `ui/index.html` and the `switchTab` branches in `ui/app.js`; the backend routes stay available for auditing.
- Feature-only: disable `selfEvolution.enabled` from the Plugins page or directly in `config.json`; Notebook/Reflection data is preserved and stays readable.
