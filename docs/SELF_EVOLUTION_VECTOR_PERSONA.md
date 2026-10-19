# Self-Evolution Vector Persona

This experimental path keeps `notebook_notes` and `notebook_versions` as the
authoritative text store. `notebook_embeddings` and
`notebook_embedding_jobs` are disposable derived tables. They contain note
identity, revision, profile metadata, status, and a Float32 BLOB; they do not
copy note bodies.

## Runtime

The feature is still disabled unless `selfEvolution.enabled` and the relevant
retrieval/reflection switches are enabled. Embedding configuration is
independent and must contain a provider, endpoint, model, and dimension. The
remote service receives note text and semantic queries; configure only a
provider approved to process that data.

`sqlite-vec@0.1.9` is loaded from the locked dependency. A failed extension
load or incomplete embedding configuration leaves Notebook writes and ordinary
chat usable while vector recall reports an explicit unavailable reason.

## Dedicated Embedding Settings

Embedding is a required, permanent console capability with its own navigation
page, not an operational form hidden in Experimental Features. The page remains
available when the service or self-evolution runtime is disabled. Existing
installations are not silently opted into external note/query transmission.

New configurations default to provider `NanoGPT`, gateway
`https://api.nano-gpt.com/api/v1`, model `Qwen/Qwen3-Embedding-4B`, and **2560**
dimensions. Provider spelling and endpoint are part of profile identity; do not
substitute another hostname or the 8B/4096 profile and call it the same index.
New configurations use an exclusive maximum cosine distance of 0.5, editable
under Advanced Settings. This conservative starting value is not a guarantee
of semantic accuracy across real conversations. Existing profiles and thresholds
remain unchanged until explicitly edited.

The page owns provider, gateway, password-only API Key input, model, dimension,
distance threshold, runtime enablement and query/private-note permissions.
Operators may supply the same authorized key used by AACS, but the console does
not discover or copy credentials from another application. Stored keys are
represented only by presence/masking. Empty or masked input preserves a key;
an explicit clear action removes it. Changing the gateway requires a replacement
key or explicit clearing before save/test. Gateway URLs cannot embed credentials,
query parameters or fragments; embedding HTTP requests do not follow redirects.

Authenticated routes:

- `GET /api/embedding/settings`: safe settings, configured/disabled/unconfigured/
  unverified/verified/degraded status and current vector-runtime status.
- `POST /api/embedding/settings`: validates only embedding fields, preserves
  unrelated settings, persists through the existing private 0600 config file,
  and reloads affected plugins. Reload failure restores the old configuration.
- `POST /api/embedding/test`: tests a draft without saving. It sends only the
  fixed public sentence `QQAgent embedding connection test.`, validates response
  shape and dimensions, and never returns vectors, keys or provider error bodies.

Saving is not proof of connectivity. A successful diagnostic validates the
gateway response and dimension, not recall quality or ready index coverage.
The diagnostic can incur provider fees; no request occurs while disabled or
unconfigured. Cancel aborts the in-flight diagnostic, though a request already
received by the provider may still be billed. Duplicate in-flight operations are
rejected. Restart retains configuration/keys but resets diagnostic health to
unverified. Ordinary chat and the console stay accessible when embedding is
unavailable. Existing self-evolution and retrieval switches remain independent.

## Derived Index Lifecycle

Every append or update commits the note first and queues one pending index job.
Archive, delete, and a newer revision obsolete older jobs and vectors. Queue
processing is bounded and checks the current note revision again before writing
the remote result. A profile change isolates vectors by profile ID; no paid
historical backfill is started automatically.

Semantic recall filters account, scope, active status, current revision, and
profile in SQLite before ordering by `vec_distance_cosine()`. The same service
is used by automatic context retrieval, the semantic Notebook tool, and
reflection-related note input.

## Query contract

Automatic context, `notebook_search` with a nonempty query, and Reflection all
use ready vectors. Disabled/unconfigured embedding, missing indexes, cancellation
or provider failure never select lexical matches or the latest eight notes.
Ordinary scoped listing (`notebook_search` without query) and precise current
reads (`notebook_search` with `noteId`) remain available without embedding.
Exact reads return complete content and revision; semantic hits return snippets,
`isTruncated`, scope, chatKey, exact tags, distance and `rankingSource`.

Tags are exact values; scope and tags constrain ready candidates before a query
request. Search never consumes document indexing jobs. Cancellation and late
results from replaced profiles/clients are rejected. Reflection may continue
without old notes and records the degradation reason.

Embedding configuration accepts `maxQueryChars` (64–16000, default 4000) to bound
query text while retaining its latest end, and `maxDistance` (0–2, default 1) as
an exclusive cosine-distance cutoff. These are query policies, not vector
identity; changing them does not rebuild notes. Set the character bound to fit
the approved provider's actual input budget, accounting for configured prefixes.
The runtime fallback distance for existing profiles is **not calibrated semantic accuracy**. Diagnostics report
the bound/truncation and threshold; actual model calibration is LIVE_NOT_RUN.

## Rollback

Disable retrieval/reflection or remove the embedding configuration. Existing
Notebook text remains readable and writable. The derived tables may be left in
place or removed during a separately approved maintenance window; removing
them does not remove Notebook text or version history. Re-enabling the feature
rebuilds only newly queued revisions and never retries unknown external
message writes.

## Verification

Use the service runtime for the local smoke:

```powershell
E:\node22\node.exe scripts/sqlite-vec-smoke.mjs
E:\node22\node.exe --test test/self-evolution-vector-persona.test.mjs
```

The test uses a fake HTTP embedding boundary and real SQLite plus the real
sqlite-vec extension. A real embedding-provider semantic evaluation and
real-persona behavior evaluation require approved credentials and are
reported as `LIVE_NOT_RUN` when unavailable.
