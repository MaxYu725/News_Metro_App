import os, json, time, urllib.request, urllib.error
end = int(time.time()*1000)
body = {"queryId":"topic-ai-diagnosis", "timeframe":{"from":end-3600000,"to":end}, "view":"events", "limit":30, "parameters":{"filters":[{"key":"$metadata.service","operation":"eq","type":"string","value":"news-proxy"},{"key":"$metadata.message","operation":"includes","type":"string","value":"topic-ai-update-failed"}]}}
url = 'https://api.cloudflare.com/client/v4/accounts/'+os.environ['CF_ACCOUNT_ID']+'/workers/observability/telemetry/query'
req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Authorization':'Bearer '+os.environ['CF_API_TOKEN'],'Content-Type':'application/json'})
try:
    with urllib.request.urlopen(req, timeout=45) as res: data=json.load(res)
except urllib.error.HTTPError as e:
    print('Telemetry query HTTP', e.code)
    raise SystemExit(1)
print('Query success:',data.get('success'))
print('Result keys:',list(data.get('result',{})))
# Only application failure records, never request headers, IPs, tokens or URLs.
def visit(v):
    if isinstance(v,dict):
        message=v.get('$metadata',{}).get('message','') if isinstance(v.get('$metadata'),dict) else ''
        if 'topic-ai-update-failed' in str(message):
            print(json.dumps({'message':message,'applicationFields':{k:val for k,val in v.items() if k in ('name','stage','code')}},ensure_ascii=False))
        for k,val in v.items():
            if k in ('logs','message') and 'topic-ai-update-failed' in str(val): print('Failure log:',json.dumps(val,ensure_ascii=False)[:500])
            elif isinstance(val,(dict,list)): visit(val)
    elif isinstance(v,list):
        for x in v: visit(x)
visit(data.get('result',{}))
