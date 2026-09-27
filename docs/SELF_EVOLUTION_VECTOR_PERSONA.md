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
