# Social Replyer: reject oversized batches before any send

## Problem

A model can emit five `send_message.messages` entries despite a three-action
host limit. Per-message delivery guards then deliver the first three and reject
the last two, leaving a partial answer. Keep those guards, but reject an oversized
text batch atomically before the underlying messaging tool executes.

## Plan (before implementation)

1. Extend `socialReplyerTools` with the current per-turn cap. Clone only the
   messaging tool schema and add `maxItems` to its messages-array alternative.
   Preserve the original tool definitions and schemas.
2. Wrap the social Replyer `send_message.execute` boundary. Count using the same
   `normalizeMessageList` function as the underlying tool; compare the count with
   cap minus the current `session.socialSendActions`. If too large, return a
   structured, zero-sent tool error telling the model to compress its reply and
   issue a new bounded call. Never merge, truncate or rewrite model text.
3. Change only the corresponding `socialReplyerTools` invocation in Orchestrator
   to pass its configured cap. Keep send-time guards and unknown-outcome handling.
4. Add independent unit tests and a real Orchestrator/SendQueue integration test
   with synthetic HTTP and OneBot boundaries. Cover 5 rejected/0 executions,
   compressed 3 accepted, remaining 1 after 2 prior sends, strings and normalized
   legacy shapes, and immutable original schemas.

No real provider calls, credentials, QQ sends, commits or publication. Do not
modify the parallel task's prompts, social-runtime test or other Orchestrator
logic. Run focused regressions and report exact outcomes.

## Follow-up: physical QQ text parts (plan before implementation)

Review found that one normalized entry may become several physical messages when
`send.hardSplitAt` is configured. Counting input entries alone still allowed a
prefix to be sent before the final per-send guard exhausted the cap.

1. Extract a pure exported `prepareTextParts(messages, options)` from SendQueue's
   existing Markdown conversion, empty/object filtering and QQ splitting. Keep
   the transformation and send-time guards unchanged; SendQueue itself must use
   the same helper.
2. Pass a narrow host-owned `countTextParts` closure into `socialReplyerTools`.
   It uses that helper with the sender's current `send.hardSplitAt` and the same
   run's `behaviorProfile === 'grounded'` preserve-code flag. Only add the helper
   import and this parameter to Orchestrator; do not touch parallel repair logic.
   Normalize messages once for counting, but pass original arguments unchanged.
3. Explain physical-part counts in the zero-sent rejection so the model can
   shorten its own text rather than merely merge array entries. Keep array schema
   limits as an additional hint; do not mutate or truncate model content.
4. Test helper/count/send equivalence including Markdown, preserved code, blanks
   and Unicode boundaries. Exercise real Orchestrator/SendQueue with non-default
   `hardSplitAt`: oversized string produces no outbox/protocol calls, then a
   model-shortened replacement succeeds. Re-run existing unknown/partial outcome
   and delivery-gate regressions, all with synthetic boundaries.
