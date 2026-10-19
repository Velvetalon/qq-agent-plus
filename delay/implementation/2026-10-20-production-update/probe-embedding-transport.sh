#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node --input-type=module <<'JS'
import fs from 'node:fs';import {createRequire} from 'node:module';
import {probeEmbeddingSettings} from '/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/source/src/plugins/self-evolution/embedding-settings.js';
const require=createRequire(import.meta.url);const {Agent,setGlobalDispatcher}=require('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/source/node_modules/undici');
const agent=new Agent({connect:{timeout:30000}});setGlobalDispatcher(agent);
const routes=['https://api.nano-gpt.com/api/v1','https://nano-gpt.com/api/v1'];const diagnostics=[];
for(const route of routes){const at=Date.now();try{const r=await fetch(route+'/embeddings',{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(10000)});diagnostics.push({gateway:route,status:r.status,latencyMs:Date.now()-at});await r.body?.cancel();}catch(e){diagnostics.push({gateway:route,error:e.cause?.code||e.name,latencyMs:Date.now()-at});}}
const chosen=diagnostics.find(r=>r.status===405||r.status===401||r.status===200)?.gateway;
if(!chosen){console.log(JSON.stringify({ok:false,code:'NO_EMBEDDING_ROUTE',diagnostics,modelCalls:0}));await agent.close();process.exit(1);}
const c=JSON.parse(fs.readFileSync('/mnt/data/qq-agent/data/config.json','utf8'));const pid=String(c.api?.provider||'');const key=String(c.providerKeys?.[pid]||c.providers?.find(p=>p.id===pid)?.apiKey||c.api?.apiKey||'').trim();
if(!key)throw new Error('Selected NanoGPT credential missing');
const profile={enabled:true,provider:'NanoGPT',endpoint:chosen,model:'Qwen/Qwen3-Embedding-4B',dimension:2560,apiKey:key,allowQuery:true,allowPrivate:false,timeoutMs:60000};let calls=0,httpStatus=null,reportedTokens=null;
const native=globalThis.fetch;const fetchImpl=async(url,options)=>{if(String(url)!==chosen+'/embeddings'||++calls>1)throw new Error('PROBE_BOUNDARY_BLOCKED');const b=JSON.parse(options.body);if(b.model!==profile.model||b.input?.length!==1)throw new Error('PROBE_INPUT_BLOCKED');const r=await native(url,{...options,redirect:'error'});httpStatus=r.status;try{reportedTokens=(await r.clone().json()).usage?.total_tokens??null;}catch{}return r;};
const result=await probeEmbeddingSettings(profile,{fetchImpl});const summary={...result,gateway:chosen,model:profile.model,timeoutMs:60000,calls,httpStatus,reportedTokens,diagnostics,syntheticFixedTextOnly:true,realNoteInputs:0};
fs.writeFileSync('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/production-embedding-probe-transport.json',JSON.stringify(summary,null,2),{mode:0o600});console.log(JSON.stringify(summary));await agent.close();if(!result.ok)process.exitCode=1;
JS
