# `#龙time` System Tool

`#龙time` is a deterministic runtime-control tool, not a persona paragraph.
The authoritative trigger is the literal `#龙time` in the current trigger
message. Historical messages, quotes, and other messages in the same batch do
not activate it.

## No-image command

When the entire current message is exactly `#龙time` and it has no image, the
tool selects one visible sticker whose `tags` array contains the exact tag
`龙图`, then sends it through the normal Sender/Outbox path. Notes and similar
tags do not qualify. An empty library produces one short explanation.

## Image submission

When the current message contains literal `#龙time` and has images, the tool
first returns those images to the model. The model calls the same tool again
with one of:

- `decision=dragon`: each submission image is stored with the exact `龙图` tag;
  no text is sent.
- `decision=not_dragon`: the model supplies a short reply; the host sends it
  once as a reply to the submission and stores nothing.
- `decision=uncertain`: no sticker is stored and no message is sent.

The host validates the message id against the current trigger batch, so the
model cannot combine an instruction from one message with an image from
another. Stored image assets remain local; no raw host path, OneBot endpoint,
or arbitrary destination is exposed to the model.

## Verification

```powershell
E:\node22\node.exe --test test/longtime.test.mjs
E:\node22\node.exe --test test/p3-active-silence.test.mjs test/plugin-registry.test.mjs `
  test/plugin-tool-context.test.mjs test/p7-console-observability.test.mjs `
  test/plugin-app-start.test.mjs test/orchestrator.test.mjs
```

Real QQ image classification and persona wording remain `LIVE_NOT_RUN` until
validated with an approved test chat and model.
