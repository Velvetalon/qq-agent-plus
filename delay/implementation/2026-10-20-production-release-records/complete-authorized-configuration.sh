printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
exec 9>"$MAINT/rollout.lock"
flock --nonblock 9
python3 - <<'PY'
import pathlib,json,urllib.request,urllib.error,hashlib,re,stat,subprocess
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');data=pathlib.Path('/mnt/data/qq-agent/data');app=pathlib.Path('/mnt/data/qq-agent/app')
assert (data/'deployed-revision').read_text().strip()=='91beebbcc3a99e725b5f35ac97245a80ca1195ea'
manifest=json.loads((r/'validation-91beebbcc3/expected-source-sha256.json').read_text());assert len(manifest)==142 and all(hashlib.sha256((app/p).read_bytes()).hexdigest()==h for p,h in manifest.items())
proof=json.loads((r/'verified-configured-onebot-identity.json').read_text());assert proof.get('noAccountRebinding') is True and proof.get('notLiveLoginProof') is True
ident=str(proof['selfId']);assert re.fullmatch('[1-9][0-9]{4,14}',ident)
c=json.loads((data/'config.json').read_text());before=json.loads((r/'original-config.json').read_text());token=c['server']['token'];key=str(c.get('providerKeys',{}).get(c['api']['provider']) or c['api'].get('apiKey') or '').strip();assert key
secrets=[key,token,str(c.get('onebot',{}).get('accessToken') or '')]
def api(route,body=None):
 req=urllib.request.Request('http://127.0.0.1:3210'+route,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json','x-console-token':token},method='GET' if body is None else 'POST')
 try:
  with urllib.request.urlopen(req,timeout=90) as res:return json.loads(res.read())
 except urllib.error.HTTPError as e:
  try:msg=str(json.loads(e.read()).get('error') or 'API error')
  except Exception:msg='API error'
  for s in secrets:
   if s:msg=msg.replace(s,'[REDACTED]')
  raise RuntimeError('API '+route+' HTTP '+str(e.code)+': '+msg[:160]) from None
patch={'onebot':{'selfId':ident},'api':{'model':'deepseek/deepseek-v4.1-flash-1017','thinking':'on','fallback':{'enabled':False}},'conversation':{'social':{'reviewMaxOutputTokens':2048,'reviewTimeoutMs':45000}},'selfEvolution':{'retrieval':{'embedding':{'timeoutMs':60000}}}}
result=api('/api/config',patch);assert result.get('ok') is True
account=api('/api/self-evolution/status');assert account.get('accountSource')=='selfId' and str(account.get('accountId'))==ident,'host identity differs from verified configured account'
profile={'enabled':True,'provider':'NanoGPT','baseUrl':'https://api.nano-gpt.com/api/v1','model':'Qwen/Qwen3-Embedding-4B','dimension':2560,'apiKey':key,'allowQuery':True,'allowPrivate':False}
try:
 saved=api('/api/embedding/settings',profile);assert saved.get('ok') is True
 probe=api('/api/embedding/test',{});assert probe.get('ok') is True and probe.get('dimension')==2560,'4B fixed-text probe failed'
except Exception:
 paused=False
 try:paused=api('/api/embedding/settings',{'enabled':False}).get('ok') is True
 except Exception:pass
 (r/'configuration-recovery-result.json').write_text(json.dumps({'status':'CODE_UPDATED_EMBEDDING_PAUSED_OR_UNCONFIRMED','pauseConfirmed':paused,'productionAccountSourceEstablished':True}))
 raise
c=json.loads((data/'config.json').read_text());e=c['selfEvolution']['retrieval']['embedding'];public=api('/api/embedding/settings');p=public['config']
assert c['api']['model']=='deepseek/deepseek-v4.1-flash-1017' and c['api']['thinking']=='on' and c['api']['fallback']['enabled'] is False
assert c['providerKeys']==before['providerKeys'] and c['api']['provider']==before['api']['provider'] and c['api']['baseUrl']==before['api']['baseUrl']
for k in ['runtime','allow','deny','blocklist','timeControl']:assert c.get(k)==before.get(k),'protected field changed: '+k
for k in ['host','port','token']:assert c['server'].get(k)==before['server'].get(k),'console field changed: '+k
for k,v in before['onebot'].items():
 if k!='selfId':assert c['onebot'].get(k)==v,'protocol field changed: '+k
assert c['onebot']['selfId']==ident and c['conversation']['mode']==before['conversation']['mode']=='lifecycle'
assert c['selfEvolution']['enabled'] is True and c['selfEvolution']['retrieval']['enabled'] is True and c['selfEvolution']['reflection']==before['selfEvolution']['reflection']
assert e['enabled'] is True and e['apiKey']==key and e['model']=='Qwen/Qwen3-Embedding-4B' and e['dimension']==2560 and e['allowQuery'] is True and e['allowPrivate'] is False and e['timeoutMs']==60000
assert public.get('configured') is True and p.get('hasApiKey') is True and p.get('enabled') is True
assert stat.S_IMODE((data/'config.json').stat().st_mode)==0o600
health=api('/healthz');assert health.get('ok') is True
summary={'status':'SUCCESS','revision':(data/'deployed-revision').read_text().strip(),'health':health,'chatModel':c['api']['model'],'existingProtocolAccountBound':True,'identitySource':proof['source'],'notLiveQQLoginProof':True,'noAccountRebinding':True,'protocolCredentialsAndEndpointsPreserved':True,'modelCredentialsPreserved':True,'runtimeAndPermissionsPreserved':True,'memoryFlagsPreserved':True,'embedding':{'enabled':True,'configured':public.get('configured'),'state':public.get('state'),'model':e['model'],'dimension':e['dimension'],'allowQuery':e['allowQuery'],'allowPrivate':e['allowPrivate'],'timeoutMs':e['timeoutMs'],'probe':probe,'vector':public.get('vector')},'explicitQQTestRequestsIssued':False,'totalLiveSendsMeasured':False,'backupRoot':str(r)}
(r/'configuration-recovery-result.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
PY
