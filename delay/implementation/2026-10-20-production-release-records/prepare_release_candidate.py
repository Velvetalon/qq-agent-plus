raise SystemExit('Archived snapshot only')
import argparse,hashlib,json,pathlib,re,subprocess,tarfile
p=argparse.ArgumentParser();p.add_argument('--revision',required=True);a=p.parse_args();assert re.fullmatch('[0-9a-f]{40}',a.revision)
repo=pathlib.Path(r'E:\Code\qq-agent-plus');private=pathlib.Path(__file__).parent;short=a.revision[:10]
remote='/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY';vroot=remote+'/validation-'+short
archive=private/('source-'+short+'.tar.gz');assert not archive.exists()
subprocess.run(['git','archive','--format=tar.gz','--prefix=source/','--output='+str(archive),a.revision],cwd=repo,check=True)
archive_sha=hashlib.sha256(archive.read_bytes()).hexdigest();manifest={}
with tarfile.open(archive,'r:gz') as t:
 for m in t.getmembers():
  parts=pathlib.PurePosixPath(m.name).parts;assert parts[0]=='source' and '..' not in parts
  if m.isfile():
   name=str(pathlib.PurePosixPath(*parts[1:]))
   if name.startswith(('src/','scripts/','ui/','test/live/')) or name in {'package.json','package-lock.json','deploy.sh','deploy-all.sh','manage.sh'}:manifest[name]=hashlib.sha256(t.extractfile(m).read()).hexdigest()
manifest_sha=hashlib.sha256(json.dumps(manifest,indent=2).encode()).hexdigest();assert len(manifest)==142 and manifest_sha=='afca77f6d8e867c64498bd6bf7a5eb0db9b84764653b1cbf68c817faf055f7f3','business-source change requires new coordinator analysis'
text=(private/'validate.sh').read_text(encoding='utf-8')
text=text.replace(remote,vroot).replace('source-930bfb9.tar.gz',archive.name).replace('c3dc47754d3c81ef7776c1ee56ecc99898f7d957b6978cc755de27804b152a5b',archive_sha)
text=text.replace("printf 'CANDIDATE_VALIDATION=PASS\\n'","printf 'NODE_AND_AUXILIARY_VALIDATION=PASS\\n'")
text+='''\nunset QQ_DEPLOY_CLEANUP_SCRIPT
set +e
python3 "$MAINT/source/test/production-embedding-cleanup.test.py" > "$MAINT/python-cleanup.log" 2>&1
PYTHON_STATUS=$?
set -e
python3 - "$PYTHON_STATUS" <<'PY'
import pathlib,json,re,sys
r=pathlib.Path('__VALIDATION_ROOT__');txt=(r/'python-cleanup.log').read_text(errors='replace');n=re.search(r'Ran (\\d+) tests?',txt)
s={'exitCode':int(sys.argv[1]),'unittestMethods':int(n.group(1)) if n else None,'testFile':'production-embedding-cleanup.test.py','source':'frozen cleanup AST only','notProductionIO':True}
(r/'python-cleanup-summary.json').write_text(json.dumps(s,indent=2));print('PYTHON_CLEANUP='+json.dumps(s))
PY
[ "$PYTHON_STATUS" = 0 ]
printf 'CANDIDATE_VALIDATION=PASS\\n'
'''.replace('__VALIDATION_ROOT__',vroot)
validation=private/('validate-'+short+'.sh');validation.write_bytes(text.encode())
prepare=private/('prepare-'+short+'.sh');prepare.write_bytes(('set -eu\numask 077\n[ "$(id -un)" = ubuntu ]\n[ "$(id -u)" = 1000 ]\n[ "$(readlink -f "'+remote+'")" = "'+remote+'" ]\n[ ! -e "'+vroot+'" ]\nmkdir -m 700 "'+vroot+'"\nprintf "VALIDATION_DIRECTORY_READY\\n"\n').encode())
worker=(private/'apply-update.sh').read_text(encoding='utf-8')
worker=worker.replace('export QQ_AGENT_SOURCE_REVISION=930bfb900557b544888dfba29c9957cc3978018d','export QQ_AGENT_SOURCE_REVISION='+a.revision)
worker=worker.replace("assert (data/'deployed-revision').read_text().strip()=='930bfb900557b544888dfba29c9957cc3978018d'","assert (data/'deployed-revision').read_text().strip()=='"+a.revision+"'")
worker=worker.replace('cd "$MAINT/source"','cd "'+vroot+'/source"')
worker=worker.replace("(r/'linux-unit-summary.json')","(r/'validation-"+short+"'/'linux-unit-summary.json')").replace("(r/'offline-checks.json')","(r/'validation-"+short+"'/'offline-checks.json')")
worker=worker.replace("manifest_bytes=(r/'expected-source-sha256.json').read_bytes()","manifest_bytes=(r/'validation-"+short+"'/'expected-source-sha256.json').read_bytes()")
needle="assert all(v['exitCode']==0 for v in json.loads((r/'validation-"+short+"'/'offline-checks.json').read_text())['results'])"
assert needle in worker;worker=worker.replace(needle,needle+"\nassert json.loads((r/'validation-"+short+"'/'python-cleanup-summary.json').read_text())['exitCode']==0")
final=private/('apply-final-'+short+'.sh');final.write_bytes(worker.encode())
spec={'revision':a.revision,'short':short,'archive':archive.name,'archiveSHA256':archive_sha,'archiveBytes':archive.stat().st_size,'controlledFiles':len(manifest),'manifestSHA256':manifest_sha,'remoteValidation':vroot,'remoteSource':vroot+'/source','validationScript':validation.name,'prepareScript':prepare.name,'workerScript':final.name,'workerSHA256':hashlib.sha256(final.read_bytes()).hexdigest(),'businessCodeIdenticalToPreviously852PassedCandidate':True}
(private/('release-spec-'+short+'.json')).write_text(json.dumps(spec,indent=2),encoding='utf-8');print(json.dumps(spec))
