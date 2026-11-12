"""Daily data fetcher for the BTC cycle dashboard.

Each source is fetched independently; a failure keeps the previous file and is
recorded in data/status.json, so one broken source never blanks the site.
Standard library only.
"""
import csv, io, json, math, os, re, sys, time, traceback
import urllib.request, urllib.parse
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
os.makedirs(DATA, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Accept": "*/*"}
NOW = datetime.now(timezone.utc)
TODAY = NOW.date().isoformat()
STATUS_PATH = os.path.join(DATA, "status.json")
status = json.load(open(STATUS_PATH)) if os.path.exists(STATUS_PATH) else {}


def log(*a):
    print(*a, flush=True)


def get(url, timeout=60, tries=3, headers=None):
    h = dict(UA)
    if headers: h.update(headers)
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            last = e
            code = getattr(e, "code", None)
            if code in (400, 401, 403, 404, 429):
                break
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url[:120]} -> {last!r}")


def get_json(url, **kw):
    return json.loads(get(url, **kw))


def load(name, default=None):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return default


def save(name, obj):
    with open(os.path.join(DATA, name), "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)


def mark(key, ok, source, err=None, latest=None):
    s = status.get(key, {})
    s["source"] = source
    s["checked"] = NOW.isoformat(timespec="minutes")
    if ok:
        s["ok"] = True
        s["updated"] = NOW.isoformat(timespec="minutes")
        s.pop("error", None)
        if latest: s["latest"] = latest
    else:
        s["ok"] = False
        s["error"] = str(err)[:300]
    status[key] = s


def run(key, source, fn):
    try:
        latest = fn()
        mark(key, True, source, latest=latest)
        log(f"[ok] {key} latest={latest}")
    except Exception as e:
        traceback.print_exc()
        mark(key, False, source, err=e)
        log(f"[FAIL] {key}: {e}")


def fnum(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def merge_series(old, new):
    """old/new: dict date->value; new wins."""
    out = dict(old or {})
    out.update({k: v for k, v in new.items() if v is not None})
    return dict(sorted(out.items()))


# ----------------------------------------------------------------- on-chain
CM = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"


def cm_metric(metric, start="2010-07-18"):
    q = urllib.parse.urlencode({"assets": "btc", "metrics": metric, "frequency": "1d",
                                "page_size": 10000, "start_time": start})
    url = f"{CM}?{q}"
    out = {}
    while url:
        d = get_json(url, timeout=90)
        for row in d.get("data", []):
            out[row["time"][:10]] = fnum(row.get(metric))
        url = d.get("next_page_url")
    return out


BG = "https://bitcoin-data.com/v1/"


def bg_series(endpoint, field=None):
    rows = get_json(BG + endpoint, timeout=90)
    if isinstance(rows, dict) and "error" in rows:
        raise RuntimeError(rows["error"])
    out = {}
    for r in rows:
        d = r.get("d")
        if not d: continue
        if field:
            out[d] = fnum(r.get(field))
        else:
            out[d] = r
    return out


def sma(vals, n):
    out, s, q = [], 0.0, []
    for v in vals:
        q.append(v)
        s += v if v is not None else 0
        if len(q) > n:
            old = q.pop(0)
            s -= old if old is not None else 0
        out.append(s / n if len(q) == n and all(x is not None for x in q) else None)
    return out


def lth_from_hodl(row):
    """Sum UTXO age bands of ~6 months and older. Field names vary, so parse them."""
    total, used = 0.0, []
    for k, v in row.items():
        if k in ("d", "unixTs") or fnum(v) is None:
            continue
        kl = k.lower()
        # pull the lower bound of the band, e.g. age_6m_12m, 1y_2y, 6m-12m, more10y, 10y+
        m = re.search(r"(\d+(?:\.\d+)?)\s*(d|w|m|y)", kl)
        if not m:
            continue
        n, u = float(m.group(1)), m.group(2)
        days = n * {"d": 1, "w": 7, "m": 30.4, "y": 365}[u]
        is_lower_more = kl.startswith(("more", "over", "gt")) or "+" in kl
        # bands written as "<x>_<y>" use the first number as lower bound; "less"/"lt"/"under" bands are young
        if kl.startswith(("less", "lt", "under", "0d")) and not is_lower_more:
            continue
        if days >= 180:
            total += fnum(v); used.append(k)
    return (total if used else None), used


def fetch_onchain():
    cols = {"price": "PriceUSD", "mcap": "CapMrktCurUSD", "mvrv": "CapMVRVCur",
            "supply": "SplyCur", "exch": "SplyExNtv"}
    raw = {}
    for k, m in cols.items():
        raw[k] = cm_metric(m)
        log(f"  coinmetrics {m}: {len(raw[k])} days")
    dates = sorted(raw["price"])
    first = date.fromisoformat(dates[0]); last = date.fromisoformat(dates[-1])
    days = [(first + timedelta(i)).isoformat() for i in range((last - first).days + 1)]
    price = [raw["price"].get(d) for d in days]
    mcap = [raw["mcap"].get(d) for d in days]
    mvrv = [raw["mvrv"].get(d) for d in days]
    realized, mvrvz = [], []
    # MVRV Z = (MC - RC) / stdev(MC), stdev expanding over history to date (no look-ahead)
    n = s1 = s2 = 0.0
    for p, mc, mv in zip(price, mcap, mvrv):
        rp = p / mv if (p and mv) else None
        realized.append(round(rp, 2) if rp else None)
        if mc:
            n += 1; s1 += mc; s2 += mc * mc
        if mc and mv and n > 30:
            sd = math.sqrt(max(s2 / n - (s1 / n) ** 2, 0))
            rc = mc / mv
            mvrvz.append(round((mc - rc) / sd, 3) if sd else None)
        else:
            mvrvz.append(None)
    out = {
        "start": days[0], "end": days[-1],
        "price": [round(v, 2) if v else None for v in price],
        "realized": realized,
        "mvrvz": mvrvz,
        "sma200d": [round(v, 2) if v else None for v in sma(price, 200)],
        "sma200w": [round(v, 2) if v else None for v in sma(price, 1400)],
        "exch": [round(raw["exch"][d]) if raw["exch"].get(d) else None for d in days],
    }
    prev = load("onchain.json", {}) or {}
    for k in ("sth", "tmm", "lth"):
        out[k + "_map"] = prev.get(k + "_map", {})
    save("onchain.json", out)
    return days[-1]


def fetch_bgeometrics():
    last_ok = status.get("bgeometrics", {}).get("updated")
    if last_ok and os.environ.get("FORCE_BG") != "1" and \
            NOW - datetime.fromisoformat(last_ok) < timedelta(hours=20):
        log("  bgeometrics refreshed recently; skipping to respect the free-plan limit")
        prev = load("onchain.json")
        return max(prev["sth_map"]) if prev and prev.get("sth_map") else None
    prev = load("onchain.json")
    if not prev:
        raise RuntimeError("onchain.json missing")
    sth = bg_series("sth-realized-price", "sthRealizedPrice")
    tmm = bg_series("true-market-mean", "trueMarketMean")
    prev["sth_map"] = merge_series(prev.get("sth_map"), {k: round(v, 2) for k, v in sth.items() if v})
    prev["tmm_map"] = merge_series(prev.get("tmm_map"), {k: round(v, 2) for k, v in tmm.items() if v})
    try:
        hodl = bg_series("hodl-waves-supply")
        sample = next(iter(hodl.values()))
        log("  hodl-waves fields:", list(sample.keys()))
        lth = {}
        used = []
        for d, row in hodl.items():
            v, used = lth_from_hodl(row)
            if v: lth[d] = round(v)
        log("  hodl bands used for LTH:", used)
        if lth:
            prev["lth_map"] = merge_series(prev.get("lth_map"), lth)
            mark("lth", True, "BGeometrics hodl-waves-supply（≥6 個月幣齡）", latest=max(lth))
        else:
            mark("lth", False, "BGeometrics hodl-waves-supply", err=f"unrecognised fields {list(sample.keys())[:12]}")
    except Exception as e:
        mark("lth", False, "BGeometrics hodl-waves-supply", err=e)
    save("onchain.json", prev)
    return max(prev["sth_map"]) if prev["sth_map"] else None


# ----------------------------------------------------------------- ETF
def parse_num(s):
    s = re.sub(r"<[^>]+>", "", s).strip().replace(",", "")
    if s in ("", "-", "—"): return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def fetch_etf():
    h = get("https://farside.co.uk/bitcoin-etf-flow-all-data/", timeout=90)
    t0 = h.find('<table class="etf"')
    t1 = h.find("</table>", t0)
    table = h[t0:t1]
    head = re.search(r"<thead>(.*?)</thead>", table, re.S).group(1)
    # header row with tickers is the first <tr> in thead
    first_tr = re.search(r"<tr[^>]*>(.*?)</tr>", head, re.S).group(1)
    cols = [re.sub(r"<[^>]+>", "", c).strip() for c in re.findall(r"<th[^>]*>(.*?)</th>", first_tr, re.S)]
    body = table[table.find("</thead>"):]
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(cells) != len(cols): continue
        dtxt = re.sub(r"<[^>]+>", "", cells[0]).strip()
        try:
            d = datetime.strptime(dtxt, "%d %b %Y").date().isoformat()
        except ValueError:
            continue  # Total / Average / etc.
        vals = {c: parse_num(v) for c, v in zip(cols[1:], cells[1:])}
        if all(vals.get(c) is None for c in cols[1:] if c.lower() != "total"):
            continue  # today's row before Farside fills it in
        rows.append({"date": d, **vals})
    if not rows:
        raise RuntimeError("no rows parsed from Farside")
    funds = [c for c in cols[1:] if c.lower() != "total"]
    daily = [{"date": r["date"], "total": r.get("Total"), "funds": {f: r.get(f) for f in funds if r.get(f) is not None}} for r in rows]
    daily.sort(key=lambda r: r["date"])
    # AUM per fund from DefiLlama
    aum = {}
    try:
        nd = next_data("https://defillama.com/etfs")
        for s in nd.get("snapshot", []):
            if s.get("asset") == "bitcoin":
                aum[s["ticker"]] = {"aum": s.get("aum"), "issuer": s.get("issuer"), "name": s.get("etf_name")}
    except Exception as e:
        log("  defillama etf aum failed:", e)
    save("etf.json", {"unit": "USD m", "funds": funds, "daily": daily, "meta": aum})
    return daily[-1]["date"]


def next_data(url):
    h = get(url, timeout=90)
    m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', h, re.S)
    if not m:
        raise RuntimeError("no __NEXT_DATA__ on " + url)
    return json.loads(m.group(1))["props"]["pageProps"]


# ----------------------------------------------------------------- DAT
def fetch_dat():
    pp = next_data("https://defillama.com/digital-asset-treasuries/bitcoin")
    inst = []
    for i in pp["institutions"]:
        hd = i.get("holdings") or {}
        inst.append({"name": i.get("name"), "ticker": i.get("ticker"), "btc": hd.get("amount"),
                     "avg": hd.get("avgPrice"), "cost": hd.get("cost"), "value": hd.get("usdValue"),
                     "mnav": i.get("realized_mNAV"), "last": hd.get("lastAnnouncementDate")})
    inst.sort(key=lambda r: -(r["btc"] or 0))
    flows = [[datetime.fromtimestamp(ts / 1000, timezone.utc).date().isoformat(), v]
             for ts, v in pp["dailyFlowsChart"]["dataset"]["source"]]
    mc = pp["mNAVRealizedChart"]
    dims = mc["dimensions"]
    mstr_i = dims.index("MSTR") if "MSTR" in dims else None
    mstr_mnav = []
    if mstr_i:
        for row in mc["source"]:
            if row[mstr_i] is not None:
                mstr_mnav.append([datetime.fromtimestamp(row[0] / 1000, timezone.utc).date().isoformat(), round(row[mstr_i], 4)])
    # daily snapshot of every company's holdings -> per-company changes over time
    snaps = load("dat_snapshots.json", {}) or {}
    snaps[TODAY] = {r["ticker"] or r["name"]: r["btc"] for r in inst if r["btc"]}
    save("dat_snapshots.json", dict(sorted(snaps.items())))
    meta = pp.get("metadata", {})
    save("dat.json", {"institutions": inst, "dailyFlowsBtc": flows, "mstrMnav": mstr_mnav,
                      "totalBtc": meta.get("totalAmount"), "companies": meta.get("companies")})
    return flows[-1][0] if flows else TODAY


# ----------------------------------------------------------------- macro
def yahoo(symbol, rng="max"):
    d = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?range={rng}&interval=1d", timeout=60)
    r = d["chart"]["result"][0]
    out = {}
    for ts, c in zip(r["timestamp"], r["indicators"]["quote"][0]["close"]):
        if c is not None:
            out[datetime.fromtimestamp(ts, timezone.utc).date().isoformat()] = round(c, 3)
    return out


def nyfed_effr(start="2015-01-01"):
    d = get_json(f"https://markets.newyorkfed.org/api/rates/unsecured/effr/search.json?startDate={start}&endDate={TODAY}", timeout=90)
    return {r["effectiveDate"]: r["percentRate"] for r in d["refRates"]}


def nyfed_rrp(start="2015-01-01"):
    out = {}
    y0 = int(start[:4])
    for y in range(y0, NOW.year + 1):
        s, e = f"{y}-01-01", min(f"{y}-12-31", TODAY)
        d = get_json(f"https://markets.newyorkfed.org/api/rp/reverserepo/propositions/search.json?startDate={s}&endDate={e}", timeout=90)
        for op in d["repo"]["operations"]:
            dt = op["operationDate"]
            out[dt] = out.get(dt, 0) + (op.get("totalAmtAccepted") or 0) / 1e9  # USD bn
    return out


def tga(start="2015-01-01"):
    out = {}
    base = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance"
    page = 1
    while True:
        q = {"fields": "record_date,account_type,close_today_bal,open_today_bal",
             "filter": f"record_date:gte:{start}", "sort": "record_date", "page[size]": 10000, "page[number]": page}
        d = get_json(base + "?" + urllib.parse.urlencode(q), timeout=120)
        for r in d["data"]:
            at = r["account_type"]
            v = None
            if "TGA" in at and "Opening" in at:          # 2021+: opening balance = prior day close
                v = fnum(r["open_today_bal"])
            elif at.startswith("Federal Reserve Account"):  # pre-2021 layout
                v = fnum(r["close_today_bal"])
            if v is not None:
                out[r["record_date"]] = v / 1000           # USD m -> bn
        meta = d.get("meta", {})
        if page >= meta.get("total-pages", 1): break
        page += 1
    return out


def treasury_real10(y0=2015):
    out = {}
    for y in range(y0, NOW.year + 1):
        url = (f"https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/{y}/all"
               f"?type=daily_treasury_real_yield_curve&field_tdr_date_value={y}&page&_format=csv")
        txt = get(url, timeout=90)
        for r in csv.DictReader(io.StringIO(txt)):
            v = fnum(r.get("10 YR"))
            if v is None: continue
            m, d_, yy = r["Date"].split("/")
            out[f"{yy}-{m}-{d_}"] = v
    return out


DBN = "https://api.db.nomics.world/v22"


def dbnomics_find(dataset, query, must, avoid=("change", "discontinued", "preferred")):
    d = get_json(f"{DBN}/series/{dataset}?" + urllib.parse.urlencode({"q": query, "limit": 200, "observations": 0}), timeout=90)
    docs = d.get("series", {}).get("docs", [])
    for s in docs:
        name = s.get("series_name", "")
        nl = name.lower()
        if all(m.lower() in nl for m in must) and not any(a in nl for a in avoid):
            return s["series_code"], name
    log(f"  {dataset} candidates:", [(s.get("series_code"), s.get("series_name")) for s in docs[:60]])
    raise RuntimeError(f"no series in {dataset} matching {must}; saw {[s.get('series_name') for s in docs[:8]]}")


def dbnomics_obs(dataset, code):
    d = get_json(f"{DBN}/series/{dataset}/{code}?observations=1", timeout=120)
    s = d["series"]["docs"][0]
    out = {}
    for p, v in zip(s["period"], s["value"]):
        if v is None or v == "NA": continue
        out[str(p)[:10] if len(str(p)) >= 10 else str(p) + "-01"] = float(v)
    return out, s.get("series_name")


def fetch_macro():
    prev = load("macro.json", {}) or {}
    out = dict(prev)
    notes = {}

    def part(key, fn, label):
        try:
            v = fn()
            if not v: raise RuntimeError("empty")
            out[key] = sorted([[k, round(x, 4)] for k, x in v.items()])
            notes[key] = {"ok": True, "label": label, "latest": out[key][-1][0]}
            log(f"  macro {key}: {len(v)} pts, last {out[key][-1]}")
        except Exception as e:
            traceback.print_exc()
            notes[key] = {"ok": False, "label": label, "error": str(e)[:200]}

    part("effr", nyfed_effr, "紐約聯準會 EFFR")
    part("rrp", nyfed_rrp, "紐約聯準會逆回購")
    part("tga", tga, "美國財政部 Daily Treasury Statement")
    part("real10", treasury_real10, "美國財政部實質殖利率曲線")
    part("dxy", lambda: yahoo("DX-Y.NYB", "10y"), "Yahoo Finance DX-Y.NYB")

    def walcl():
        for code in ("H0.RESPPANWW_N.WW", "H0.RESPPA_N.WW", "RESPPANWW_N.WW"):
            try:
                v, name = dbnomics_obs("FED/H41", code)
                log("  H41 series:", code, name)
                return {k: x / 1000 for k, x in v.items() if k >= "2015"}
            except Exception as e:
                log("  H41 try", code, e)
        code, name = dbnomics_find("FED/H41", "total assets", ["total assets", "wednesday level"], avoid=("change", "discontinued", "preferred", "week average", "maturity", "within", "over "))
        log("  H41 series:", code, name)
        v, _ = dbnomics_obs("FED/H41", code)
        return {k: x / 1000 for k, x in v.items() if k >= "2015"}  # USD m -> bn
    part("fedassets", walcl, "聯準會 H.4.1（DBnomics）")

    def m2():
        last_err = None
        for code in ("M2.M", "M2_N.M", "M2_S.M"):
            try:
                v, name = dbnomics_obs("FED/H6_H6_M2", code)
                log("  M2 series:", code, name)
                return {k: x for k, x in v.items() if k >= "2015"}
            except Exception as e:
                log("  m2 code try", code, e)
        for ds in ("FED/H6_H6_M2",):
            try:
                code, name = dbnomics_find(ds, "M2", ["m2", "seasonally adjusted"], avoid=("not seasonally", "percent", "change", "weekly", "week"))
                log("  M2 series:", ds, code, name)
                v, _ = dbnomics_obs(ds, code)
                return {k: x for k, x in v.items() if k >= "2015"}
            except Exception as e:
                log('  m2 try', ds, e)
                last_err = e
        # list FED datasets to help debugging
        try:
            d = get_json(f"{DBN}/datasets/FED?limit=100", timeout=60)
            log("  FED datasets:", [x.get("code") for x in d.get("datasets", {}).get("docs", [])])
        except Exception:
            pass
        raise RuntimeError(last_err)
    part("m2", m2, "聯準會 H.6 M2（DBnomics）")

    out["notes"] = notes
    save("macro.json", out)
    bad = [k for k, v in notes.items() if not v["ok"]]
    if len(bad) == len(notes):
        raise RuntimeError("all macro parts failed")
    return ", ".join(f"{k}✗" for k in bad) or "全部成功"


if __name__ == "__main__":
    only = sys.argv[1:]
    jobs = [
        ("onchain", "Coin Metrics 社群版 API", fetch_onchain),
        ("bgeometrics", "BGeometrics 免費 API（延遲 7 天）", fetch_bgeometrics),
        ("etf", "Farside Investors／DefiLlama", fetch_etf),
        ("dat", "DefiLlama Digital Asset Treasuries", fetch_dat),
        ("macro", "NY Fed／US Treasury／DBnomics／Yahoo", fetch_macro),
    ]
    for key, src, fn in jobs:
        if only and key not in only: continue
        run(key, src, fn)
    status["_run"] = NOW.isoformat(timespec="minutes")
    with open(STATUS_PATH, "w") as f:
        json.dump(status, f, ensure_ascii=False, indent=1)
