#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
python3 - <<'PY'
import pathlib,json,sqlite3
c=json.loads(pathlib.Path('/mnt/data/qq-agent/data/config.json').read_text());plugins=c.get('plugins') or {};raw=c.get('selfEvolution') or plugins.get('selfEvolution') or plugins.get('self-evolution') or {};r=raw.get('retrieval') or {};f=raw.get('reflection') or {};e=r.get('embedding') or {}
print(json.dumps({'canonicalPresent':bool(c.get('selfEvolution')),'legacySource':'plugins.selfEvolution' if plugins.get('selfEvolution') else 'plugins.self-evolution','rawKeys':sorted(raw),'retrievalKeys':sorted(r),'reflectionKeys':sorted(f),'master':raw.get('enabled'),'retrievalEnabled':r.get('enabled'),'reflectionEnabled':f.get('enabled'),'embeddingFields':{k:e.get(k) for k in ['enabled','provider','model','dimension','allowQuery','allowPrivate']},'embeddingKeyPresent':bool(e.get('apiKey') or e.get('key'))}))
p=pathlib.Path('/mnt/data/qq-agent/data/plugins/self-evolution/state.sqlite')
if p.exists():
 db=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True);names=[x[0] for x in db.execute("select name from sqlite_master where type='table'")];counts={}
 for name in ['notes','notebook_notes','reflection_jobs','embedding_jobs']:
  if name in names:counts[name]=db.execute('select count(*) from "'+name+'"').fetchone()[0]
 print(json.dumps({'notebookExists':True,'tables':names,'counts':counts}));db.close()
else:print(json.dumps({'notebookExists':False}))
PY
