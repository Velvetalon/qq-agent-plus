# Functional Repair PR1 Verification

- Baseline: `9069a4fcab93c4f3e8946fcc5318866ac3898fb3`
- Scope: host-owned embedding capability, credential isolation, explicit external authorization, config restart hook.
- Status: PASS for mocked HTTP/config boundary; `LIVE_NOT_RUN` for real provider.

## Evidence

- `test/functional-repair.test.mjs`: host capability hides `apiKey`, sends the test key only at HTTP boundary, and rejects `allowQuery=false` before HTTP.
- `src/plugins/manager.js` exposes only host capabilities, not raw config credentials.
- `src/console/app.js` creates the capability at composition root and restarts controllable self-evolution plugins when embedding configuration changes.
- `EmbeddingClient` rejects unsupported `apiKeyRef`, redacted/empty keys unless `allowAnonymous=true`, and treats explicit `allowQuery=false` as authoritative.

## Commands

- Node `v24.19.0` `node --test test/functional-repair.test.mjs`: PASS, 3/3.
- `node --check` on changed runtime files: PASS.
- Real embedding provider, billing, and production credentials: `LIVE_NOT_RUN`.
