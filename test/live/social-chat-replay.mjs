// Explicit opt-in only. Runs real model decisions with synthetic OneBot receipts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { ProxyAgent } from 'undici';
import { boundedChatTransport, LIVE_ENDPOINT, LIVE_MODEL, LIVE_THINKING } from './bounded-chat-transport.mjs';
import { readReplayKey } from './replay-credentials.mjs';
import { replayProxyOptions } from './replay-fetch-options.mjs';
import { collectNewSessionAudit } from './replay-session-audit.mjs';
if (process.env.QQ_REPLAY_LIVE !== LIVE_MODEL) throw new Error('Explicit QQ_REPLAY_LIVE model opt-in required');
const output = path.resolve(process.env.QQ_REPLAY_OUTPUT || '');
const repo = fs.realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
if (!process.env.QQ_REPLAY_OUTPUT) throw new Error('Evidence must be outside checkout');
fs.mkdirSync(output, { recursive: true });
const realOutput = fs.realpathSync(output);
if (realOutput === repo || realOutput.startsWith(repo + path.sep)) throw new Error('Evidence must be outside checkout');
const codeManifest = {};
for (const dir of ['src', 'ui', 'test/live', 'test/fixtures/social-live-images']) {
  for (const entry of fs.readdirSync(path.join(repo,dir), {recursive:true,withFileTypes:true})) {
    if (!entry.isFile()) continue;
    const filename=path.join(entry.parentPath,entry.name);
    codeManifest[path.relative(repo,filename)]=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
  }
}
fs.writeFileSync(path.join(output,'code-manifest.json'),JSON.stringify(codeManifest,null,2));
const key = readReplayKey();
delete process.env.QQ_REPLAY_API_KEY;
delete process.env.QQ_REPLAY_KEY_FILE;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-live-synthetic-'));
process.env.QQ_AGENT_DATA_DIR = root;
// safe-fetch uses node:http(s), not global fetch. No web/image downloader may
// leave the isolated replay, even if the real model selects a read-only tool.
const blockedHttp = () => { throw new Error('LIVE_NON_CHAT_HTTP_BLOCKED'); };
http.request = http.get = https.request = https.get = blockedHttp;
syncBuiltinESMExports();
const { DEFAULT_CONFIG, setRuntimeConfig } = await import('../../src/core/config.js');
const { Orchestrator } = await import('../../src/core/orchestrator.js');
const { ChatStore } = await import('../../src/core/store.js');
const { SessionRegistry } = await import('../../src/core/sessions.js');
const { SendQueue } = await import('../../src/onebot/sender.js');
const { createReflectionPlugin } = await import('../../src/plugins/self-evolution/reflection-plugin.js');
const { createSelfEvolutionRetrievalPlugin } = await import('../../src/plugins/builtin/self-evolution-retrieval.js');
const { createEmbeddingCapability } = await import('../../src/plugins/self-evolution/embedding-runtime.js');
const { createSelfEvolutionPlugin } = await import('../../src/plugins/builtin/self-evolution.js');
const { chatCompletion } = await import('../../src/llm/llm.js');
const { repairJsonObject } = await import('../../src/core/json-repair.js');
const nativeFetch = globalThis.fetch;
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const dispatcher = proxy ? new ProxyAgent(proxy) : null;
const results = [];
const liveDeadline = Date.now() + 1800000;
const embeddingStats={calls:0,inputChars:0,errors:0,budgetStops:0};
const embeddingEndpoint='https://api.nano-gpt.com/api/v1/embeddings';
const embeddingConfig={enabled:true,provider:'NanoGPT',endpoint:embeddingEndpoint,model:'Qwen/Qwen3-Embedding-4B',dimension:2560,maxDistance:0.5,maxBatch:16,apiKey:key,allowPrivate:true,allowQuery:true,timeoutMs:60000};
let embeddingFailed=false;
const embeddingFetch=async(url,options)=>{
 if(embeddingFailed)throw new Error('EMBEDDING_PREVIOUS_FAILURE_STOPPED');
 const body=JSON.parse(options.body);
 if(url!==embeddingEndpoint||options.method!=='POST'||body.model!==embeddingConfig.model||body.dimensions!==2560)throw new Error('EMBEDDING_ENDPOINT_OR_PROFILE_BLOCKED');
 const chars=body.input.reduce((n,x)=>n+x.length,0);
 if(embeddingStats.calls>=32||embeddingStats.inputChars+chars>50000||Date.now()>=liveDeadline){embeddingStats.budgetStops++;throw new Error('EMBEDDING_BUDGET_EXHAUSTED');}
 const record={call:++embeddingStats.calls,input:body.input,startedAt:new Date().toISOString()};embeddingStats.inputChars+=chars;const before=Date.now();
 try{const response=await nativeFetch(url,{...options,redirect:'error',...replayProxyOptions(dispatcher),signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,Math.min(60000,liveDeadline-Date.now())))])});
 const data=await response.json();Object.assign(record,{httpStatus:response.status,elapsedMs:Date.now()-before,model:data.model??null,dimensions:data.data?.map(x=>x.embedding?.length),usage:data.usage??null,cost:data.cost??data.usage?.cost??null});
 if(!response.ok)throw new Error('EMBEDDING_HTTP_'+response.status);
 return Response.json(data);
 }catch(error){embeddingFailed=true;embeddingStats.errors++;record.error=String(error.message).split(key).join('[REDACTED]');throw new Error(record.error);}
 finally{current?.embeddingRequests.push(record);fs.appendFileSync(path.join(output,'embedding-calls.jsonl'),JSON.stringify({case:current?.id,...record})+'\n');}
};
let current = null;
let hook = null;
const transport = boundedChatTransport({ key, maxCalls: process.env.QQ_REPLAY_CANARY ? 6 : 100, maxTokens: process.env.QQ_REPLAY_CANARY ? 100000 : 800000,
  deadlineMs: Math.max(1, liveDeadline-Date.now()),
  fetchImpl: (url, options) => nativeFetch(url, { ...options, ...replayProxyOptions(dispatcher) }),
  record: (entry) => { current?.requests.push(entry); fs.appendFileSync(path.join(output, 'calls.jsonl'), JSON.stringify({ case: current?.id, ...entry }) + '\n'); },
  afterDispatch: async (v) => { if (hook) await hook(v); }
});
globalThis.fetch = transport.fetch;
const accountId = '888';
const chatKey = 'group:1';
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function save() { fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ model: LIVE_MODEL, endpoint: LIVE_ENDPOINT, startedAt, completedAt: new Date().toISOString(), codeCommit: process.env.QQ_REPLAY_COMMIT || null, embeddingEnabled: results.some(c=>c.embeddingEnabled), embeddingStats, realQQSends: 0, safety: transport.stats, cases: results }, null, 2)); }
const startedAt = new Date().toISOString();
async function runCase(spec) {
  current = { id: spec.id, acceptanceIds: spec.ids, description: spec.description, inputs: [], batches: [], requests: [], outputs: [], reflection: [], embeddingRequests: [], embeddingEnabled: Boolean(spec.embedding), limitations: spec.limitations || [] };
  results.push(current);
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.runtime.mode = 'active'; cfg.allow.groups = ['1']; cfg.conversation.mode = 'social';
  Object.assign(cfg.api, { model: LIVE_MODEL, baseUrl: LIVE_ENDPOINT.replace('/chat/completions', ''), apiKey: key, provider: 'NanoGPT', thinking: LIVE_THINKING, fallback: { enabled: false }, temperature: 0.2, maxRounds: 4, timeoutMs: 60000, runTimeoutMs: 180000, maxRunTokens: 50000, priceRemoteUrl: 'none' });
  cfg.api.vision = Boolean(spec.vision); cfg.webSearch.enabled = false;
  cfg.sticker.enabled = false; cfg.memory.consolidateEnabled = false;
  cfg.send.minGapMs = 0; cfg.send.maxGapMs = 0; cfg.send.byLengthMs = 0;
  cfg.wakeDelayMs = 0; cfg.wakeDelayMinMs = 0; cfg.wakeDelayMaxMs = 0;
  cfg.persona.participation = spec.participation || 'medium';
  if (spec.roleText) { cfg.persona.roleText = spec.roleText; cfg.persona.templateId = ''; }
  cfg.selfEvolution = { enabled: Boolean(spec.reflect), retrieval: { enabled: Boolean(spec.embedding), embedding: spec.embedding ? {...embeddingConfig} : {enabled:false} }, reflection: { enabled: Boolean(spec.reflect), pollIntervalMs: 3600000, maxAttempts: 1, reflectionTimeoutMs: 60000, taskTimeoutMs: 75000 } };
  current.personaHash = hash(cfg.persona); current.persona = cfg.persona;
  setRuntimeConfig(cfg);
  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const store = new ChatStore(0, { dataDir });
  const sessions = new SessionRegistry(0);
  let mid = 100;
  const sink = (kind) => async (...args) => { current.outputs.push({ kind, args, batch: current.batches.length }); return { message_id: ++mid }; };
  const onebot = { selfId: accountId, selfNickname: cfg.persona.botName, getGroupInfo: async () => ({ group_name: '合成测试群' }), sendText: sink('text'), sendFace: sink('face'), sendSticker: sink('sticker'), sendPoke: sink('poke') };
  let reflection;
  let notebook;
  const memoryDir=spec.memoryGroup?path.join(root,'memory-'+spec.memoryGroup):dataDir;
  fs.mkdirSync(memoryDir,{recursive:true});
  const notebookFilename=path.join(memoryDir,'notebook.sqlite');
  const reflectionFilename=path.join(memoryDir,'reflection.sqlite');
  const embeddingCapability=spec.embedding?createEmbeddingCapability({config:embeddingConfig,fetchImpl:embeddingFetch}):null;
  const runner = new Orchestrator({ store, sessions, onebot, sender: new SendQueue({ onebot, store }), stickers: {}, memory: { formatForPrompt: () => '' }, validateSocialMaterials: (args) => { const notes=(args.refs||[]).filter(r=>r.kind==='notebook');const traits=(args.refs||[]).filter(r=>r.kind==='learned-self');const invalid=[];if(notes.length)invalid.push(...(notebook?.getStore()?.validateMaterialRefs({...args,refs:notes,currentChatKey:args.chatKey})?.invalidRefs||notes));if(traits.length)invalid.push(...(reflection?.getStore()?.validateMaterialRefs({...args,refs:traits,currentChatKey:args.chatKey,basePersona:cfg.persona})?.invalidRefs||traits));return {valid:!invalid.length,invalidRefs:invalid}; } });
  if (spec.reflect) {
    notebook = createSelfEvolutionPlugin({ dataDir,filename:notebookFilename,embeddingClient:embeddingCapability }); runner.pluginManager.register(notebook); runner.pluginManager.setEnabled(notebook.id, true);
    if(spec.embedding){const retrieval=createSelfEvolutionRetrievalPlugin({dataDir,filename:notebookFilename,getStore:()=>notebook.getStore()});runner.pluginManager.register(retrieval);runner.pluginManager.setEnabled(retrieval.id,true);}
    reflection = createReflectionPlugin({ dataDir,filename:reflectionFilename,notebookFilename,embeddingClient:embeddingCapability, getAccountId: () => accountId, getBasePersona: () => cfg.persona, reflector: async ({ prompt, signal, evidence }) => {
      const response = await chatCompletion({ messages: [{ role: 'user', content: String(prompt) }], temperature: 0.2, signal, purpose: 'reflection', maxTokens: 2048 });
      const content = String(response.message?.content ?? '').trim();
      const raw = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1]?.trim() || content;
      let value; try { value = JSON.parse(raw); } catch { value = repairJsonObject(raw); }
      current.reflection.push({ evidence, output: value });
      if (!value) throw new Error('Reflection is not valid JSON');
      return value;
    }});
    runner.pluginManager.register(reflection); runner.pluginManager.setEnabled(reflection.id, true);
  }
  if (spec.publicSource) runner.pluginManager.register({ id: 'synthetic.public-source', name: 'Synthetic public bulletin', version: '1.0.0', apiVersion: 1, declare(registrar) { registrar.addTools({ name: 'read_public_bulletin', description: '读取群友共同关注的合成项目本期公开更新。不会联网。', parameters: { type: 'object', properties: {}, additionalProperties: false }, ownerPluginId: 'synthetic.public-source', effect: 'read', socialSource: true, parallelSafe: true, terminal: false, execute: async () => ({ content: spec.publicSource }) }); } });
  const append = (entry) => {
    if (typeof entry === 'string') entry = { text: entry };
    const value = { mid: entry.mid || `synthetic-${++mid}`, ts: entry.ts || Date.now() + (spec.batchGapMs || 0) * current.batches.length, senderId: entry.senderId || '42', senderName: entry.senderName || '小林', text: entry.text, ...(entry.reply ? { reply: entry.reply } : {}) };
    if(entry.imageFixture){const image=fs.readFileSync(new URL('../fixtures/social-live-images/'+entry.imageFixture,import.meta.url)).toString('base64');value.media=[{kind:'image',file:'base64://'+image}];value.text += ' [图片]';}
    current.inputs.push(value);
    return entry.self ? store.appendSelf(chatKey, value) : store.appendIncoming(chatKey, value);
  };
  try {
    await runner.startPlugins();
    if(spec.embedding)await notebook.getStore().stopEmbeddingWorker();
    const batches=spec.assistantOnlyFrom ? [results.find(c=>c.id===spec.assistantOnlyFrom)?.outputs.filter(o=>o.kind==='text').slice(-3).map(o=>({self:true,text:o.args[2]}))||[]] : spec.batches;
    if(spec.assistantOnlyFrom&&batches[0].length!==3)throw new Error('Need three observed prior assistant outputs');
    for (const [index, batch] of batches.entries()) {
      for (const entry of batch) append(entry);
      const before = transport.stats.calls;
      current.batches.push({ index, callsBefore: before, startedAt: new Date().toISOString() });
      if (spec.cancelDuringReply && index === 0) hook = ({ phase }) => { if (phase === 'replyer') { hook = null; append('小鲸鱼，找到了不用了，已经自己解决了。'); current.cancelInjectedAt = 'fetch-started-before-response'; } };
      const beforeSessions=new Set(sessions.listSummaries(10000).map(s=>String(s.id)));
      await runner.wake(chatKey);
      hook = null;
      Object.assign(current.batches.at(-1), { callsAfter: transport.stats.calls,
        ...collectNewSessionAudit(beforeSessions,sessions.listSummaries(10000),id=>sessions.get(id)) });
      if (reflection) {
        await runner.pluginManager.drainCompletionEvents();
        current.batches.at(-1).reflectionResult = await reflection.getWorker().runOnce();
        if(spec.embedding)current.batches.at(-1).indexResult=await notebook.getStore().processEmbeddingQueue({limit:16});
        current.notes = notebook.getStore().search({ accountId, currentChatKey: chatKey, limit: 100 });
        current.candidates = reflection.getStore().listCandidates({ accountId, chatKey });
        current.profileRevision = reflection.getStore().getLearnedSelfRevision({ accountId });
      }
      save();
    }
    if (spec.configuredOpportunity) {
      const state=runner.getSocialState(chatKey);
      const scope={accountId,chatKey};
      const anchor=store.findByMid(chatKey,current.inputs[0]?.mid);
      const topic=state.snapshot(scope).topics.find(t=>t.status==='active'&&t.messageIds.includes(String(anchor?.id)));
      if(!topic)throw new Error('Configured opportunity needs an active real topic');
      const settings=state.interests.save({...scope,expectedRevision:0,config:{enabled:true,maxDailyRuns:1,maxDailyTokens:100000,maxRunTokens:80000,maxModelCalls:6,sources:[{id:'public-update',enabled:true,title:'纸鹤公开更新',text:'共同关注纸鹤的离线编辑功能。read_public_bulletin 提供本期公开公告；只有实质新进展才值得自然分享。'}]}});
      const dueAt=Date.now()+100;
      const intent=state.requestInterestOpportunity({...scope,sourceId:'public-update',sourceRevision:settings.sources[0].revision,topicId:topic.id,goal:'关注纸鹤离线编辑的新公开进展，与共同兴趣相关且有新增信息时分享',dueAt,expiresAt:dueAt+120000});
      await new Promise(resolve=>setTimeout(resolve,110));
      const callsBefore=transport.stats.calls, sendsBefore=current.outputs.length;
      const beforeSessions=new Set(sessions.listSummaries(10000).map(s=>String(s.id)));
      const tick=await runner.runSocialIntentTick();
      current.configuredOpportunity={intentId:intent.id,tick,additionalCalls:transport.stats.calls-callsBefore,additionalSends:current.outputs.length-sendsBefore,
        ...collectNewSessionAudit(beforeSessions,sessions.listSummaries(10000),id=>sessions.get(id)),intents:state.listIntents(scope)};
    }
    if (spec.tick) {
      const before = { calls: transport.stats.calls, sends: current.outputs.length };
      const tick = await runner.runSocialIntentTick({ now: Date.now() + 10 * 60000 });
      current.idleTick = { result: tick, additionalCalls: transport.stats.calls - before.calls, additionalSends: current.outputs.length - before.sends };
    }
    if(spec.assistantOnlyFrom)current.assistantOnlyEvidence={sourceCase:spec.assistantOnlyFrom,modelCalls:current.requests.length,profileRevision:current.profileRevision,notes:current.notes?.count||0,candidates:current.candidates?.length||0};
    current.status = transport.stats.errors || embeddingStats.errors ? 'TRANSPORT_ERROR' : transport.stats.budgetStops || embeddingStats.budgetStops ? 'PARTIAL_BUDGET_STOP' : 'EXECUTED_REQUIRES_SEMANTIC_REVIEW';
  } catch (error) { current.status = 'ERROR'; current.error = String(error.message).split(key).join('[REDACTED]'); }
  finally { hook = null; await runner.abortAll(); await runner.stopPlugins(); store.close(); save(); }
  console.log(JSON.stringify({ case: current.id, status: current.status, calls: current.requests.filter(r => r.httpStatus).length, outputs: current.outputs.length, error: current.error }));
  if (embeddingStats.errors || embeddingStats.budgetStops || transport.stats.errors || transport.stats.budgetStops || current.error?.includes('LIVE_')) throw new Error('Live transport failed; no automatic retry');
}
const scenarios = JSON.parse(fs.readFileSync(new URL('./social-chat-fixtures.json', import.meta.url), 'utf8'));
try {
  const selected = process.env.QQ_REPLAY_CANARY ? scenarios.slice(0, 1) : scenarios.filter(s => !process.env.QQ_REPLAY_CASES || process.env.QQ_REPLAY_CASES.split(',').includes(s.id));
  for (const spec of selected) await runCase(spec);
} finally { save(); globalThis.fetch = nativeFetch; await dispatcher?.close(); }
