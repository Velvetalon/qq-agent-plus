printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
umask 077
MAINT=/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3
NODE=/mnt/data/qq-agent/app/.runtime/node-v22.23.2-linux-x64/bin/node
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
[ "$(readlink -f "$MAINT")" = "$MAINT" ]
cd "$MAINT"
printf '%s  %s\n' 6725e3d1ed4d76fa3bb9af5704aca628ae1a9050e67fc9dbce66ff8dd16146a8 source-91beebbcc3.tar.gz | sha256sum --check
python3 - <<'PY'
import tarfile,pathlib,hashlib,json
root=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3')
assert not (root/'source').exists()
manifest={}
with tarfile.open(root/'source-91beebbcc3.tar.gz','r:gz') as t:
 for m in t.getmembers():
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute() and p.parts[0]=='source' and '..' not in p.parts
  assert m.isfile() or m.isdir(), 'unexpected archive entry type'
  if m.isfile():
   name=str(pathlib.PurePosixPath(*p.parts[1:]))
   if name.startswith(('src/','scripts/','ui/','test/live/')) or name in {'package.json','package-lock.json','deploy.sh','deploy-all.sh','manage.sh'}:
    manifest[name]=hashlib.sha256(t.extractfile(m).read()).hexdigest()
 t.extractall(root)
(root/'expected-source-sha256.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'archiveVerified':True,'controlledFiles':len(manifest)}))
PY
export PATH="$(dirname "$NODE"):$PATH"
cd "$MAINT/source"
set +e
npm ci --omit=dev --ignore-scripts > "$MAINT/npm-prepare.log" 2>&1
NPM_STATUS=$?
set -e
printf 'NPM_PREPARE_EXIT=%s\n' "$NPM_STATUS"
[ "$NPM_STATUS" = 0 ]
cat > "$MAINT/offline-guard.mjs" <<'JS'
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const logFile = new URL('./blocked-network.jsonl', import.meta.url);
function local(host) { const v=String(host||'localhost').toLowerCase().replace(/^\[|\]$/g,''); return v==='localhost'||v==='::1'||/^127\.\d+\.\d+\.\d+$/.test(v); }
function block() { fs.appendFileSync(logFile,JSON.stringify({pid:process.pid,blocked:true})+'\n'); throw Object.assign(new Error('OFFLINE_EXTERNAL_NETWORK_BLOCKED'),{code:'OFFLINE_NETWORK_BLOCKED'}); }
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const first=Array.isArray(args[0])?args[0]:args;const o=first[0];if(o&&typeof o==='object'){if(!o.path&&!local(o.host||o.hostname))block();}else if(typeof o==='number'&&typeof first[1]==='string'&&!local(first[1]))block();return connect.apply(this,args);};
const send=dgram.Socket.prototype.send;
dgram.Socket.prototype.send=function(...args){const address=args.findLast(v=>typeof v==='string');if(!address||!local(address))block();return send.apply(this,args);};
syncBuiltinESMExports();
JS
cat > "$MAINT/offline-checks.mjs" <<'JS'
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const result=[];const save=()=>fs.writeFileSync(new URL('./offline-checks.json',import.meta.url),JSON.stringify({results:result},null,2));
assert.throws(()=>new net.Socket().connect({host:'offline-control.invalid',port:443}),/OFFLINE_EXTERNAL_NETWORK_BLOCKED/);
const files=['src','scripts','test','ui'].flatMap(dir=>fs.readdirSync(dir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&/\.(?:m?js)$/.test(e.name)).map(e=>path.join(e.parentPath,e.name)));
for(const f of files){const r=spawnSync(process.execPath,['--check',f],{stdio:'inherit'});if(r.status!==0){result.push({check:'syntax',file:f,exitCode:r.status});save();process.exit(1);}}
result.push({check:'syntax',files:files.length,exitCode:0});save();
for(const args of [['src/ops.js','scan','--strict'],['test/local/run.mjs'],['test/test-prompt.mjs'],['test/render-test.mjs'],['test/scroll-test.mjs'],['test/usage-e2e.mjs'],['scripts/sqlite-vec-smoke.mjs']]){const r=spawnSync(process.execPath,args,{stdio:'inherit'});result.push({command:['node',...args],exitCode:r.status});save();if(r.status!==0)process.exit(1);}
console.log(JSON.stringify({status:'OFFLINE_CHECKS_PASS',results:result}));
JS
mkdir -m 700 "$MAINT/test-home" "$MAINT/test-xdg"
export HOME="$MAINT/test-home" XDG_RUNTIME_DIR="$MAINT/test-xdg" QQ_AGENT_DATA_DIR="$MAINT/test-data" NODE_OPTIONS="--import=file://$MAINT/offline-guard.mjs"
unset DBUS_SESSION_BUS_ADDRESS OPENAI_API_KEY DEEPSEEK_API_KEY NANOGPT_API_KEY QQ_AGENT_CONSOLE_TOKEN QQ_AGENT_ONEBOT_TOKEN QQ_REPLAY_API_KEY QQ_REPLAY_KEY_FILE
set +e
"$NODE" --test --test-concurrency=2 test/*.test.mjs > "$MAINT/linux-unit.log" 2>&1
UNIT_STATUS=$?
set -e
python3 - "$UNIT_STATUS" <<'PY'
import pathlib,json,re,sys
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3');text=(r/'linux-unit.log').read_text(errors='replace');out={'exitCode':int(sys.argv[1])}
for key in ['tests','pass','fail','cancelled','skipped']:
 matches=re.findall(r'^# '+key+r' (\d+)',text,re.M);out[key]=int(matches[-1]) if matches else None
out['failureTitles']=re.findall(r'^not ok \d+ - (.*)',text,re.M)
(r/'linux-unit-summary.json').write_text(json.dumps(out,indent=2));print('LINUX_UNIT='+json.dumps(out))
PY
[ "$UNIT_STATUS" = 0 ]
set +e
"$NODE" "$MAINT/offline-checks.mjs" > "$MAINT/offline-checks.log" 2>&1
AUX_STATUS=$?
set -e
printf 'AUXILIARY_EXIT=%s\n' "$AUX_STATUS"
python3 - <<'PY'
import pathlib,json
p=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3/offline-checks.json');print('AUXILIARY='+p.read_text() if p.exists() else 'AUXILIARY_SUMMARY_MISSING')
PY
[ "$AUX_STATUS" = 0 ]
printf 'NODE_AND_AUXILIARY_VALIDATION=PASS\n'

unset QQ_DEPLOY_CLEANUP_SCRIPT
set +e
python3 "$MAINT/source/test/production-embedding-cleanup.test.py" > "$MAINT/python-cleanup.log" 2>&1
PYTHON_STATUS=$?
set -e
python3 - "$PYTHON_STATUS" <<'PY'
import pathlib,json,re,sys
r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3');txt=(r/'python-cleanup.log').read_text(errors='replace');n=re.search(r'Ran (\d+) tests?',txt)
s={'exitCode':int(sys.argv[1]),'unittestMethods':int(n.group(1)) if n else None,'testFile':'production-embedding-cleanup.test.py','source':'frozen cleanup AST only','notProductionIO':True}
(r/'python-cleanup-summary.json').write_text(json.dumps(s,indent=2));print('PYTHON_CLEANUP='+json.dumps(s))
PY
[ "$PYTHON_STATUS" = 0 ]
printf 'CANDIDATE_VALIDATION=PASS\n'
