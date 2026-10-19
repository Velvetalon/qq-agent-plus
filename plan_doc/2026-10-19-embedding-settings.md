# Required embedding capability: standalone settings

## Scope and invariants

- Add a permanent Embedding console page, independent of experimental settings.
- Default to NanoGPT `https://api.nano-gpt.com/api/v1`, model
  `Qwen/Qwen3-Embedding-4B`, dimension 2560. Preserve existing profiles and
  explicit runtime switches; never silently enable external note/query traffic.
- New configurations use a conservative maximum cosine distance of 0.5;
  expose the threshold under advanced settings without changing existing values
  or claiming a generalized semantic-accuracy guarantee from small samples.
- Reuse the existing private `config.json` persistence (0600). Return key
  presence only, never key text; blank/masked edits preserve the stored key.
- Bind stored-key reuse to its saved endpoint. Changing gateway requires a
  replacement key or explicit clearing, not accidental transmission elsewhere.
- Authenticate save and test routes, validate before mutation, restart only
  affected runtime and roll back configuration on restart failure.
- A diagnostic test sends only a fixed synthetic sentence, checks actual
  response shape and dimension, and reports sanitized failures. Saving is not a
  successful connectivity test. Unconfigured/degraded recall does not block the
  console or ordinary chat.
- Profile changes isolate old vectors. Do not mix 4B/2560 and 8B/4096 vectors.

## Implementation plan (archived before changes)

1. Add an owned embedding settings/validation module with safe public views,
   NanoGPT defaults, endpoint/key guards, profile consistency and probe errors.
2. Wire GET/POST settings and POST diagnostic API into the console. Preserve
   unrelated unsaved settings and the existing runtime restart mechanism.
3. Add standalone navigation and form with password-only key input,
   save/test/cancel/refresh, pending-state guards and truthful status text.
4. Verify isolated synthetic settings/unit/app/UI tests: invalid fields,
   authentication, blank/masked keys, destination changes, dimension mismatch,
   HTTP failures/timeouts, duplicate clicks, cancel/navigation, refresh/restart
   persistence, and no credential disclosure. Run affected regression suites.
5. Document local verification and operating steps. Real NanoGPT calls,
   production credentials, deployment, QQ sends, commits and pushes are excluded.

## Acceptance boundaries

Offline tests may mock only the external HTTP boundary, using synthetic keys and
temporary data directories. Existing real-model replay belongs to the parent
task. Native UI access must be coordinated with that task before use.
