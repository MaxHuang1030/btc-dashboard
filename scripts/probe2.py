import json, re, urllib.request
UA={"User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36","Accept":"*/*"}
def get(u,t=40):
    try: return urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t).read().decode("utf-8","replace")
    except Exception as e: return "ERR "+repr(e)
for u in [
 "https://api.db.nomics.world/v22/series/FED/H6?limit=3&observations=1&q=M2",
 "https://api.db.nomics.world/v22/series/FED/H41?limit=3&q=total%20assets",
 "https://api.db.nomics.world/v22/providers/FRED",
 "https://markets.newyorkfed.org/api/rates/unsecured/effr/last/3.json",
 "https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate=2026-11-01",
 "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance?sort=-record_date&page[size]=3",
 "https://www.federalreserve.gov/datadownload/Output.aspx?rel=H41&series=c5a4a01fa66d8b5cdd4c51df4a1aa0bf&lastobs=5&from=&to=&filetype=csv&label=include&layout=seriescolumn",
 "https://www.federalreserve.gov/releases/h6/current/default.htm",
 "https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL",
]:
    r=get(u); print("\n#####",u,len(r)); print(r[:700])
h=get("https://defillama.com/digital-asset-treasuries/bitcoin")
print("\n##### links", sorted(set(re.findall(r'href="(/digital-asset-treasur[^"]+)"',h)))[:20])
m=re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',h,re.S)
d=json.loads(m.group(1))["props"]["pageProps"]
print("dailyFlowsChart tail", d["dailyFlowsChart"]["dataset"]["source"][-8:])
print("mNAV dims", d["mNAVRealizedChart"]["dimensions"][:6]); print("mNAV last", d["mNAVRealizedChart"]["source"][-1][:6])
print("topHolders", d["topHoldersSentence"])
