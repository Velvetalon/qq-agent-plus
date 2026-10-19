#!/usr/bin/env bash
# ARCHIVED INCOMPLETE IMPLEMENTATION: NOT A DEPLOYMENT ENTRY POINT.
printf "Archived snapshot only. Read README and revalidate before materializing executable code.\n" >&2
exit 64
# BEGIN PRESERVED IMPLEMENTATION BODY (sanitized paths)
set -eu
python3 - <<'PY'
import os,socket,json,urllib.parse
out={}
for h in ['api.nano-gpt.com','nano-gpt.com']:
 try:out[h]=sorted({v[4][0] for v in socket.getaddrinfo(h,443,type=socket.SOCK_STREAM)})
 except Exception as e:out[h]={'dnsError':type(e).__name__}
proxies={}
for k in ['http_proxy','https_proxy','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY']:
 if os.environ.get(k):
  v=urllib.parse.urlsplit(os.environ[k]);proxies[k]={'scheme':v.scheme,'host':v.hostname,'port':v.port}
print(json.dumps({'dns':out,'proxyPresence':proxies}))
PY
for url in https://api.nano-gpt.com/api/v1/embeddings https://nano-gpt.com/api/v1/embeddings; do
 printf 'UNAUTHENTICATED_HEAD=%s\n' "$url"
 curl --head --silent --show-error --connect-timeout 10 --max-time 20 --output /dev/null --write-out '{"http":%{http_code},"connect":%{time_connect},"tls":%{time_appconnect},"firstByte":%{time_starttransfer},"total":%{time_total}}\n' "$url" || true
done
