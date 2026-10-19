#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
NODE=/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node
"$NODE" --input-type=module <<'JS'
import fs from 'node:fs';
import {probeEmbeddingSettings} from '/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/source/src/plugins/self-evolution/embedding-settings.js';
const c=JSON.parse(fs.readFileSync('/mnt/data/qq-agent/data/config.json','utf8'));
const pid=String(c.api?.provider||'');const key=String(c.providerKeys?.[pid]||c.providers?.find(p=>p.id===pid)?.apiKey||c.api?.apiKey||'').trim();
if(!key)throw new Error('Selected NanoGPT credential missing');
const profile={enabled:true,provider:'NanoGPT',endpoint:'https://api.nano-gpt.com/api/v1',model:'Qwen/Qwen3-Embedding-4B',dimension:2560,apiKey:key,allowQuery:true,allowPrivate:false,timeoutMs:15000};
let calls=0;let httpStatus=null;let reportedTokens=null;let reportedCost=null;
const native=globalThis.fetch;
const fetchImpl=async(url,options)=>{
 if(String(url)!=='https://api.nano-gpt.com/api/v1/embeddings'||++calls>1)throw new Error('PROBE_BOUNDARY_BLOCKED');
 const body=JSON.parse(options.body);if(body.model!==profile.model||body.input?.length!==1)throw new Error('PROBE_INPUT_BLOCKED');
 const response=await native(url,{...options,redirect:'error',signal:AbortSignal.any([options.signal,AbortSignal.timeout(15000)].filter(Boolean))});
 httpStatus=response.status;try{const d=await response.clone().json();reportedTokens=d.usage?.total_tokens??null;reportedCost=d.cost??d.usage?.cost??null;}catch{}
 return response;
};
const result=await probeEmbeddingSettings(profile,{fetchImpl});
const summary={...result,model:profile.model,calls,httpStatus,reportedTokens,reportedCost,syntheticFixedTextOnly:true,realNoteInputs:0};
fs.writeFileSync('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/production-embedding-probe.json',JSON.stringify(summary,null,2),{mode:0o600});
console.log(JSON.stringify(summary));if(!result.ok)process.exitCode=1;
JS
