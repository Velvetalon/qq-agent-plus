printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
python3 - <<'PY'
import pathlib,json,hashlib
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY');data=pathlib.Path('/mnt/data/qq-agent/data');app=pathlib.Path('/mnt/data/qq-agent/app')
state=json.loads((r/'update-result.json').read_text());assert state['status']=='FAILED' and state['deployFinished'] is True
assert (data/'deployed-revision').read_text().strip()=='91beebbcc3a99e725b5f35ac97245a80ca1195ea'
manifest=json.loads((r/'validation-91beebbcc3/expected-source-sha256.json').read_text());assert len(manifest)==142
assert all((app/p).is_file() and hashlib.sha256((app/p).read_bytes()).hexdigest()==h for p,h in manifest.items())
c=json.loads((data/'config.json').read_text());b=json.loads((r/'original-config.json').read_text());diff=[]
for k in ['allow','deny','blocklist','onebot','timeControl','runtime']:
 if c.get(k)!=b.get(k):diff.append(k)
for k in ['host','port','token']:
 if c['server'].get(k)!=b['server'].get(k):diff.append('server.'+k)
for k in ['provider','baseUrl']:
 if c['api'].get(k)!=b['api'].get(k):diff.append('api.'+k)
assert c.get('providerKeys')==b.get('providerKeys') and not diff,'protected changes: '+','.join(diff)
e=c.get('selfEvolution',{}).get('retrieval',{}).get('embedding',{})
assert e.get('enabled') is not True,'indexing may be enabled; needs separate recovery'
print(json.dumps({'newCodeManifestVerified':True,'protectedFieldsPreserved':True,'newIndexingNotEnabled':True,'chatModel':c['api']['model'],'embeddingFieldNames':sorted(e)}))
PY
systemctl --user start qq-agent-linux.service
python3 - <<'PY'
import json,time,urllib.request,subprocess,pathlib,re
ok=False
for n in range(30):
 try:
  with urllib.request.urlopen('http://127.0.0.1:3210/healthz',timeout=2) as res:h=json.loads(res.read());ok=h.get('ok') is True
  if ok:break
 except Exception:pass
 time.sleep(0.2)
assert ok,'new code did not become healthy'
print('HEALTH='+json.dumps(h))
c=json.loads(pathlib.Path('/mnt/data/qq-agent/data/config.json').read_text());secrets=[str(v) for v in c.get('providerKeys',{}).values() if v]+[str(c.get('server',{}).get('token') or ''),str(c.get('onebot',{}).get('accessToken') or '')]
text=subprocess.check_output(['journalctl','--user','-u','qq-agent-linux.service','-n','180','--no-pager','-o','json'],text=True)
shown=[]
for line in text.splitlines():
 try:m=str(json.loads(line).get('MESSAGE',''))
 except Exception:continue
 if not re.search(r'\[http\]|ReferenceError:|TypeError:|SELF_EVOLUTION|ACCOUNT_NAMESPACE|宿主账号|账号命名|Embedding.*失败',m):continue
 for s in secrets:
  if s:m=m.replace(s,'[REDACTED]')
 m=re.sub(r'sk-[A-Za-z0-9_-]{12,}','[REDACTED]',m)
 shown.append(m[:500])
print('SANITIZED_TECHNICAL_ERRORS='+json.dumps(shown[-15:],ensure_ascii=True))
PY
