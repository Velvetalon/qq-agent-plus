// External embedding boundary fixture only: no claim about semantic accuracy.
export const fixtureEmbeddingConfig = { enabled: true, provider: 'fixture', model: 'fixture-2d', dimension: 2, allowQuery: true, allowPrivate: true };
const vector = (value) => /Bob/.test(value) ? [0, 1] : /unrelated/.test(value) ? [-1, 0] : [1, 0];
export const fixtureEmbeddingClient = { isConfigured: () => true, authorizeNote: async () => true, authorizeQuery: async () => true,
  embedNote: async ({ text }) => vector(text), embedQuery: async ({ query }) => vector(query) };
export async function indexFixtureNotes(store) { while ((await store.processEmbeddingQueue({ limit: 200 })).processed) {} }
