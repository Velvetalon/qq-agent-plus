# Social configured-interest closure

Scope: existing SC3/SC6/SC7 and A-P04/A-I01/04/10/A-C/A-H contracts.
No server access, real QQ, paid models, new providers or automatic exploration.

Implement an account/chat-scoped, lazy SQLite configuration store for explicit
interest sources and exploration budgets. Protected management writes use the
host account, allowlist, body confirmation and whole-document CAS. Source IDs
are stable, revisions change on edits/disable; omitted sources are retained but
disabled. Reads of unused/disabled state create no tables. History is retained.

An administrator explicitly schedules one opportunity against a current source
revision and an existing verified active topic. It uses the existing durable
intent queue, cancellation, lease, restart and held/unknown protections. It does
not manufacture messages, human evidence or a perpetual timer. Source updates,
disable, expiry, closed topics and mode changes are checked again before model
calls and sends. Enabled settings alone never schedule work. Paused opportunities
remain pending until resumed or expired; terminal/unknown operations never replay.

Separate daily run/token reservations and per-run token/call limits are durable,
atomic and fail closed. Reserve a full run allowance before the first model call;
never refund an uncertain attempt or retry the provider invisibly. Token admission
uses the existing estimator plus bounded output; disclose that provider input
token accounting is not an exact monetary cap. Exploration remains subject to
existing runtime, time, concurrency, unread-message and unanswered-intent gates.

Use real createApp HTTP management, real Orchestrator/Manager/SQLite/Sender wiring
with only outer model/protocol mocks. Cover auth, cross-scope, CAS, revocation in
queue, budget exhaustion/reset, restart, cancel, empty tick and new-source recovery.
Add an operational UI for editing scoped sources/budgets, scheduling and cancelling
opportunities; exercise actual event handlers and desktop/mobile layout. Refresh
the acceptance ledger case by case, retaining LIVE_NOT_RUN where genuine external
behavior is necessary. Run Node 22 full gates and push the draft PR; no merge or
deployment is implied.
