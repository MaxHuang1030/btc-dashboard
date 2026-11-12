#!/usr/bin/env bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
p(){ code=$(curl -s -L -A "$UA" -m 25 -o /tmp/o -w '%{http_code}' "$1"); echo "=== $code $1 ($(wc -c </tmp/o) bytes)"; head -c ${2:-400} /tmp/o | tr '\n' ' '; echo; }
CM="https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&frequency=1d&page_size=3&paging_from=end&metrics="
for m in PriceUSD CapMrktCurUSD CapRealUSD CapMVRVCur SplyCur SplyAct180d SplyAct1yr SplyExNtv SplyAct155d; do p "$CM$m" 300; done
B=https://bitcoin-data.com
for e in v1/mvrv-zscore v1/sth-realized-price v1/lth-realized-price v1/realized-price v1/true-market-mean v1/lth-supply v1/sth-supply v1/exchange-reserve v1/exchange-reserve-btc v1/exchange-netflow v1/active-realized-price v1/sth-mvrv; do p "$B/$e/last" 300; done
p "$B/v3/api-docs" 3000
p "$B/v1/api-docs" 1500
p "https://farside.co.uk/bitcoin-etf-flow-all-data/" 300
p "https://farside.co.uk/btc/" 300
p "https://defillama.com/etfs" 200
grep -o '__NEXT_DATA__' /tmp/o | head -1
p "https://defillama.com/digital-asset-treasuries" 200
grep -o 'https://[a-z.-]*llama\.fi/[A-Za-z0-9/_-]*' /tmp/o | sort -u | head -40
p "https://defillama.com/digital-asset-treasury/strategy" 200
p "https://api.llama.fi/etfs/flows" 300
p "https://api.llama.fi/etfs/snapshot" 300
p "https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL" 200
p "https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=5d&interval=1d" 300
p "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd" 200
p "https://bitcointreasuries.net/" 200
p "https://www.strategy.com/purchases" 200
grep -o 'https://[a-z.]*strategy\.com/[A-Za-z0-9/_.-]*' /tmp/o | sort -u | head -30
