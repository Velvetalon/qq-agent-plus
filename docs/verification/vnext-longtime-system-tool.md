# `#龙time` System Tool Verification

- Baseline before this change: `7ed9bf3`
- Scope: convert the live persona's `#龙time` protocol into a required built-in
  system plugin and tool.
- Result: PASS for local registration, routing, authorization, sticker tagging,
  image return, and decision handling.

## Implementation

- `src/tools/longtime.js`: current-message lookup, image refresh/loading,
  random exact-tag selection, local collection with `龙图`, and one-shot reply.
- `src/plugins/builtin/runtime-control-tools.js`: model-facing `longtime` tool.
- `src/plugins/builtin/longtime.js`: required `龙time` system-plugin registration.
- `src/plugins/context.js`: restricted host-bound `longtimeCommand` facade.
- `src/core/orchestrator.js`: binds the current trigger batch, chat, Sender,
  sticker store, OneBot, session, signal, and random source.

## Commands

| Command | Result |
| --- | --- |
| `node --test test/longtime.test.mjs` | PASS, 5/5 |
| `node --test test/longtime.test.mjs test/p3-active-silence.test.mjs test/plugin-registry.test.mjs test/plugin-tool-context.test.mjs test/p7-console-observability.test.mjs test/plugin-app-start.test.mjs test/orchestrator.test.mjs` | PASS, 74/74 |
| `node test/test-prompt.mjs` | PASS |
| changed-file `node --check` and `git diff --check` | PASS |

## Not Run

- Real QQ login/message replay for a live `#龙time` command: `LIVE_NOT_RUN`.
- Real model visual judgment quality: `LIVE_NOT_RUN`.
- Production deployment is performed separately after the commit is pushed.
