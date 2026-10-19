#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
APP=/mnt/data/qq-agent/app
printf 'SERVICE_STATE\n'; systemctl --user show qq-agent-linux.service --property=ActiveState,SubState,UnitFileState,MainPID,WorkingDirectory,FragmentPath,ExecMainStatus,ExecMainStartTimestamp,NRestarts --no-pager
printf '\nUPDATE_TIMER_STATE\n'; systemctl --user show qq-agent-linux-update.timer --property=ActiveState,SubState,UnitFileState --no-pager
printf '\nUPDATE_SERVICE_STATE\n'; systemctl --user show qq-agent-linux-update.service --property=ActiveState,SubState,ExecMainStatus --no-pager
printf '\nDEPLOYMENT_AND_CONFIG_SANITIZED\n'
python3 - <<'PY'
import json,pathlib,os,stat,hashlib,urllib.request,urllib.parse
app=pathlib.Path('/mnt/data/qq-agent/app');d=json.loads((app/'.deployment.json').read_text());data=pathlib.Path(d['data']);c=json.loads((data/'config.json').read_text())
def presence(v):return bool(isinstance(v,str) and v.strip())
def endpoint(v):
 try:
  p=urllib.parse.urlsplit(str(v or ''));return {'scheme':p.scheme,'host':p.hostname,'port':p.port,'path':p.path}
 except Exception:return {'valid':False}
e=(c.get('selfEvolution') or {}).get('retrieval',{}).get('embedding',{})
summary={'deployment':{k:d.get(k) for k in ['root','data','node','service','host','port','repository','branch']},'realPaths':{'app':str(app.resolve()),'data':str(data.resolve())},'configPermissions':oct(stat.S_IMODE((data/'config.json').stat().st_mode)),'runtime':c.get('runtime'),'conversationMode':c.get('conversation',{}).get('mode'),'api':{'endpoint':endpoint(c.get('api',{}).get('baseUrl')),'provider':c.get('api',{}).get('provider'),'model':c.get('api',{}).get('model'),'thinking':c.get('api',{}).get('thinking'),'inlineKeyPresent':presence(c.get('api',{}).get('apiKey')),'fallbackEnabled':c.get('api',{}).get('fallback',{}).get('enabled')},'providerKeyPresence':{k:bool(v) for k,v in (c.get('providerKeys') or {}).items()},'embedding':{k:e.get(k) for k in ['enabled','provider','model','dimension','endpoint']},'embeddingInlineKeyPresent':presence(e.get('apiKey')),'socialReview':{k:c.get('conversation',{}).get('social',{}).get(k) for k in ['reviewMaxOutputTokens','reviewTimeoutMs']},'autoUpdateEnabled':c.get('autoUpdate',{}).get('enabled'),'sourceVersion':json.loads((app/'package.json').read_text()).get('version'),'nodeExists':pathlib.Path(d['node']).is_file(),'deployLockExists':(data/'.deploy.lock').exists(),'backupDirectories':[p.name for p in (data/'deploy-backups').glob('*') if p.is_dir()]}
rev=data/'deployed-revision';summary['deployedRevision']=rev.read_text().strip() if rev.exists() else None
print(json.dumps(summary,ensure_ascii=False))
host=c['server']['host'];host='127.0.0.1' if host=='0.0.0.0' else host
try:
 r=urllib.request.urlopen('http://'+host+':'+str(c['server']['port'])+'/healthz',timeout=10);h=json.loads(r.read());print('HEALTH='+json.dumps(h,ensure_ascii=False))
except Exception as ex:print('HEALTH_ERROR='+type(ex).__name__)
PY
printf '\nDIRECTORY_OWNERS\n'; stat -c '%U %G %a %n' /mnt/data/qq-agent /mnt/data/qq-agent/app /mnt/data/qq-agent/data
printf '\nSIZES\n'; du -sh /mnt/data/qq-agent/app /mnt/data/qq-agent/data /mnt/data/qq-agent/data/deploy-backups 2>/dev/null || true
printf '\nREQUIRED_TOOLS\n'; for c in rsync curl tar sha256sum python3 git; do command -v "$c"; done
printf '\nNODE\n'; NODE=$(python3 -c 'import json;print(json.load(open("/mnt/data/qq-agent/app/.deployment.json"))["node"])'); "$NODE" --version
printf '\nLINGER\n'; loginctl show-user ubuntu -p Linger --value
