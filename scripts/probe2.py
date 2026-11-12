import json, re, urllib.request, sys
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"}
def get(u,t=60):
    try:
        return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read().decode("utf-8","replace")
    except Exception as e:
        return "ERR "+repr(e)
def shape(o,d=0,maxd=4):
    pad="  "*d
    if d>maxd: return
    if isinstance(o,dict):
        for k,v in list(o.items())[:25]:
            t=type(v).__name__; extra=f" len={len(v)}" if isinstance(v,(list,dict,str)) else f" = {v}"
            if isinstance(v,str) and len(v)<60: extra=f" = {v!r}"
            print(f"{pad}{k}: {t}{extra}")
            if isinstance(v,(dict,list)): shape(v,d+1,maxd)
    elif isinstance(o,list) and o:
        print(f"{pad}[0] {json.dumps(o[0])[:300]}")
        if isinstance(o[0],(dict,list)): shape(o[0],d+1,maxd)
for u in ["https://defillama.com/etfs","https://defillama.com/digital-asset-treasuries","https://defillama.com/digital-asset-treasury/strategy-inc","https://defillama.com/digital-asset-treasuries/bitcoin"]:
    h=get(u); print("\n#####",u,len(h))
    m=re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',h,re.S)
    if not m: print("no next data"); print(h[:200]); continue
    d=json.loads(m.group(1)); print("buildId",d.get("buildId"),"page",d.get("page"))
    shape(d.get("props",{}).get("pageProps",{}),0,3)
h=get("https://bitcointreasuries.net/")
print("\n##### btreasuries", len(h)); 
for pat in [r'__NEXT_DATA__',r'application/json',r'Strategy',r'api\.[a-z.]+/[^"\' ]+']:
    print(pat, re.findall(pat,h)[:5])
for u in ["https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL","https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10&cosd=2026-10-01",
          "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_real_yield_curve&field_tdr_date_value=2026&page&_format=csv",
          "https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?range=5d&interval=1d"]:
    r=get(u,90); print("\n#####",u,len(r)); print(r[:300])
# farside table structure
h=get("https://farside.co.uk/bitcoin-etf-flow-all-data/")
i=h.find("<table"); print("\n##### farside table at",i); 
t=re.sub(r"\s+"," ",h[i:i+6000]); print(t[:3000])
print("...tail rows"); j=h.find("</table>",i); print(re.sub(r"\s+"," ",h[j-2500:j]))
