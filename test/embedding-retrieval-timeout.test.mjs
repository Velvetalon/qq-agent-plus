import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEmbeddingConfig} from '../src/plugins/self-evolution/embedding-client.js';
import {createSelfEvolutionRetrievalPlugin} from '../src/plugins/builtin/self-evolution-retrieval.js';
import {PluginManager} from '../src/plugins/manager.js';

test('embedding request deadlines are bounded and outer retrieval permits the full client budget',()=>{
 const plugin=createSelfEvolutionRetrievalPlugin();
 for(const value of [undefined,1,8000,60000,999999,Infinity]){
  const client=normalizeEmbeddingConfig({timeoutMs:value});
  assert.ok(client.timeoutMs>=1000&&client.timeoutMs<=60000);
  assert.ok(plugin.getProvider().timeoutMs>client.timeoutMs);
 }
});

test('real plugin collection does not cancel a healthy embedding query at the old five-second cutoff',async()=>{
 let aborted=false;
 const plugin=createSelfEvolutionRetrievalPlugin({getStore:()=>({
  semanticSearch:async({signal})=>{
   await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,5100);signal.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(signal.reason);},{once:true});});
   return {contextBlocks:[],degradationReason:'no-matches',degradationReasons:['no-matches']};
  }
 })});
 const manager=new PluginManager({configProvider:()=>({selfEvolution:{enabled:true,retrieval:{enabled:true}}})});
 manager.register(plugin);await manager.startAll();
 try{
  const result=await manager.collectContext(manager.createRunSnapshot(),{sessionId:'slow',accountId:'fixture',chatKey:'group:1',retrievalQuery:'synthetic'});
  assert.equal(aborted,false);assert.equal(result.degraded,false);
  const audit=plugin.getProvider().consumeAudit('slow');assert.equal(audit.reason,'no-matches');assert.equal(audit.available,true);
 }finally{await manager.stopAll();}
});
