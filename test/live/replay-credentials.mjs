import fs from 'node:fs';

/** Live opt-in credential source; never creates a credential file or echoes it. */
export function readReplayKey(env = process.env) {
  const fromEnvironment = Object.hasOwn(env, 'QQ_REPLAY_API_KEY');
  const filename = env.QQ_REPLAY_KEY_FILE;
  if (fromEnvironment && filename) throw new Error('Choose one replay credential source, not both');
  let raw;
  if (fromEnvironment) raw = env.QQ_REPLAY_API_KEY;
  else if (filename) {
    try { raw = fs.readFileSync(filename, 'utf8'); }
    catch { throw new Error('Cannot read the authorized replay key file'); }
  } else throw new Error('Explicit replay credential required');
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key || /\s/.test(key)) throw new Error('Expected a single nonblank replay credential');
  return key;
}
