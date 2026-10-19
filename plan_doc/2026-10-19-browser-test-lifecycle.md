# Browser verification process lifecycle repair

Date: 2026-10-19. Baseline: `dc012094febc8521b5253592c854f7b0910db0b3`.

The current task-card recheck independently passes 750 unit tests and the other
non-browser local gates. The Chromium verification cannot complete in the
restricted executor: Chromium terminates with a signal after a Unix socket
permission error, then the script waits forever in cleanup because it checks
only `exitCode === null` and attaches an `exit` listener after termination.
This is a verification harness defect, not evidence that product UI failed.

Repair only the browser harness lifecycle: record spawn/error/exit outcomes as
soon as the child is created; bound readiness and shutdown; recognize signal
termination; do not wait for an already-emitted event. Add deterministic unit
regressions without launching a browser or contacting external services.

Re-run all local gates on the final changes, including the real headless
Chromium test when the executor allows the required local IPC. Keep semantic
model replay, real QQ effects, and SC8 production operations separate and
NOT_RUN. Do not change model providers, credentials, product behavior,
permissions, production data, deployment, main, tags, or releases.

## Additional reproduced local gate defect

A final full-suite rerun was stopped by execution review when the historical
`price-probe` fixture unexpectedly requested `https://data.example.com`.
`initChannelPrices` refreshes stale cache asynchronously, but that test only
injected fetch into its earlier explicit refreshes, not the startup path.
The related `price-feed` restart case also left default fetch reachable.
Fix these test boundaries, not the network permission: deny unconfigured global
fetch in both files, explicitly script their background startup response, await
completion, and retain/strengthen cache-revocation assertions. No retry of the
rejected external request is authorized or needed.
