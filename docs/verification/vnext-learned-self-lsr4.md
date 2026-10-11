# Learned Self LSR4 Verification

Date: 2026-10-11 (Asia/Hong_Kong)  
Scope: profile metadata/TTL, correction, injection closure, metrics, and
management routes.

## Commands

| Command | Exit code | Result |
| --- | ---: | --- |
| `E:\node22\node.exe --test test\learned-self-injection-closure.test.mjs` | 0 | PASS |
| `E:\node22\node.exe --test test\p7-console-observability.test.mjs` | 0 | PASS |

## Actual Assembly Evidence

- New trait entries retain scope, source chat count, evidence count,
  created/last-observed timestamps, and finite `expiresAt`; legacy primitive
  entries remain readable.
- `getLearnedSelfContext` filters expired entries without deleting historical
  profile revisions. The provider exposes the metadata summary and reports
  expired counts without injecting full evidence text.
- `correctProfileTrait` appends a CAS-guarded revision for user/admin set/remove
  corrections. Historical versions and audit rows remain intact.
- Authenticated routes expose profile audit, correction, and bounded metrics:
  injection count, expired count, user-evidence ratio, assistant-only rejects,
  procedural rejects, and global promotions.
- Console route tests exercise correction, audit, and metrics through a real
  `createApp` instance.

## Status

- LSR4: PASS
- Profile cleanup against production SQLite: NOT_RUN
- Deployment: NOT_RUN
- Real model / QQ replay: LIVE_NOT_RUN

## Rollback

No production write or migration was performed. A correction can be reversed
through the existing append-only profile rollback/CAS path; expired data remains
in history.
