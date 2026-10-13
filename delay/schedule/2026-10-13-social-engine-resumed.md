# Social Engine Resumed Development

Date: 2026-10-13 (Asia/Hong_Kong).
Baseline: `8233c83c5839a4e8fcc563302769d3569898332a`.
Original WIP handoff remains in `2026-10-13-social-engine.md`.
User explicitly requested takeover and continued work.

## Current Scope

SC0-SC7 local implementation and verification. No production access,
deployment, cleanup, mode changes, unmute, QQ send, real LLM/embedding call,
release. The 2026-10-14 user request separately authorizes a WIP commit and
push to the user's GitHub only; it does not authorize deployment.

Latest save/handoff:
[2026-10-14 GitHub WIP](2026-10-14-github-wip-handoff.md).

Frozen implementation contract:
[social-takeover-contract-v1](../../plan_doc/2026-10-13-social-takeover-contract-v1.md).
The original full design/development/acceptance documents remain authoritative
for product requirements; v1 clarifies actual integration boundaries.

## Owners

下方为原工作流范围；2026-10-14 执行者容量受限后已停止，
剩余文件由主协调者单独修复并冻结。独立复核只读，无其他写入者。

- Runtime writer: conversation modules, Orchestrator, context, Sender and
  main-chain/state/delivery tests; core/store.js only for preserving v3
  completion fields through the existing event queue.
- Memory writer: self-evolution, Manager, Notebook plugin, cleanup CLI and
  memory/learning regression tests.
- Coordinator: console/config/session UI, API integration, plans and progress.
- Independent review: read-only on each completed candidate, no code writes.
- Existing untracked `NEED_HELP.md` is preserved; the archived patch is not
  applied. Credentials and raw production data remain outside Git.

## Progress

| Stage | Status | Evidence / Remaining |
| --- | --- | --- |
| SC0 | PASS | Real source audit, baseline commands and explicit v1 contract before writer dispatch |
| SC1-SC3 | FOCUSED_PASS / PARTIAL | v3 queue, reply/share/image handoff, due tick, guarded delivery and source retention verified; explicit configured-interest ingress and full matrix remain |
| SC4-SC5 | FOCUSED_PASS / PARTIAL | episodes, independent candidates, subject isolation, review/CAS, material revocation and cleanup verified; full matrix remains |
| SC6 | LOCAL_PASS | protected management, disabled history/lazy reads, migration/restart/fallback, render and mobile checks pass |
| SC7 | INCOMPLETE / FULL_UNIT_FAIL | focused 248 PASS and independent 35 PASS; full unit 660 PASS/45 FAIL/3 SKIP; full coverage and behavior replay not closed |
| SC8 | NOT_AUTHORIZED | No production changes |

## Verification Ledger

- State/config/console baseline: 17 PASS, exit 0.
- Shared focused baseline: 90 PASS, 23 FAIL, exit 1. Failures include old
  learning/auto-apply assumptions, plugin context expectation and Windows
  EBUSY fixture cleanup. This is the WIP baseline, not an acceptance pass.
- Coordinator P7 + social UI contract tests: 12 PASS, exit 0.
- Existing render execution: 138 PASS, exit 0.
- Chromium UI QA: 1440x900 and 390x844, no page-width overflow or script
  errors; mobile table scroll reaches adoption/rejection controls.
- Current logs/screenshots are intermediate artifacts in the chat's `work/`
  directory, not production evidence or real-model behavior.
- Main-chain learning test found schemaVersion lost in the durable extension
  queue. V1 ownership extended narrowly to the host Store so real claimed
  events retain provenance; no fabricated test-field repair is allowed.
- 2026-10-14 continuation: previous writer restores hit capacity; coordinator
  interrupted pending writers and exclusively completed remaining local fixes.
- Repaired lost material metadata and silent eight-ref truncation, wrong-CAS
  candidate poisoning, evidence-pool budget starvation and fragmented fresh
  candidate cycles. No evidence threshold or safety assertion was weakened.
- Final explicit 34-file combined regression: 248 PASS, 0 FAIL, 0 SKIP,
  exit 0. Independent runtime/memory audit: 35 PASS, no P1/P2 finding.
- Final evidence and reproducible command:
  [local verification checkpoint](../../docs/verification/social-engine-closure.md).
  This is not complete SC7 acceptance, live-model evidence or deployment approval.
- Full top-level unit verification: 108 files, exit 1, 708 tests:
  660 PASS, 45 FAIL, 3 SKIP. Failures include platform/cleanup and prompt
  assertions; individual root-cause and baseline attribution remain open.
- Latest user instruction freezes implementation for a complete unfinished-code
  GitHub checkpoint; no further failure repair was started before this snapshot.

## Acceptance Boundary

Do not declare SC7 or full natural-dialogue effects accepted until main-chain
tests, all owned regression fixes, isolated material/candidate races and an
independent review have completed. Mock dialogue only proves wiring, not
naturalness. Real-model and QQ behavior remain LIVE_NOT_RUN.
