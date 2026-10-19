# Standalone Embedding Settings Verification

## Scope

Permanent standalone console page; authenticated safe settings/test API;
NanoGPT `https://api.nano-gpt.com/api/v1` / `Qwen/Qwen3-Embedding-4B` / 2560;
profile isolation; private key persistence; truthful unavailable/degraded states.

Plan: `plan_doc/2026-10-19-embedding-settings.md`.

## Executed local checks

- `node --test test/embedding-settings*.test.mjs`: **10 tests passed**.
  - Config defaults, existing-profile preservation, secret masking, blank/masked
    key preservation, explicit clearing, destination/key binding.
  - URL/boolean/key/dimension/4B-versus-8B/threshold validation; profile isolation.
  - Actual fixed-text HTTP boundary, response shape/dimension, 401/403/429/503,
    timeout/cancellation, no credential/provider-body disclosure.
  - Real `createApp` authenticated API, forbidden origin/query-token writes,
    unrelated-config isolation, 0600 persistence, repeated operations, rollback
    on plugin restart failure, stop/load/start persistence, disabled/unconfigured
    console health, no fake successful probe.
  - Executed DOM handlers for save/test/error/cancel/repeat/refresh/navigation,
    password clearing, and ignoring late responses after cancellation/navigation.
- Focused regression command below: **20 tests passed**.
- `node test/render-test.mjs`: **138 checks passed**.
- Syntax checks for changed JavaScript modules and new browser script: **passed**.
- `git diff --check`: **passed**.

```sh
node --test test/embedding-settings*.test.mjs \
  test/functional-repair.test.mjs test/notebook-ready-vector.test.mjs \
  test/social-vector-app.test.mjs test/self-evolution-vector-persona.test.mjs
```

## Native Chromium acceptance

Run `node test/browser/embedding-settings.mjs` in the native execution environment.
It uses real `createApp`, a private temporary Chromium profile and data directory,
synthetic-only credentials, intercepted model HTTP and blocked QQ sends. It
verifies actual UI flows including browser reload and real app restart, plus
1440px desktop and 390px mobile layout. It writes `result.json`, `desktop.png`,
`mobile-top.png` and `mobile-controls.png` in the evidence directory it prints.
Failures write `failure.json`; lifecycle cleanup waits for Chromium termination.

Native Chromium execution: **PASS**, 2026-10-19, six acceptance groups:

1. Permanent page, exact defaults, and unconfigured diagnostic with zero provider
   requests.
2. One save under duplicate clicks, masked key/blank preservation, isolated fields
   and cancellation without mutation.
3. Invalid dimensions and destination changes rejected; malformed vectors and
   HTTP failure reported truthfully; recovery succeeds.
4. One in-flight diagnostic, real abort reaches the mocked provider boundary,
   cancellation resets the draft, and navigation removes secret input.
5. Refresh/browser reload restore saved values; real app stop/load/start retains
   the key and profile while resetting health to unverified.
6. 390px mobile actions remain reachable without horizontal overflow; clearing
   the key disables semantic recall without blocking the console or making calls.

Observed counts: 4 save requests, 7 test requests, 4 mocked embedding requests,
1 propagated abort, **0 external network calls**, **0 QQ sends**, and **0 browser
exceptions**. Both page and form horizontal overflow were 0 pixels. Desktop and
390px screenshots were visually inspected: labels, gateway/model fields, masked
key state, advanced control and primary actions remain legible; mobile actions
wrap rather than overflow.

Evidence is retained outside Git in the coordinating task's
`embedding-browser/` artifact directory: `result.json`, `desktop.png`,
`mobile-top.png`, `mobile-controls.png`, plus `embedding-browser.log`.

## Final security-focused review

- The public settings payload is allowlisted, and the general configuration API
  also redacts the legacy embedding `key` alias. Actual synthetic-key API tests
  verify that neither endpoint exposes it.
- Blank/masked edits preserve a saved key; clearing also removes the old `key`
  alias. No key is returned to password inputs, localStorage, ordinary logs, test
  results or screenshots.
- Reusing a saved key at a changed gateway is rejected before HTTP or persistence.
  URL-embedded credentials/parameters/fragments are rejected; provider redirects
  are not followed. A replacement key or explicit clearing is required.
- Probe payloads contain only the fixed public sentence, not saved document
  prefixes or real notes. Provider bodies/errors are not echoed. Cancellation
  does not overwrite the previous health result with a provider-failure claim.
- Save/test operations are authenticated and serialized. Save reload failure
  restores the prior configuration. Private-file persistence and restart profile
  consistency were rechecked; the restart API test passed three consecutive runs.

No remaining issue was found in the focused review. These claims cover this
settings module and tested paths, not a repository-wide security audit.

## Boundaries

The settings-page tests used synthetic credentials only: no production key was
read or persisted by these tests, and no external model request or QQ send was
made. Separate authorized live-provider validation and the final aggregate
regression are recorded in [the combined verification](real-model-replay-20261019.md).
A successful mocked settings probe alone is not evidence of real recall quality.
The combined work is archived and committed locally, not pushed or deployed.
