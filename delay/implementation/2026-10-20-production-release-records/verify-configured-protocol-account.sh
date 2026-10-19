printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -euo pipefail
sudo -n python3 - <<'PY'
import pathlib,json,re,os,sqlite3
root=pathlib.Path('/mnt/data/qq-agent/snowluma/data/config');data=pathlib.Path('/mnt/data/qq-agent/data');r=pathlib.Path('/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY')
c=json.loads((data/'config.json').read_text());o=c['onebot'];http_token=o.get('httpAccessToken') or o.get('accessToken') or '';ws_token=o.get('accessToken') or ''
assert root.resolve()==root and r.resolve()==r
candidates=[];summaries=[]
for p in sorted(root.glob('onebot_*.json')):
 match=re.fullmatch(r'onebot_([1-9][0-9]{4,14})\.json',p.name)
 if not match:continue
 obj=json.loads(p.read_text());net=obj.get('networks') or {};hs=net.get('httpServers') or [];ws=net.get('wsServers') or []
 hm=any(str(v.get('port'))=='3000' and bool(http_token) and str(v.get('accessToken') or '')==http_token for v in hs)
 wm=any(str(v.get('port'))=='3001' and bool(ws_token) and str(v.get('accessToken') or '')==ws_token for v in ws)
 summaries.append({'httpPortAndTokenMatch':hm,'wsPortAndTokenMatch':wm,'httpEntries':len(hs),'wsEntries':len(ws)})
 if hm and wm:candidates.append((match.group(1),p))
dbpath=data/'plugins/self-evolution/state.sqlite';accounts=set()
if dbpath.exists():
 db=sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True)
 try:accounts={str(v[0]) for v in db.execute('select distinct account_id from notebook_notes')}
 finally:db.close()
numeric={v for v in accounts if re.fullmatch('[1-9][0-9]{4,14}',v)}
verified=len(candidates)==1 and numeric=={candidates[0][0]}
if verified:
 ident,p=candidates[0];out=r/'verified-configured-onebot-identity.json'
 out.write_text(json.dumps({'source':'existing_unique_protocol_config_with_matching_agent_tokens_ports_and_notebook_account','selfId':ident,'notLiveLoginProof':True,'noAccountRebinding':True}));out.chmod(0o600);os.chown(out,1000,1000)
print(json.dumps({'perAccountConfigCount':len(summaries),'matchingProtocolAccountCount':len(candidates),'numericNotebookOwnerCount':len(numeric),'nonNumericNotebookNamespaceCount':len(accounts-numeric),'configuredAccountVerifiedAgainstNotebookOwner':verified,'candidateBindings':summaries,'actualIdNotPrinted':True,'protocolFilesModified':False}))
PY
