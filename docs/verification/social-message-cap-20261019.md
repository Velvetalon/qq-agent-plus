# Social Replyer Message-Batch Cap

Plan: `plan_doc/2026-10-19-social-message-batch-cap.md`.

## Change

The Social Replyer advertises the configured per-turn cap as `maxItems` on the
`send_message.messages` array alternative. Original messaging definitions and
schemas are unchanged. A host-owned wrapper first normalizes the proposed batch
with the existing `normalizeMessageList` implementation, then counts its physical
QQ text parts before invoking the underlying messaging tool.

The exported pure `prepareTextParts` helper in `src/onebot/sender.js` is used by
both this preflight (through a narrow host `countTextParts` closure) and actual
SendQueue delivery. It preserves the existing Markdown conversion, empty/object
filtering and Unicode-aware hard split behavior. The closure uses the sender's
current `send.hardSplitAt` and the same run's grounded `preserveCode` flag, rather
than counting only logical input entries. A single long string can therefore
exceed the cap and is rejected before any physical part is queued.

The remaining allowance is the per-turn cap minus the current host session's
`socialSendActions`, read through a narrow host closure. The plugin's messaging
session facade intentionally does not expose this counter, so reading that
facade alone would incorrectly ignore prior sends.

An oversized batch returns `SOCIAL_MESSAGE_BATCH_LIMIT`, `sent: 0`, requested
count, remaining count, and explicit instructions to let the model compress its
own answer and issue a new bounded call. With no remaining budget it says to
stop, not retry. Feedback explicitly explains physical splitting and that simply
merging array entries may still exceed the cap. The cap wrapper never merges,
truncates or rewrites model text; the existing sender's presentation conversion
is unchanged. All per-send safety guards and unknown-outcome behavior remain
unchanged.

## Verification

`node --test test/social-message-cap.test.mjs`: **11 tests passed**.

- Five proposed messages: **zero underlying executions**. Model-compressed
  three-message arguments pass through by object identity, unchanged.
- Two earlier visible actions leave exactly one; a two-message batch is rejected
  atomically, a single string succeeds, and exhausted budget rejects further text.
- Counting matches the actual messaging normalization, including encoded arrays,
  blanks and supported legacy text-object shapes.
- Array schema reflects the configured cap without mutating the original schema
  or unrelated tool definitions.
- Real Orchestrator → scoped plugin tool context → SendQueue integration:
  five-message call enters **no outbox and makes no protocol call**, returns
  actionable feedback to the next model turn, then delivers its rewritten three.
- Real integration with prior sends: two confirmed messages remain intact; a
  subsequent two-message call enters no additional outbox, then the model's
  replacement one-message call succeeds. Final host accounting is exactly three
  successful effects, zero failed effects and no partial-delivery invalidation.
- Pure shared preparation covers Markdown removal, preserved code, empty and
  malformed-object filtering, newline splits and Unicode surrogate boundaries.
  A callback test verifies normalization precedes physical counting while the
  underlying tool receives its original arguments unchanged.
- Real Orchestrator/SendQueue with `hardSplitAt: 4`: one 16-character string
  requires four physical messages and creates **zero outbox entries and zero
  protocol calls**. The model then supplies a shorter 12-character replacement,
  delivered as exactly three physical parts, without prefix truncation.
- The same real integration with grounded code preservation correctly counts
  four physical parts where legacy Markdown conversion would yield only three.
  It rejects all four before delivery, then accepts the model's shortened text.
- With two prior confirmed sends and a four-character split limit, an eight-
  character string is rejected with one remaining action; the model's four-
  character replacement is delivered as exactly one physical message.

Joint focused command:

```sh
node --test test/social-message-cap.test.mjs test/social-runtime.test.mjs \
  test/social-participation-prompt.test.mjs test/send-failure-outcome.test.mjs
```

**70 tests passed**, including queued-source/runtime permission guards,
unknown/partial delivery handling, sender transport-failure classification,
scoped due-intent topic checks and the coordinating task's structural-repair
checks. Syntax and `git diff --check` passed. The coordinating task owns the final
aggregate run and real-model serious-help re-evaluation against this
implementation.

All tests use isolated temporary storage, synthetic model HTTP, and synthetic
OneBot send functions. No real credentials, provider request, QQ send, publication
or automatic retry of an uncertain external write occurred.
