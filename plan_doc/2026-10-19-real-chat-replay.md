# QQAgent real chat replay, 2026-10-19

## Scope and authorization

Use the already-existing NanoGPT credential transiently with the explicitly selected
`deepseek/deepseek-v4.1-flash-1017` chat model. Only synthetic conversations are sent.
No actual QQ delivery, production data, deployment, new persistent credentials or
embedding calls. The credential must never appear in source, logs, commands or Git.
The repository remains local-only until all task cards are complete or publication
is separately authorized.

## Implementation and evidence

1. Add an opt-in replay runner using the production Orchestrator, prompts,
   ChatStore, SocialStateStore and SendQueue. Replace only the OneBot protocol
   with a synthetic delivery sink; allow only the selected chat endpoint.
2. Enforce a maximum call count, input/output token budget, per-call timeout,
   total deadline, exact model and destination. First run a small connectivity
   case, then the bounded acceptance cases.
3. Cover A-P08/R02/R06 with actual conversational decisions/replies and A-M02/L04
   with the production reflection prompt/worker where feasible. Evaluate A-B01–12
   from actual captured decisions and output, not expected model mocks. Record
   failure and partial/not-run coverage explicitly. Keep all six naturalness
   dimensions and concrete severe failure conditions visible.
4. Embedding is an opt-in long-term Notebook semantic retrieval capability, not
   a chat prerequisite. B11 cross-session automatic semantic recall remains a
   separate untested capability if embedding is disabled. Context retention or
   direct note reads must not be labeled vector-retrieval success.
5. Preserve sanitized synthetic fixtures/output, model identity, persona hash,
   timing, usage and available provider cost. Do not invent billing costs.
   Review the harness and rerun applicable offline tests after software changes.

## Limits

Single sequential model stream, at most 100 requests and 300,000 reported tokens
per run, at most 2,048 output tokens per request, 60-second request timeout and
30-minute total deadline. Input-size bounds additionally apply before requests.
No transport retries after uncertain outcomes; record the result first.

## Review-discovered product gap

The social prompt builder did not include `persona.participation`; low/high
configuration was therefore invisible to the Planner. Add a bounded soft-preference
sentence to the production identity prompt, explicitly subordinate to invitation,
relevance, unresolved need and the prohibition on unanswered self-follow-ups.
Test all three values and unknown-value fallback. This is not a fixed response
probability and cannot by itself prove the real-model semantic outcome.

## Connectivity observation

First canary made one dispatch attempt and returned `fetch failed` in 13 ms, with
no provider response or model output. The transport latched the failure and blocked
production retry attempts before network dispatch. An unauthenticated diagnostic
using the same configured proxy returned `ENETUNREACH` to that proxy; the shell
execution network cannot reach it. Native dot desktop route is the existing
supported execution environment and may be used after confirming the exact state.

Native canary reached the exact chat model with two HTTP 200 responses, but the
Replyer returned ordinary assistant text instead of a send tool, so no delivery
occurred. Strengthen the production prompt's explicit distinction between internal
text and visible tool-delivered output; preserve empty-output silence and Sender
guards. Do not synthesize a tool call from arbitrary model text. Rerun the canary.

After the real canary measured roughly 7,000 input tokens per phase under the
repository default persona, the full-run bound is 100 requests / 800,000 tokens
(including conservative admission reservations), 2,048 output tokens/request,
60 seconds/request and 30 minutes total. The canary stays at six requests/100,000
tokens. This enables the bounded 17-ID scenario pass rather than silently truncating
at a budget chosen before measuring actual prompt size.

## User expansion: required embedding capability

The user subsequently made QQAgent embedding a required product capability and
selected NanoGPT `Qwen/Qwen3-Embedding-4B`, 2560 dimensions, using the same existing
credential. Add a separate settings page under the existing secure configuration
mechanism. Do not copy a real key into persistent QQ configuration as a side effect
of these tests. Perform the real synthetic Notebook write/index/reopen/semantic
search pipeline with an in-memory credential, plus scoped leakage and profile-change
checks. The small labeled Chinese fixture calibration must be reported as local
calibration, not a universal Chinese semantic quality guarantee. Bound this pass
at 32 embedding requests, 50,000 input characters, 60 seconds/request, 10 minutes.

Full replay found a substantive technical answer split into five messages while the
host permits three; the guard correctly rejected the tail. Expose the same current
host message cap in the Replyer prompt (without relaxing the guard), so serious
answers can be consolidated rather than cut off. Repeated meme stimuli also reused
a prior punchline; clarify novelty evaluation while preserving react/listen options.

B12 surfaced repeated answers to an earlier already-answered question despite a
correct new Planner target. Mark current target messages separately from historical
background in the real Replyer input, and prohibit replaying already-delivered old
answers. Keep history available for genuine references, not as a new request.

## Second real-run repair scope

The configured-interest fixture incorrectly chose the latest active topic rather
than the topic containing its shared-interest anchor. Correct that fixture binding.
Production also omitted the due intent's topic ID from the Planner prompt, allowing
an otherwise known topic to be selected and rejected only at dispatch. Show the
exact authorized topic and reject mismatches before message reassignment/Replyer;
retain all existing lease/scope guards. Add prompt and real-Orchestrator unit
regressions for both permitted and mismatched topic selections.

The image fixture supplied real PNG media but omitted the `[图片]` text marker
normally added by OneBot extraction. Correct the synthetic ingress, retain the real
get_message_images/visual-model path, and check actual image payloads. The earlier
no-image replies are not B07 visual-semantic evidence.

The integrated real embedding replay indexed successfully, but the first semantic
query was cancelled by the context-provider's fixed 5-second timeout (the prior
real indexing request took 5.1 seconds). The embedding client's explicit 60-second
bound was never reachable. Align the outer retrieval deadline to the bounded
client ceiling plus cleanup margin, cap client timeout at 60 seconds, and test
slow-but-successful query collection separately from genuinely failed providers.
The aborted request remains recorded as unknown provider billing, not successful
recall; do not silently fall back to a fake vector or a keyword-only PASS.

Vision admission keeps the same total 800k token and 100-call ceilings, but permits
up to 128,000 UTF-8 bytes of reserved input/output per request (formerly 60,000)
so the real source-grounded PNG payloads fit alongside the default long persona.
This remains a conservative byte reservation, not a fabricated vision token count;
provider-reported actual usage replaces the reservation after each successful call.

The final public-share run preserved correct topic scope but still failed strict
source validation: the model returned a string ID instead of a full source-ref
object, and the repair prompt omitted the actual object schema and allowed topic
IDs. Supply the exact object contract and host-allowed topics/human IDs to the one
bounded repair call; require exact unique ID matching and preserve original
participation intent. Do not weaken the validator or synthesize a model share.

Real vision is now confirmed by actual image_url payloads and HTTP 200 responses,
but B07 still failed: the second image elicited the same punchline with a synonym.
Keep that failure; reinforce the Replyer's final already-sent summary and actual
novelty check, and repeat the same instruction after image-tool observations so
fresh visual input does not displace the current goal/history. No host-side output
rewriting, filtering into a false PASS, or fixture change is allowed.

Independent review also found replay audit attribution could read a prior case's
persisted latest SessionRegistry entry or a waiting follow-up. Record all new IDs
per wake/tick, select only a new Social audit, and emit null when no new run exists.
A separate unit verifies both historical leakage and waiting-session selection.
Integrated embedding calls now share the same absolute 30-minute run deadline.
