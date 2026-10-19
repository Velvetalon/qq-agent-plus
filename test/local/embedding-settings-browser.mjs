// Manual native-browser fixture. Every model/OneBot boundary is synthetic.
// Start with: node test/local/embedding-settings-browser.mjs
// No credentials are read from an existing config or environment.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-embedding-browser-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { DEFAULT_CONFIG, updateConfig } = await import('../../src/core/config.js');
const { createApp } = await import('../../src/console/app.js');
const config = structuredClone(DEFAULT_CONFIG);
config.server = { ...config.server, host: '127.0.0.1', port: Number(process.env.EMBEDDING_UI_PORT) || 3293, strictPort: true, token: '' };
config.onebot = { ...config.onebot, selfId: '888', wsUrl: 'ws://127.0.0.1:1', httpUrl: 'http://127.0.0.1:1' };
config.api = { ...config.api, baseUrl: 'https://embedding-browser-chat.invalid/v1', apiKey: '', model: 'synthetic-chat', priceRemoteUrl: 'none' };
config.memory.consolidateEnabled = false;
config.sticker.enabled = false;
for (const name of ['proactive', 'pacing', 'dailyMoments', 'qzoneInteractions', 'autoUpdate']) config[name] = { ...config[name], enabled: false };
config.selfEvolution = { enabled: true, reflection: { enabled: false }, retrieval: { enabled: true } };
updateConfig(config);
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://api.nano-gpt.com/api/v1/embeddings') throw new Error('Offline fixture blocked an unexpected network destination');
  if (!String(options?.headers?.authorization || '').startsWith('Bearer synthetic-')) throw new Error('Offline fixture accepts synthetic keys only');
  const body = JSON.parse(options.body);
  if (body.model === 'synthetic-failure') return Response.json({ error: 'synthetic provider outage' }, { status: 503 });
  if (body.model === 'synthetic-slow') await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 6000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
  });
  const dimension = body.model === 'synthetic-wrong-dimension' ? 2 : body.dimensions;
  return Response.json({ data: body.input.map((_text, index) => ({ index, embedding: [1, ...Array(dimension - 1).fill(0)] })) });
};
const app = createApp();
app.onebot.connect = async () => {};
app.onebot.call = async (action) => action === 'get_login_info' ? { user_id: 888, nickname: 'synthetic' } : [];
const port = await app.start();
console.log(`ISOLATED_EMBEDDING_UI http://127.0.0.1:${port}/`);
console.log('Use synthetic-ui-key only. Models synthetic-failure / synthetic-wrong-dimension / synthetic-slow exercise errors and cancellation. All provider calls are mocked; QQ sends unavailable.');
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.stop();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
