printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node --input-type=module <<'JS'
import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {Agent,setGlobalDispatcher}=require('/mnt/data/qq-agent/app/node_modules/undici');const agent=new Agent({connect:{timeout:30000}});setGlobalDispatcher(agent);
const c=JSON.parse(fs.readFileSync('/mnt/data/qq-agent/data/config.json','utf8'));
if(c.api.model!=='deepseek/deepseek-v4.1-flash-1017'||c.api.baseUrl.replace(/\/+$/,'')!=='https://nano-gpt.com/api/v1')throw new Error('Unexpected live chat profile');
const key=String(c.providerKeys?.[c.api.provider]||c.providers?.find(p=>p.id===c.api.provider)?.apiKey||c.api.apiKey||'').trim();if(!key)throw new Error('Missing selected credential');
const at=Date.now();let result;
try{
 const res=await fetch('https://nano-gpt.com/api/v1/chat/completions',{method:'POST',redirect:'error',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify({model:c.api.model,stream:false,temperature:0,max_tokens:64,messages:[{role:'system',content:'Reply only with OK.'},{role:'user',content:'Administrative connection check; no chat or memory data.'}]}),signal:AbortSignal.timeout(30000)});
 const d=await res.json();result={status:res.ok?'HTTP_SUCCESS':'HTTP_ERROR',httpStatus:res.status,requestedModel:c.api.model,returnedModel:d.model??null,finishReason:d.choices?.[0]?.finish_reason??null,answerMatchesOK:String(d.choices?.[0]?.message?.content??'').trim()==='OK',usage:d.usage??null,returnedCost:d.cost??d.usage?.cost??null,latencyMs:Date.now()-at,dispatches:1,maxOutputTokens:64,syntheticFixedTextOnly:true,realQQSendsCommanded:0};
}catch(e){result={status:'UNKNOWN_TRANSPORT_FAILURE',errorType:e.name,latencyMs:Date.now()-at,dispatches:1,unknownUsageAndCost:true,syntheticFixedTextOnly:true};}
fs.writeFileSync('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/production-chat-smoke.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));await agent.close();if(result.httpStatus!==200)process.exitCode=1;
JS
