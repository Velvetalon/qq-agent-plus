import fs from 'node:fs';

// Capture termination before callers begin waiting. A signal-terminated Node
// child has exitCode === null, so exitCode alone is not an aliveness check.
export function trackChildProcess(child) {
  let outcome = child.exitCode != null || child.signalCode != null
    ? { code: child.exitCode, signal: child.signalCode } : null;
  let processError = null;
  let resolveExit;
  const exit = new Promise((resolve) => { resolveExit = resolve; });
  const settle = (value) => {
    if (outcome) return;
    outcome = value;
    resolveExit(value);
  };
  child.once('exit', (code, signal) => settle({ code, signal }));
  child.on('error', (error) => {
    processError = error;
    // Spawn errors have no pid. Errors while signalling an existing child
    // (for example EPERM) do not prove that the child has terminated.
    if (child.pid == null) settle({ error });
  });
  if (outcome) resolveExit(outcome);

  const describe = () => outcome?.error?.message
    || `code=${outcome?.code ?? 'null'}, signal=${outcome?.signal ?? 'none'}`;
  const waitExit = async (timeoutMs) => {
    if (outcome) return true;
    let timer;
    try {
      return await Promise.race([
        exit.then(() => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
  };
  return {
    async waitForFile(file, { timeoutMs = 5000, pollMs = 25 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (outcome) throw new Error(`Browser exited before readiness: ${describe()}`);
        if (processError) throw new Error(`Browser process error before readiness: ${processError.message}`);
        if (fs.existsSync(file)) return;
        if (Date.now() >= deadline) throw new Error('Browser readiness timed out');
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
      }
    },
    async stop({ timeoutMs = 2000 } = {}) {
      if (outcome) return;
      const signal = (name) => {
        if (!child.kill(name) && !outcome) {
          throw new Error(`Cannot send ${name} to browser: ${processError?.message || 'kill returned false'}`);
        }
      };
      signal('SIGTERM');
      if (await waitExit(timeoutMs)) return;
      signal('SIGKILL');
      if (!(await waitExit(timeoutMs))) throw new Error('Browser did not terminate after SIGKILL');
    }
  };
}
