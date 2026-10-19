# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT AN EXECUTION ENTRY POINT.
raise SystemExit("Archived snapshot only. Read README; do not execute this incomplete operator code.")
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
import argparse,base64,hashlib,json,pathlib,sys,time,os,re
import paramiko
p=argparse.ArgumentParser();p.add_argument('--script');p.add_argument('--label',required=True);p.add_argument('--timeout',type=int,default=90);p.add_argument('--put-source');p.add_argument('--put-dest');args=p.parse_args()
log_root=pathlib.Path(os.environ['QQ_DEPLOY_EVIDENCE_DIR']).resolve()
repository=pathlib.Path(__file__).resolve().parents[3]
if repository==log_root or repository in log_root.parents:raise ValueError('evidence must remain outside checkout')
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',args.label):raise ValueError('invalid evidence label')
log_root.mkdir(parents=True,exist_ok=True)

allowed={'SERVER_HOST','SERVER_PORT','SERVER_USER','SERVER_PASSWD'};values={}
for line in pathlib.Path(os.environ['QQ_DEPLOY_SSH_CREDENTIALS']).read_text(encoding='utf-8-sig').splitlines():
 if not line.strip() or line.lstrip().startswith('#') or '=' not in line:continue
 key,value=line.split('=',1);key=key.strip()
 if key not in allowed:continue
 value=value.strip()
 if len(value)>1 and value[0]==value[-1] and value[0] in "\"'":value=value[1:-1]
 values[key]=value
client=paramiko.SSHClient();client.load_host_keys(str(pathlib.Path.home()/'.ssh'/'known_hosts'));client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 client.connect(values['SERVER_HOST'],port=int(values.get('SERVER_PORT','22')),username=values['SERVER_USER'],password=values['SERVER_PASSWD'],look_for_keys=False,allow_agent=False,timeout=15,auth_timeout=20,banner_timeout=20)
 key=client.get_transport().get_remote_server_key();print(json.dumps({'phase':args.label,'hostKeyVerified':True,'hostKeySHA256':base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')},ensure_ascii=False),flush=True)
 if args.put_source:
  if not args.put_dest or not args.put_dest.startswith('/'):raise ValueError('absolute remote transfer destination required')
  with client.open_sftp() as sftp:sftp.put(args.put_source,args.put_dest);sftp.chmod(args.put_dest,0o600)
  print(json.dumps({'uploadedBytes':pathlib.Path(args.put_source).stat().st_size,'destination':args.put_dest}),flush=True)
 if args.script:
  content=pathlib.Path(args.script).read_text(encoding='utf-8-sig').replace('\r\n','\n')
  stdin,stdout,stderr=client.exec_command('bash -se',timeout=args.timeout)
  stdin.write(content);stdin.flush();stdin.channel.shutdown_write()
  out=stdout.read().decode('utf-8','replace');err=stderr.read().decode('utf-8','replace');code=stdout.channel.recv_exit_status()
  # Scripts are written to emit only scoped, sanitized diagnostics, never config/key values.
  for secret in [values.get('SERVER_PASSWD','')]:
   if secret:out=out.replace(secret,'[REDACTED]');err=err.replace(secret,'[REDACTED]')
  (log_root/(args.label+'.stdout.log')).write_text(out,encoding='utf-8');(log_root/(args.label+'.stderr.log')).write_text(err,encoding='utf-8')
  print(out,end='');print(err,end='',file=sys.stderr);print(json.dumps({'phase':args.label,'exitCode':code}),flush=True);sys.exit(code)
finally:client.close()
