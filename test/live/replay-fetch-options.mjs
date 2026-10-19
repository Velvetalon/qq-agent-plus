/** Node fetch rejects dispatcher:null; direct requests must omit the option. */
export function replayProxyOptions(dispatcher) {
  return dispatcher ? { dispatcher } : {};
}
