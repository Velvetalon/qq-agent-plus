# Opt-in real-model validation

These scripts are excluded from the ordinary test suite. They send only the
checked-in synthetic fixtures to the exact user-selected NanoGPT models. They do
not instantiate OneBot or send QQ messages. All outputs and runtime SQLite files
must remain outside the checkout, and no real key is saved to QQ configuration.

## Current user-selected profile (2026-10-20)

Testing and future production use NanoGPT chat `qwen/qwen3.8-27b-uncensored:thinking` with `api.thinking='on'`, no fallback to another model, and embedding `Qwen/Qwen3-Embedding-4B` / 2560 dimensions. The replay explicitly preserves native thinking rather than sending the usual chat thinking-off flag. This does not change any existing production configuration or authorize SC8 deployment/QQ sends. Earlier DeepSeek results remain historical evidence, not acceptance for this new model.

### Bounded review settings

The replay explicitly sets `conversation.social.reviewMaxOutputTokens=2048` and `reviewTimeoutMs=45000` for this thinking model. Requests, output-token admission and the per-request timeout use the same immutable run limits; the existing whole-run deadline and token/exploration budgets still apply. Before an authorized future deployment, use the same explicit settings rather than relying on old defaults:

```json
{"conversation":{"social":{"reviewMaxOutputTokens":2048,"reviewTimeoutMs":45000}}}
```

Existing installations keep the old defaults (768 tokens / 15000 ms). Valid ranges are 128–4096 output tokens and 1000–60000 ms; invalid types/nonfinite values use defaults. Saving, reloading and direct runtime injection use one bounded policy. This documentation does not change production configuration. Truncated/filtered verdicts remain rejected as `REVIEW_INCOMPLETE`, and malformed JSON is never repaired into approval.

## Chat and integrated reflection/Notebook replay

Run `social-chat-replay.mjs` with Node 22.13+ and these explicit environment inputs:

- `QQ_REPLAY_LIVE=qwen/qwen3.8-27b-uncensored:thinking`
- `QQ_REPLAY_API_KEY`: the authorized key supplied only in the process environment, **or** `QQ_REPLAY_KEY_FILE`: an existing authorized raw-key file. The two inputs are mutually exclusive. No script creates a key file; both credential environment variables are removed after the key is read (the original file is not deleted).
- `QQ_REPLAY_OUTPUT`: a new evidence directory outside this repository.
- `QQ_REPLAY_CASES`: optional comma-separated IDs from `social-chat-fixtures.json`.
- `QQ_REPLAY_CANARY=1`: first case only, six calls / 100,000 token admission cap.

Full runs allow at most 100 sequential chat requests, 800,000 reported/reserved
tokens, 128,000 conservative UTF-8-byte admission reservation per request, 2,048
output tokens per call, 60 seconds per call and 30 minutes total. Known and unknown
transport failures latch shut; there are no automatic dispatched retries. A run
that exhausts its budget or loses transport is partial/failed, never PASS.

Image fixtures use the real message-image tool and real model image payloads.
The synthetic public bulletin is an explicit read-tool fixture, not a claim to
have fetched a real project announcement. B04 injects withdrawal only after a
Replyer HTTP request has started. Memory cases use separate ChatStores but reopen
the same persistent Notebook; old conversation text is not injected as memory.
Embedding cases separately permit at most 32 fixed-profile requests and 50,000
synthetic input characters. All other node:http(s) and global fetch paths fail
closed. The configured existing HTTP proxy may be used without changing network
settings. Keys/headers are never included in evidence.

## Standalone embedding calibration

`notebook-embedding-replay.mjs` has its own explicit opt-in variables documented
at the top of the script. It exercises actual 4B/2560 indexing, close/reopen,
retrieval, a small labeled Chinese calibration set, held-out cases and profile
isolation. Direct fixture note insertion in this script is not evidence for the
chat-completion/reflection writing chain; the chat memory cases cover that chain.

## Interpreting evidence

`EXECUTED_REQUIRES_SEMANTIC_REVIEW` means actual outputs exist, not that the case
passed. Review decisions, outputs, tool errors, retrieval/profile evidence and
provenance. Report provider usage/cost as returned; missing cost is unknown, and
reported zero cost is not proof that the provider invoice is zero. Never replace
failed live calls with synthetic vectors or mocked model output to obtain PASS.
