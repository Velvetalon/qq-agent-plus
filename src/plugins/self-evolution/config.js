function rawSelfEvolutionConfig(config = {}) {
  return config?.selfEvolution
    || config?.plugins?.selfEvolution
    || config?.plugins?.['self-evolution']
    || {};
}

/**
 * Single effective-switch calculation for all self-evolution entry points.
 * Reflection preserves its historical default-on behavior under the master
 * switch; retrieval remains explicit opt-in.
 */
export function selfEvolutionConfig(config = {}) {
  const selfEvolution = rawSelfEvolutionConfig(config);
  const retrieval = selfEvolution.retrieval && typeof selfEvolution.retrieval === 'object'
    ? selfEvolution.retrieval
    : {};
  const reflection = selfEvolution.reflection && typeof selfEvolution.reflection === 'object'
    ? selfEvolution.reflection
    : {};
  const enabled = selfEvolution.enabled === true;
  return {
    enabled,
    notebookEnabled: enabled,
    retrievalEnabled: enabled && retrieval.enabled === true,
    reflectionEnabled: enabled
      && (reflection.enabled === undefined || reflection.enabled === true),
    retrieval,
    reflection,
    raw: selfEvolution
  };
}
