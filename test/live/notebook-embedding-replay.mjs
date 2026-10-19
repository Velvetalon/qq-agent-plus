// Live opt-in synthetic Notebook pipeline; never persists the credential.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ProxyAgent } from 'undici';
import { readReplayKey } from './replay-credentials.mjs';
import { replayProxyOptions } from './replay-fetch-options.mjs';
const MODEL = 'Qwen/Qwen3-Embedding-4B';
const ENDPOINT = 'https://api.nano-gpt.com/api/v1/embeddings';
if (process.env.QQ_REPLAY_EMBEDDING !== MODEL) throw new Error('Exact embedding model opt-in required');
const output = process.env.QQ_REPLAY_EMBEDDING_OUTPUT;
if (!output || !path.isAbsolute(output)) throw new Error('External evidence path required');
fs.mkdirSync(output, {recursive:true});
const repo=fs.realpathSync(fileURLToPath(new URL('../../',import.meta.url)));
const resolvedOutput=fs.realpathSync(output);
if(resolvedOutput===repo||resolvedOutput.startsWith(repo+path.sep))throw new Error('Evidence must be outside checkout');
const key = readReplayKey();
delete process.env.QQ_REPLAY_API_KEY;
delete process.env.QQ_REPLAY_KEY_FILE;
const root = fs.mkdtempSync(path.join(os.tmpdir(),'qq-live-embedding-'));
process.env.QQ_AGENT_DATA_DIR = root;
const { NotebookStore } = await import('../../src/plugins/self-evolution/notebook-store.js');
const { createEmbeddingCapability } = await import('../../src/plugins/self-evolution/embedding-runtime.js');
const nativeFetch = globalThis.fetch;
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY;
const dispatcher = proxy ? new ProxyAgent(proxy) : null;
let stopped = false;
let chars = 0;
const calls=[];
const started=Date.now();
const evidence={model:MODEL,endpoint:ENDPOINT,dimension:2560,credentialPersisted:false,realQQSends:0,startedAt:new Date().toISOString(),calls,queries:[],assertions:[],dataDir:root};
const persist=()=>fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(evidence,null,2));
const transport=async(url,options)=>{
 if(stopped)throw new Error('EMBEDDING_PREVIOUS_FAILURE_STOPPED');
 if(url!==ENDPOINT||options.method!=='POST')throw new Error('EMBEDDING_ENDPOINT_BLOCKED');
 const body=JSON.parse(options.body);
 if(body.model!==MODEL||body.dimensions!==2560||!Array.isArray(body.input)||body.input.some(x=>typeof x!=='string'))throw new Error('EMBEDDING_REQUEST_BLOCKED');
 const size=body.input.reduce((n,x)=>n+x.length,0);
 if(calls.length>=32||chars+size>50000||Date.now()-started>600000)throw new Error('EMBEDDING_BUDGET_EXHAUSTED');
 const call={call:calls.length+1,input:body.input,inputChars:size,startedAt:new Date().toISOString()};calls.push(call);chars+=size;
 const before=Date.now();
 try{
  const response=await nativeFetch(ENDPOINT,{...options,redirect:'error',...replayProxyOptions(dispatcher),signal:AbortSignal.any([options.signal,AbortSignal.timeout(Math.max(1,Math.min(60000,600000-(Date.now()-started))))])});
  call.httpStatus=response.status;
  const data=await response.json();
  Object.assign(call,{elapsedMs:Date.now()-before,usage:data.usage??null,returnedModel:data.model??null,dimensions:data.data?.map(x=>x.embedding?.length),cost:data.cost??data.usage?.cost??null});
  persist();
  if(!response.ok)throw new Error('EMBEDDING_HTTP_'+response.status);
  assert.ok(data.data.every(x=>x.embedding.length===2560));
  return Response.json(data);
 }catch(error){stopped=true;call.error=String(error.message).split(key).join('[REDACTED]');call.causeCode=error.cause?.code??null;persist();throw new Error(call.error);}
};
const cfg={enabled:true,provider:'NanoGPT',endpoint:ENDPOINT,model:MODEL,dimension:2560,maxDistance:2,maxBatch:16,apiKey:key,allowPrivate:true,allowQuery:true,timeoutMs:60000};
const capability=createEmbeddingCapability({config:cfg,fetchImpl:transport});
const open=()=>new NotebookStore({dataDir:root,embeddingConfig:cfg,embeddingClient:capability});
let notebook=open();
const docs=[
 ['papercrane','我们把虚构的长日志折叠小工具正式命名为“纸鹤”，因为界面像折纸一样把冗长输出收得整整齐齐。这是小林、小陈和小鲸鱼这次共同讨论确定的名字。'],
 ['retry','合成任务队列曾因HTTP 503立刻retry而放大故障。小林给重试加入指数退避、随机抖动和最大次数后恢复，重复扣库存则使用业务幂等键与同一数据库事务解决。'],
 ['sqlite','小陈在合成项目中启用了SQLite WAL模式，读取可以和写事务并发，但仍然只有一个写者；忙超时用于短暂等锁，不能消除长事务。'],
 ['museum','我们约好下个月虚构博物馆的夜间观星展开放后再讨论行程，目前没有订票，也没有任何人已经去过。'],
 ['cooking','在合成闲聊中，小林说煎蛋时先把锅预热、转小火再下蛋，边缘定型后翻面，不要一直用大火。']
];
const ids={};
const append=(tag,content,accountId='888',chatKey='group:1')=>notebook.append({accountId,scope:'chat',chatKey,currentChatKey:chatKey,content,tags:['experience',tag],source:{kind:'chat',accountId,chatKey,sessionId:'synthetic-'+tag,runId:'synthetic-'+tag},idempotencyKey:'synthetic-'+accountId+'-'+chatKey+'-'+tag}).note;
try{
 for(const [tag,content]of docs)ids[tag]=append(tag,content).id;
 const hidden=append('scope-isolation','另一个群也把长日志工具叫纸鹤，但SECRET_SCOPE_SYNTHETIC不可进入本群。','888','group:2');
 evidence.documentIds=ids;evidence.hiddenNoteId=hidden.id;
 evidence.index=await notebook.processEmbeddingQueue({limit:16});
 assert.equal(notebook.embeddingStatus().stats.ready,6,'all real document vectors ready');
 evidence.assertions.push('six synthetic documents indexed with real 2560-dimensional provider vectors');
 evidence.profileId=capability.profileId;
 notebook.close();notebook=open();
 const calibration=[
 ['p1','那个把冗长日志折起来的工具，当时我们最终取了什么名字？','papercrane'],
 ['p2','服务返回不可用后立刻再次请求导致雪崩，我们采取了什么缓解办法？','retry'],
 ['p3','数据库启用预写日志后能有多个写入者同时提交吗？','sqlite'],
 ['p4','天文展的参观是已经完成了还是仅仅计划？','museum'],
 ['p5','怎样避免煎鸡蛋一直被大火烧焦？','cooking'],
 ['n1','明天纽约到伦敦的航班票价最低多少？',null],
 ['n2','南极帝企鹅的平均潜水深度是多少？',null],
 ['n3','谁赢得了2035年世界杯足球赛？',null]
 ];
 async function query([id,text,expected],split){
  const result=await notebook.semanticSearch({accountId:'888',chatKey:'group:1',currentChatKey:'group:1',query:text,maxNotes:10,maxChars:8000,maxSnippetChars:1200});
  assert.ok(!result.results.some(x=>x.noteId===hidden.id),'cross-chat scope leaked');
  const row={id,split,query:text,expected,results:result.results.map(x=>({noteId:x.noteId,tag:Object.keys(ids).find(k=>ids[k]===x.noteId),distance:x.distance,score:x.score,snippet:x.snippet})),degradationReason:result.degradationReason};evidence.queries.push(row);persist();return row;
 }
 for(const q of calibration)await query(q,'calibration');
 const positive=evidence.queries.filter(q=>q.expected);
 const negative=evidence.queries.filter(q=>!q.expected);
 const positiveMax=Math.max(...positive.map(q=>q.results.find(r=>r.tag===q.expected)?.distance??2));
 const negativeMin=Math.min(...negative.map(q=>q.results[0]?.distance??2));
 const separable=positiveMax<negativeMin;
 const selected=separable?(positiveMax+negativeMin)/2:Math.min(0.7,positiveMax+0.01);
 const thresholdPositivePass=positive.every(q=>q.results[0]?.tag===q.expected&&q.results[0].distance<selected);
 const thresholdNegativePass=negative.every(q=>q.results.every(r=>r.distance>=selected));
 const confusion={truePositive:positive.filter(q=>q.results[0]?.tag===q.expected&&q.results[0].distance<selected).length,falseNegative:positive.filter(q=>!(q.results[0]?.tag===q.expected&&q.results[0].distance<selected)).length,falsePositive:negative.filter(q=>q.results.some(r=>r.distance<selected)).length,trueNegative:negative.filter(q=>q.results.every(r=>r.distance>=selected)).length};
 evidence.calibration={positiveMax,negativeMin,separable,selectedMaxDistance:selected,thresholdPositivePass,thresholdNegativePass,confusion,scope:'five positive and three negative synthetic Chinese calibration queries only'};
 cfg.maxDistance=selected;notebook.setEmbeddingServices({config:cfg,embeddingClient:capability});
 for(const q of [['h1','我们给那个日志收纳工具取名的由来还记得吗？','papercrane'],['h2','消费者提交完扣库存就崩溃，重新收到同一任务怎么防二次扣减？','retry'],['h3','土星环的成分是什么？',null]])await query(q,'heldout');
 const held=evidence.queries.filter(q=>q.split==='heldout');
 evidence.heldoutPass=held.every(q=>q.expected?q.results[0]?.tag===q.expected:q.results.length===0);
 evidence.calibrationTop1Pass=positive.every(q=>q.results[0]?.tag===q.expected);
 const before=calls.length;
 notebook.setEmbeddingServices({config:{...cfg,model:'unconfigured-different-profile',dimension:4096},embeddingClient:capability});
 const mismatch=await notebook.semanticSearch({accountId:'888',chatKey:'group:1',query:'日志工具名称'});
 assert.equal(mismatch.results.length,0);assert.equal(calls.length,before,'profile mismatch must not query old vectors');
 evidence.profileMismatch={reason:mismatch.degradationReason,results:mismatch.results.length,externalCalls:calls.length-before};
 evidence.assertions.push('reopened Notebook retrieves current profile; foreign-chat notes excluded; dimension/model change does not reuse vectors');
 evidence.status=evidence.heldoutPass&&evidence.calibrationTop1Pass&&separable&&thresholdPositivePass&&thresholdNegativePass?'PASS_SYNTHETIC_CALIBRATION':'SEMANTIC_FIXTURE_FAILURE';
}catch(error){evidence.status='ERROR';evidence.error=String(error.message).split(key).join('[REDACTED]');}
finally{notebook.close();await dispatcher?.close();evidence.completedAt=new Date().toISOString();persist();}
console.log(JSON.stringify({status:evidence.status,calls:calls.length,calibration:evidence.calibration,heldoutPass:evidence.heldoutPass,error:evidence.error}));
if(evidence.status!=='PASS_SYNTHETIC_CALIBRATION')process.exitCode=1;
