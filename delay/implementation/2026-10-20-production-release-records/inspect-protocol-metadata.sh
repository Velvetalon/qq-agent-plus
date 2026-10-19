printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
python3 - <<'PY'
import json,subprocess,pathlib,urllib.parse
c=json.loads(pathlib.Path('/mnt/data/qq-agent/data/config.json').read_text());one=c['onebot']
print('CONFIGURED_PROTOCOL='+json.dumps({k:{'scheme':urllib.parse.urlsplit(str(one.get(k) or '')).scheme,'host':urllib.parse.urlsplit(str(one.get(k) or '')).hostname,'port':urllib.parse.urlsplit(str(one.get(k) or '')).port} for k in ['httpUrl','wsUrl']}))
prefix=['docker'];r=subprocess.run(prefix+['ps','-a','--format','{{.Names}}'],capture_output=True,text=True)
if r.returncode!=0:
 prefix=['sudo','-n','docker'];r=subprocess.run(prefix+['ps','-a','--format','{{.Names}}'],capture_output=True,text=True)
if r.returncode!=0:print('DOCKER_INVENTORY_UNAVAILABLE_EVEN_NONINTERACTIVE_SUDO');raise SystemExit(0)
print('DOCKER_METADATA_VIA='+('sudo_readonly' if prefix[0]=='sudo' else 'service_user'))
names=[n for n in r.stdout.splitlines() if any(s in n.lower() for s in ['qq','snowluma','napcat'])]
results=[]
for name in names:
 p=subprocess.run(prefix+['inspect',name],capture_output=True,text=True)
 if p.returncode:continue
 d=json.loads(p.stdout)[0]
 results.append({'name':name,'state':{k:d.get('State',{}).get(k) for k in ['Status','Running','ExitCode']},'ports':d.get('NetworkSettings',{}).get('Ports'),'mounts':[{'source':m.get('Source'),'destination':m.get('Destination'),'rw':m.get('RW')} for m in d.get('Mounts',[])]})
print('PROTOCOL_CONTAINER_METADATA='+json.dumps(results))
PY
