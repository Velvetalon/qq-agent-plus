printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
python3 - <<'PY'
import pathlib,json,urllib.request,urllib.error,urllib.parse,re
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');c=json.loads(pathlib.Path('/mnt/data/qq-agent/data/config.json').read_text());headers={'x-console-token':c['server']['token']}
req=urllib.request.Request('http://127.0.0.1:3210/api/self-evolution/status',headers=headers)
with urllib.request.urlopen(req,timeout=15) as res:s=json.loads(res.read())
print('MEMORY_RUNTIME='+json.dumps({'accountSource':s.get('accountSource'),'selfEvolution':{k:s.get('selfEvolution',{}).get(k) for k in ['enabled','configured','effective','running']},'reflectionRunning':s.get('reflection',{}).get('running'),'retrieval':s.get('retrieval',{}).get('enabled')}))
one=c['onebot'];base=str(one.get('httpUrl') or '').rstrip('/');u=urllib.parse.urlsplit(base)
assert u.scheme in ['http','https'] and u.hostname in ['127.0.0.1','localhost','::1'],'only configured local protocol endpoint allowed'
token=one.get('httpAccessToken') or one.get('accessToken') or '';h={'Content-Type':'application/json'}
if token:h['Authorization']='Bearer '+token
req=urllib.request.Request(base+'/get_login_info',data=b'{}',headers=h,method='POST');summary={'configuredProtocolHost':u.hostname,'configuredProtocolPort':u.port,'action':'get_login_info','isReadOnlyAction':True,'trustedSelfIdAvailable':False}
try:
 with urllib.request.urlopen(req,timeout=12) as res:payload=json.loads(res.read());summary['httpStatus']=res.status
 valid=payload.get('status') in ['ok','async'] or payload.get('status') is None and int(payload.get('retcode',-1))==0
 ident=str(payload.get('data',{}).get('user_id') or '')
 if valid and re.fullmatch('[1-9][0-9]{4,14}',ident):
  summary['trustedSelfIdAvailable']=True
  (r/'verified-onebot-identity.json').write_text(json.dumps({'source':'authenticated_get_login_info','user_id':ident,'httpHost':u.hostname,'httpPort':u.port}));(r/'verified-onebot-identity.json').chmod(0o600)
 else:summary['protocolStatus']=payload.get('status');summary['retcode']=payload.get('retcode')
except urllib.error.HTTPError as e:summary['httpStatus']=e.code
except Exception as e:summary['errorType']=type(e).__name__;summary['reasonType']=type(getattr(e,'reason',None)).__name__
print('ONEBOT_IDENTITY_PROBE='+json.dumps(summary))
PY
