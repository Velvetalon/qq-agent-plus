# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT AN EXECUTION ENTRY POINT.
raise SystemExit("Archived snapshot only. Read README; do not execute this incomplete operator code.")
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
import ast,json,pathlib,re,shutil,subprocess
root=pathlib.Path(__file__).parent;bash=r'E:\Git\bin\bash.exe';node=shutil.which('node');py_count=0;js_count=0;cases=0
for name in ['prepare.sh','validate.sh','apply-update.sh','launch-update.sh','prelaunch-check.sh']:
 code=(root/name).read_text()
 r=subprocess.run([bash,'-n',str(root/name).replace('\\','/')],capture_output=True,text=True);assert r.returncode==0,(name,r.stderr)
 for i,part in enumerate(re.findall(r"python3[^\n]*<<'PY'\n(.*?)\nPY(?:\n|$)",code,re.S)):
  parsed=ast.parse(part);compile(parsed,name+':python'+str(i),'exec');py_count+=1
  for item in ast.walk(parsed):
   if isinstance(item,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='node_code' for t in item.targets):
    snippet=ast.literal_eval(item.value);r=subprocess.run([node,'--check','--input-type=module'],input=snippet,text=True,capture_output=True);assert r.returncode==0,(name,r.stderr);js_count+=1
 for part in re.findall(r"<<'JS'\n(.*?)\nJS(?:\n|$)",code,re.S):
  r=subprocess.run([node,'--check','--input-type=module'],input=part,text=True,capture_output=True);assert r.returncode==0,(name,r.stderr);js_count+=1

def run(code):return subprocess.run([bash,'--noprofile','--norc','-se'],input=code,text=True,capture_output=True)
for name in ['apply-update.sh','launch-update.sh']:
 code=(root/name).read_text();identity='\n'.join(re.findall(r'^\[ .*\$\(id .*$',code,re.M))
 assert identity and '&&' not in identity
 for user,uid,allowed in [('root','0',False),('ubuntu','0',False),('ubuntu','1000',True),('other','1000',False)]:
  body="set -euo pipefail\nid(){ if [ \"$1\" = -un ]; then printf '%s\\n' '"+user+"'; else printf '%s\\n' '"+uid+"'; fi; }\n"+identity+'\nprintf GUARD_PASSED\n'
  r=run(body);assert (r.returncode==0)==allowed,(name,user,uid,r.stdout,r.stderr);assert ('GUARD_PASSED' in r.stdout)==allowed;cases+=1
code=(root/'apply-update.sh').read_text()
blocks=re.findall(r'(if systemctl --user is-active --quiet[^\n]*; then\n.*?\nfi)',code,re.S)
assert len(blocks)==2
for block in blocks:
 for active in [True,False]:
  body='set -euo pipefail\nSERVICE=synthetic\nsystemctl(){ return '+('0' if active else '3')+'; }\n'+block+'\nprintf GUARD_PASSED\n'
  r=run(body);assert (r.returncode==0)==(not active),(active,r.stdout,r.stderr);assert ('GUARD_PASSED' in r.stdout)==(not active);cases+=1
for old in ['! true','false && true']:
 r=run('set -euo pipefail\n'+old+'\nprintf OLD_BUG_CONTINUES\n');assert r.returncode==0 and 'OLD_BUG_CONTINUES' in r.stdout
result={'shellFiles':5,'pythonBlocks':py_count,'javascriptBlocks':js_count,'guardCases':cases,'oldBashHazardsReproduced':2,'status':'PASS'}
(root/'operator-script-tests.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
