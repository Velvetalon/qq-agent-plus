# Independent F4 review correction

The parent explicitly requested a separate reviewer for fixed implementation commit
6ae135a9dff17eb309b3ec4989faaa063834e7b2. Earlier wording in task-card-closure
incorrectly called the implementer recheck independent; rename it implementer
self-review without changing its historical test results.

Use an authorized independent collaboration subagent to examine the original
F4 spec, source diff, changed test assertions and three-consumer regressions.
Reviewer is read-only and may run isolated synthetic tests; no server, credentials,
live QQ, real model or paid calls. Record reviewer identity/task and commands,
findings, fixes and focused/full verification appropriate to any actual changes.
Do not claim approval before review returns. Push corrections on the existing
draft branch, never merge or force-push.

Reviewer reproduced a pre-dispatch race: authorizeQuery may yield, configuration
is revoked, but old embedQuery still executes once before the response guard.
Add post-authorization/pre-dispatch and post-response snapshot checks including
same-profile query-policy changes, with zero-request assertions. Reviewer also
is checking Reflection's prefix truncation against latest-target retention.

Independent reviewer /root/independent_f4_review confirmed P1/P2, independently rechecked fix 78dd7683ac4063d2844e810b5c0eb452788b1724 and passed 93 focused tests. Review provenance/results recorded in delay/schedule/2026-10-16-f4-independent-review.md.
