# Continue B07 / R06 / B10: evidence-grounded semantic send review

The user explicitly requires continuing the three open real-model gates. Prior
prompt-only refinements were insufficient: actual delivery checked exact text
duplicates, not equivalent jokes, while personal factual claims had no evidence
check. Do not change the selected model, weaken cases, or count silence as repair.

## Implementation plan

1. Assemble a host-owned evidence view, separating human experience, actual prior
   bot utterances, retrieved memories, tool receipts and the new draft. Persona
   text is style, never a factual source. Include recent bot utterances across
   topic reassignment so a new topic ID cannot reset novelty.
2. Review the complete normalized `send_message` batch before enqueue, not each
   physical fragment. Use the currently configured chat model, no tools, no
   fallback/retry, a strict bounded verdict with evidence IDs/quotes for factual
   self claims. Opinions, clearly hypothetical humor and honest chat recollection
   remain allowed. Fail closed on malformed/unknown evidence or unavailable review.
3. Give concrete rejection feedback to the original Replyer for bounded revision;
   never rewrite or synthesize sends in the host. Retain the ordinary last-moment
   permission/source/withdrawal/unknown-delivery gates after this asynchronous check.
4. Bound review to four calls and two rejected drafts per turn, 768 output tokens
   and 15 seconds per call, within existing token/time/exploration budgets. Record
   approval/rejection/revision, final sent/no-acceptable-output, calls and latency.
5. Test positive sourced experiences and harmless first person, semantic repeats,
   missing/forged/self-circular sources, malformed responses, timeout/abort, budget,
   sequential tool batches, cancellation during review and zero-enqueue rejection.
6. Re-run the original specified-model cases plus independent challenge/positive
   cases. Report acceptable reply rate separately from deliberate natural silence;
   preserve every failed draft and unsuccessful run outside Git. Then full offline
   regressions and independent review. No production QQ/deploy or premature push.
