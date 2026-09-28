# Functional Repair PR2 Verification

- Scope: persistent embedding jobs, single background consumer, lease/profile/revision checks, bounded retry, pure semantic query, admin retry endpoint.
- Status: PASS for local sqlite-vec and controlled embedding boundaries; `LIVE_NOT_RUN` for real provider.

## Evidence

- `VectorMemory` now persists profile, lease, retry, availability and blocked metadata; late results recheck lease, note revision/hash, profile and current client.
- `NotebookStore.semanticSearch()` no longer drains document jobs.
- Notebook plugin starts/stops the worker with its lifecycle; query cancellation does not own the worker.
- `/api/self-evolution/embedding/retry` is authenticated and bounded.
- `test/functional-repair.test.mjs`: pending index does not cause document/query HTTP; first temporary failure retries and reaches ready.
- `scripts/sqlite-vec-smoke.mjs`: Node `v24.19.0`, SQLite `3.53.3`, sqlite-vec `v0.1.9`, cosine smoke PASS.

## Commands

- Focused self-evolution suite including vector/notebook/retrieval/reflection: PASS, 58/58.
- `node --test test/p7-console-observability.test.mjs test/plugin-app-start.test.mjs test/orchestrator.test.mjs`: PASS, 50/50.
- Real network outage/recovery against provider: controlled fake HTTP only; `LIVE_NOT_RUN` for external service.
