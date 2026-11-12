/* 比特幣週期儀表板 — 前端繪圖。資料由 GitHub Actions 每天寫入 data/*.json。 */
(async function () {
  const C = { btc: "#f7931a", sth: "#4ea1ff", tmm: "#c38bff", d200: "#3fb68b", w200: "#e5534b", real: "#8b95a3",
              up: "#3fb68b", down: "#e5534b", grid: "#262d37", text: "#c9d1d9", muted: "#8b95a3" };
  const DAY = 86400000;

  const load = (f) => fetch(`data/${f}?v=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null);
  const [onchain, etf, dat, macro, status, snaps] = await Promise.all(
    ["onchain.json", "etf.json", "dat.json", "macro.json", "status.json", "dat_snapshots.json"].map(load));

  // ---------- helpers
  const fmt = (v, d = 0) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const usd = (v, d = 0) => v == null ? "—" : "$" + fmt(v, d);
  const big = (v) => { if (v == null) return "—"; const a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e12) return s + "$" + fmt(a / 1e12, 2) + "T"; if (a >= 1e9) return s + "$" + fmt(a / 1e9, 2) + "B";
    if (a >= 1e6) return s + "$" + fmt(a / 1e6, 1) + "M"; return s + "$" + fmt(a, 0); };
  const pct = (v, d = 1) => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : "") + fmt(v * 100, d) + "%";
  const cls = (v) => v == null ? "" : v >= 0 ? "pos" : "neg";
  const el = (tag, attrs = {}, text) => { const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const lastOf = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return [i, arr[i]]; return [-1, null]; };
  const empty = (id, msg) => { const n = document.getElementById(id); n.innerHTML = ""; n.appendChild(el("div", { class: "empty" }, msg)); n.style.height = "auto"; };

  const charts = [];
  const mk = (id) => { const c = echarts.init(document.getElementById(id), null, { renderer: "canvas" }); charts.push(c); return c; };
  window.addEventListener("resize", () => charts.forEach(c => c.resize()));

  const baseAxis = () => ({ axisLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true },
                            splitLine: { lineStyle: { color: C.grid } } });
  const tooltip = (valFmt) => ({ trigger: "axis", confine: true, backgroundColor: "#1c2128", borderColor: C.grid,
    textStyle: { color: C.text, fontSize: 12 }, axisPointer: { type: "cross", label: { backgroundColor: "#30363d" } },
    formatter: (ps) => { if (!ps.length) return ""; let s = `<b>${iso(ps[0].value[0])}</b>`;
      for (const p of ps) { const v = p.value[1]; if (v == null) continue;
        s += `<br>${p.marker}${p.seriesName}：${(p.series && p.series.fmt || valFmt)(v)}`; } return s; } });
  const legend = (sel) => ({ top: 0, textStyle: { color: C.text, fontSize: 11 }, itemWidth: 14, itemHeight: 8, selected: sel || {} });
  const zoomFor = (days, data0) => { if (!days) return { startValue: data0 }; return { startValue: Date.now() - days * DAY }; };

  // ---------- on-chain arrays
  const t0 = onchain ? Date.parse(onchain.start + "T00:00:00Z") : 0;
  const ts = (i) => t0 + i * DAY;
  const pairs = (arr) => arr.map((v, i) => [ts(i), v]).filter(p => p[1] != null);
  const mapPairs = (m) => Object.entries(m || {}).map(([d, v]) => [Date.parse(d + "T00:00:00Z"), v]);
  const priceAt = (d) => { if (!onchain) return null; const i = Math.round((Date.parse(d + "T00:00:00Z") - t0) / DAY);
    for (let j = Math.min(i, onchain.price.length - 1); j >= 0; j--) if (onchain.price[j] != null) return onchain.price[j]; return null; };
  const pricePairs = onchain ? pairs(onchain.price) : [];
  const fromYear = (p, y) => p.filter(x => x[0] >= Date.parse(y + "-01-01"));

  // ---------- header
  if (status && status._run) document.getElementById("updated").textContent = "最後更新：" + status._run.replace("T", " ").slice(0, 16) + " UTC";

  // ---------- 1. overview cards
  (function cards() {
    const box = document.getElementById("cards");
    const add = (k, v, d, valCls, spark) => { const c = el("div", { class: "card" }); c.appendChild(el("div", { class: "k" }, k));
      c.appendChild(el("div", { class: "v " + (valCls || "") }, v)); if (d) c.appendChild(el("div", { class: "d" }, d));
      if (spark) { const s = el("div", { class: "spark" }); c.appendChild(s); box.appendChild(c); sparkline(s, spark); } else box.appendChild(c); };
    if (onchain) {
      const [pi, p] = lastOf(onchain.price);
      const p30 = onchain.price[pi - 30];
      add("BTC 價格", usd(p), `${iso(ts(pi))} 收盤・30 日 ${pct(p / p30 - 1)}`, "", pricePairs.slice(-180));
      // live price straight from CoinGecko in the reader's browser (falls back to the daily close)
      const card = box.lastChild;
      fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true")
        .then(r => r.json()).then(j => { const lp = j.bitcoin.usd, ch = j.bitcoin.usd_24h_change / 100;
          card.querySelector(".k").textContent = "BTC 價格（即時）";
          card.querySelector(".v").textContent = usd(lp);
          card.querySelector(".d").textContent = `24 小時 ${pct(ch)}・CoinGecko`;
          card.querySelector(".d").className = "d " + cls(ch); }).catch(() => {});
      const [zi, z] = lastOf(onchain.mvrvz);
      add("MVRV Z-Score", fmt(z, 2), `${iso(ts(zi))}・30 天前 ${fmt(onchain.mvrvz[zi - 30], 2)}`, "", pairs(onchain.mvrvz).slice(-180));
      const [, s200] = lastOf(onchain.sma200d);
      add("距 200 日均線", pct(p / s200 - 1), `200 日均線 ${usd(s200)}`, cls(p / s200 - 1));
      const sth = Object.entries(onchain.sth_map || {}).pop();
      if (sth) { const pd = priceAt(sth[0]); add("距短期持有者成本", pct(pd / sth[1] - 1), `STH 成本 ${usd(sth[1])}（${sth[0]}）`, cls(pd / sth[1] - 1)); }
    }
    if (etf) {
      const cut = Date.now() - 30 * DAY; let s = 0;
      etf.daily.forEach(r => { if (Date.parse(r.date) >= cut && r.total != null) s += r.total; });
      add("ETF 近 30 日淨流量", big(s * 1e6), `截至 ${etf.daily[etf.daily.length - 1].date}`, cls(s));
    }
    if (dat) {
      const cut = Date.now() - 30 * DAY; let s = 0;
      dat.dailyFlowsBtc.forEach(([d, v]) => { if (Date.parse(d) >= cut) s += v; });
      add("DAT 近 30 日淨買入", (s >= 0 ? "+" : "") + fmt(s) + " BTC", `合計持有 ${fmt(dat.totalBtc)} BTC`, cls(s));
      const m = dat.institutions.filter(r => r.mnav != null);
      const below = m.filter(r => r.mnav < 1).length;
      add("mNAV < 1 的 DAT", fmt(below / m.length * 100, 0) + "%", `${below} / ${m.length} 家有 mNAV 數據的公司`);
    }
  })();

  function sparkline(node, data) {
    const c = echarts.init(node); charts.push(c);
    c.setOption({ animation: false, grid: { left: 0, right: 0, top: 2, bottom: 2 }, xAxis: { type: "time", show: false },
      yAxis: { type: "value", show: false, scale: true }, tooltip: { show: false },
      series: [{ type: "line", data, showSymbol: false, lineStyle: { width: 1.2, color: C.btc }, areaStyle: { color: "rgba(247,147,26,.12)" } }] });
  }

  // ---------- 2. main price chart + 3. MVRV Z
  let mainChart, mvrvChart;
  if (onchain) {
    mainChart = mk("chart-main");
    const line = (name, data, color, extra = {}) => ({ name, type: "line", data, showSymbol: false, sampling: "lttb",
      lineStyle: { width: name === "BTC 價格" ? 1.6 : 1.2, color }, itemStyle: { color }, fmt: (v) => usd(v), ...extra });
    mainChart.setOption({
      animation: false, legend: legend({ "已實現價格": false }), tooltip: tooltip(usd),
      grid: { left: 58, right: 14, top: 44, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: { type: "log", logBase: 10, ...baseAxis(), axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v >= 1000 ? "$" + v / 1000 + "k" : "$" + v } },
      dataZoom: [{ type: "inside", ...zoomFor(1461) }],
      series: [
        line("BTC 價格", pricePairs, C.btc),
        line("短期持有者成本", mapPairs(onchain.sth_map), C.sth),
        line("True Market Mean", mapPairs(onchain.tmm_map), C.tmm),
        line("200 日均線", pairs(onchain.sma200d), C.d200),
        line("200 週均線", pairs(onchain.sma200w), C.w200, { lineStyle: { width: 1.2, color: C.w200, type: "dashed" } }),
        line("已實現價格", pairs(onchain.realized), C.real, { lineStyle: { width: 1, color: C.real, type: "dotted" } }),
      ] });

    mvrvChart = mk("chart-mvrv");
    mvrvChart.setOption({
      animation: false, tooltip: tooltip((v) => fmt(v, 2)),
      grid: { left: 58, right: 14, top: 10, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: { type: "value", ...baseAxis() },
      dataZoom: [{ type: "inside", ...zoomFor(1461) }],
      series: [{ name: "MVRV Z-Score", type: "line", data: pairs(onchain.mvrvz), showSymbol: false, sampling: "lttb",
                 lineStyle: { width: 1.3, color: C.sth }, itemStyle: { color: C.sth },
                 markLine: { silent: true, symbol: "none", lineStyle: { color: C.muted, type: "dashed" }, label: { show: false }, data: [{ yAxis: 0 }] } }] });
    mainChart.group = mvrvChart.group = "cycle";
    echarts.connect("cycle");
  } else { empty("chart-main", "價格資料讀取失敗"); empty("chart-mvrv", "—"); }

  // range buttons
  document.querySelectorAll(".ranges").forEach(g => g.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    g.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
    const days = +b.dataset.range;
    const targets = g.dataset.target === "main" ? [mainChart] : [etfChart];
    targets.forEach(c => c && c.dispatchAction({ type: "dataZoom", ...(days ? { startValue: Date.now() - days * DAY, endValue: Date.now() } : { start: 0, end: 100 }) }));
  }));

  // ---------- 4. holders
  const dualPrice = (id, name, data, color, unitFmt, axisFmt, startYear) => {
    const c = mk(id);
    c.setOption({ animation: false, legend: legend(), tooltip: tooltip(unitFmt),
      grid: { left: 54, right: 54, top: 34, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: [{ type: "value", scale: true, ...baseAxis(), axisLabel: { color: C.muted, fontSize: 11, formatter: axisFmt } },
              { type: "log", ...baseAxis(), splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => "$" + v / 1000 + "k" } }],
      series: [{ name, type: "line", data, showSymbol: false, sampling: "lttb", lineStyle: { width: 1.5, color }, itemStyle: { color }, fmt: unitFmt },
               { name: "BTC 價格", type: "line", yAxisIndex: 1, data: fromYear(pricePairs, startYear), showSymbol: false, sampling: "lttb",
                 lineStyle: { width: 1, color: C.btc, opacity: .55 }, itemStyle: { color: C.btc }, fmt: (v) => usd(v) }] });
    return c;
  };
  if (onchain && Object.keys(onchain.lth_map || {}).length) {
    const lp = mapPairs(onchain.lth_map);
    dualPrice("chart-lth", "長期持有者供給", lp, C.d200, (v) => fmt(v / 1e6, 3) + "M BTC", (v) => fmt(v / 1e6, 1) + "M", iso(lp[0][0]).slice(0, 4));
    document.getElementById("lth-note").textContent = "幣齡 6 個月以上的供給（BGeometrics HODL Waves 加總，免費版只有近 4 年、延遲 7 天）。";
  } else empty("chart-lth", "長期持有者資料暫時無法取得");
  if (onchain) {
    const ex = pairs(onchain.exch);
    dualPrice("chart-exch", "交易所餘額", ex, C.sth, (v) => fmt(v / 1e6, 3) + "M BTC", (v) => fmt(v / 1e6, 1) + "M", "2015");
    document.getElementById("exch-note").textContent = "Coin Metrics 追蹤的交易所錢包合計餘額；看長期方向，短期數值會因錢包標記調整而跳動。";
  }

  // ---------- 5. ETF
  let etfChart;
  if (etf && etf.daily.length) {
    etfChart = mk("chart-etf");
    let cum = 0; const bars = [], cumL = [];
    etf.daily.forEach(r => { const t = Date.parse(r.date + "T00:00:00Z"); const v = r.total ?? 0; cum += v;
      bars.push({ value: [t, v], itemStyle: { color: v >= 0 ? C.up : C.down } }); cumL.push([t, cum / 1000]); });
    etfChart.setOption({ animation: false, legend: legend(), tooltip: tooltip((v) => fmt(v, 1)),
      grid: { left: 58, right: 54, top: 34, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: [{ type: "value", name: "每日（$M）", nameTextStyle: { color: C.muted, fontSize: 11 }, ...baseAxis() },
              { type: "value", name: "累計（$B）", nameTextStyle: { color: C.muted, fontSize: 11 }, ...baseAxis(), splitLine: { show: false } }],
      dataZoom: [{ type: "inside", ...zoomFor(365) }],
      series: [{ name: "每日淨流量", type: "bar", data: bars, barMaxWidth: 6, itemStyle: { color: C.up }, fmt: (v) => (v >= 0 ? "+" : "") + "$" + fmt(v, 1) + "M" },
               { name: "累計淨流入", type: "line", yAxisIndex: 1, data: cumL, showSymbol: false, lineStyle: { width: 1.5, color: C.btc }, itemStyle: { color: C.btc }, fmt: (v) => "$" + fmt(v, 2) + "B" }] });

    // table
    const tbl = document.getElementById("etf-table");
    const last = etf.daily[etf.daily.length - 1].date;
    const sumSince = (f, days) => { const cut = Date.parse(last) - (days - 1) * DAY; let s = 0;
      etf.daily.forEach(r => { if (Date.parse(r.date) >= cut) s += (f ? r.funds[f] : r.total) || 0; }); return s; };
    const hdr = el("tr"); ["ETF", "發行商", `最新一日（${last.slice(5)}）`, "近 7 日", "近 30 日", "AUM"].forEach(h => hdr.appendChild(el("th", {}, h)));
    tbl.appendChild(el("thead")).appendChild(hdr);
    const body = tbl.appendChild(el("tbody"));
    const rows = etf.funds.map(f => ({ f, d1: etf.daily[etf.daily.length - 1].funds[f] ?? 0, d7: sumSince(f, 7), d30: sumSince(f, 30), aum: etf.meta[f]?.aum, iss: etf.meta[f]?.issuer || "" }))
      .sort((a, b) => (b.aum || 0) - (a.aum || 0));
    const m = (v) => (v > 0 ? "+" : "") + fmt(v, 1);
    for (const r of rows) { const tr = body.appendChild(el("tr"));
      tr.appendChild(el("td", {}, r.f)); tr.appendChild(el("td", {}, r.iss));
      [r.d1, r.d7, r.d30].forEach(v => tr.appendChild(el("td", { class: cls(v) }, m(v))));
      tr.appendChild(el("td", {}, big(r.aum))); }
    const tot = body.appendChild(el("tr")); tot.appendChild(el("td", {}, "合計")); tot.appendChild(el("td", {}, ""));
    [etf.daily[etf.daily.length - 1].total, sumSince(null, 7), sumSince(null, 30)].forEach(v => tot.appendChild(el("td", { class: cls(v) }, m(v || 0))));
    tot.appendChild(el("td", {}, big(rows.reduce((s, r) => s + (r.aum || 0), 0))));
    const cap = tbl.appendChild(el("caption", { class: "note", style: "caption-side:bottom;text-align:left" }, `單位：百萬美元。流量截至 ${last}，來源 Farside；AUM 來源 DefiLlama。`));
  } else empty("chart-etf", "ETF 資料暫時無法取得");

  // ---------- 6. DAT
  if (dat) {
    // weekly totals (Mon-start) from DefiLlama daily BTC flows
    const wk = (d) => { const t = Date.parse(d + "T00:00:00Z"); const day = (new Date(t).getUTCDay() + 6) % 7; return t - day * DAY; };
    const weekly = new Map();
    dat.dailyFlowsBtc.forEach(([d, v]) => weekly.set(wk(d), (weekly.get(wk(d)) || 0) + v));
    // Strategy weekly change from our own daily snapshots (only once we have them)
    const sDates = Object.keys(snaps || {}).sort();
    const mstrW = new Map();
    for (let i = 1; i < sDates.length; i++) {
      const a = snaps[sDates[i - 1]].MSTR, b = snaps[sDates[i]].MSTR;
      if (a != null && b != null) mstrW.set(wk(sDates[i]), (mstrW.get(wk(sDates[i])) || 0) + (b - a));
    }
    const keys = [...weekly.keys()].sort((a, b) => a - b);
    const all = [], strat = [], other = [];
    keys.forEach(k => { const v = weekly.get(k);
      if (mstrW.has(k)) { strat.push([k, mstrW.get(k)]); other.push([k, v - mstrW.get(k)]); all.push([k, null]); }
      else { all.push([k, v]); strat.push([k, null]); other.push([k, null]); } });
    const c = mk("chart-dat");
    const bf = (v) => (v >= 0 ? "+" : "") + fmt(v) + " BTC";
    c.setOption({ animation: false, legend: legend(), tooltip: tooltip(bf),
      grid: { left: 64, right: 14, top: 34, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: { type: "value", ...baseAxis(), axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => fmt(v / 1000, 0) + "k" } },
      dataZoom: [{ type: "inside", startValue: Date.parse("2024-01-01") }],
      series: [{ name: "全體 DAT", type: "bar", stack: "d", data: all, itemStyle: { color: C.btc }, fmt: bf, barMaxWidth: 10 },
               { name: "Strategy", type: "bar", stack: "d", data: strat, itemStyle: { color: C.sth }, fmt: bf, barMaxWidth: 10 },
               { name: "其他公司", type: "bar", stack: "d", data: other, itemStyle: { color: C.tmm }, fmt: bf, barMaxWidth: 10 }] });
    document.getElementById("dat-note").textContent =
      `DefiLlama 追蹤的上市公司比特幣持有變化（依公告日加總）。Strategy 與其他公司的拆分，從網站每日記錄持幣快照開始累積（${sDates[0] || "—"} 起），之前的週數只有合計。可左右拖曳縮放。`;

    // top-10 table
    const tbl = document.getElementById("dat-table");
    const hdr = el("tr"); ["公司", "代號", "持幣量", "平均成本", "帳面損益", "mNAV", "近 30 日增減", "最近公告"].forEach(h => hdr.appendChild(el("th", {}, h)));
    tbl.appendChild(el("thead")).appendChild(hdr);
    const body = tbl.appendChild(el("tbody"));
    const p = onchain ? lastOf(onchain.price)[1] : null;
    const latestSnap = sDates[sDates.length - 1];
    const refSnap = sDates.find(d => Date.parse(latestSnap) - Date.parse(d) <= 30 * DAY);
    const longEnough = refSnap && Date.parse(latestSnap) - Date.parse(refSnap) >= 25 * DAY;
    dat.institutions.slice(0, 10).forEach(r => { const tr = body.appendChild(el("tr"));
      const name = r.name.replace(/\s*\(Formerly:.*?\)/, "");
      const pl = r.avg && p ? p / r.avg - 1 : null;
      let chg = "累積中"; if (longEnough) { const a = snaps[refSnap][r.ticker || r.name]; chg = a != null ? (r.btc - a >= 0 ? "+" : "") + fmt(r.btc - a) : "—"; }
      [name, r.ticker || "—", fmt(r.btc), r.avg ? usd(r.avg) : "—"].forEach(v => tr.appendChild(el("td", {}, v)));
      tr.appendChild(el("td", { class: cls(pl) }, pct(pl)));
      tr.appendChild(el("td", { class: r.mnav != null && r.mnav < 1 ? "neg" : "" }, r.mnav != null ? fmt(r.mnav, 2) : "—"));
      tr.appendChild(el("td", {}, chg)); tr.appendChild(el("td", {}, r.last || "—")); });
    tbl.appendChild(el("caption", { class: "note", style: "caption-side:bottom;text-align:left" },
      "帳面損益以最新 BTC 價格對比平均成本；mNAV 為市值 ÷ 持幣價值（DefiLlama realized mNAV）。「近 30 日增減」需累積 30 天快照才會出現。"));

    // Strategy mNAV
    if (dat.mstrMnav && dat.mstrMnav.length) {
      const mc = mk("chart-mstr");
      mc.setOption({ animation: false, tooltip: tooltip((v) => fmt(v, 2) + "x"),
        grid: { left: 44, right: 14, top: 12, bottom: 28 },
        xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
        yAxis: { type: "value", ...baseAxis(), axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => v + "x" } },
        dataZoom: [{ type: "inside" }],
        series: [{ name: "Strategy mNAV", type: "line", data: (() => { const a = dat.mstrMnav.filter(([d]) => d >= "2024-08-08"); const i = a.findIndex(([, v]) => v >= 1); return a.slice(Math.max(i, 0)); })().map(([d, v]) => [Date.parse(d + "T00:00:00Z"), v]), showSymbol: false,
                   lineStyle: { width: 1.4, color: C.sth }, itemStyle: { color: C.sth },
                   markLine: { silent: true, symbol: "none", lineStyle: { color: C.down, type: "dashed" }, label: { color: C.down, formatter: "1.0x", position: "insideEndTop" }, data: [{ yAxis: 1 }] } }] });
      const mstr = dat.institutions.find(r => r.ticker === "MSTR");
      document.getElementById("mstr-note").textContent =
        `目前持有 ${fmt(mstr?.btc)} BTC，平均成本 ${usd(mstr?.avg)}。mNAV 從 2024-08 股票分割後開始畫（之前的資料未調整分割，數值失真）。資金來源拆分（普通股／STRC／債務）沒有免費的結構化資料，這版先不放。`;
    } else empty("chart-mstr", "Strategy mNAV 資料暫時無法取得");
  } else { empty("chart-dat", "DAT 資料暫時無法取得"); }

  // ---------- 7. macro
  const mp = (arr) => (arr || []).map(([d, v]) => [Date.parse(d.length === 7 ? d + "-01" : d), v]);
  const btcSince = fromYear(pricePairs, "2015");
  function macroDual(id, name, data, color, fmtV, axisFmt) {
    const c = mk(id);
    c.setOption({ animation: false, legend: legend(), tooltip: tooltip(fmtV),
      grid: { left: 58, right: 54, top: 34, bottom: 28 },
      xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } },
      yAxis: [{ type: "value", scale: true, ...baseAxis(), axisLabel: { color: C.muted, fontSize: 11, hideOverlap: true, formatter: axisFmt } },
              { type: "log", ...baseAxis(), splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 11, formatter: (v) => "$" + v / 1000 + "k" } }],
      series: [{ name, type: "line", data, showSymbol: false, lineStyle: { width: 1.5, color }, itemStyle: { color }, fmt: fmtV },
               { name: "BTC 價格", type: "line", yAxisIndex: 1, data: btcSince, showSymbol: false, sampling: "lttb",
                 lineStyle: { width: 1, color: C.btc, opacity: .6 }, itemStyle: { color: C.btc }, fmt: (v) => usd(v) }] });
    return c;
  }
  if (macro) {
    // M2 with adjustable lead
    if (macro.m2 && macro.m2.length) {
      const base = mp(macro.m2);
      const m2c = macroDual("chart-m2", "美國 M2", base, C.d200, (v) => "$" + fmt(v / 1000, 2) + "T", (v) => "$" + fmt(v / 1000, 0) + "T");
      const lag = document.getElementById("lag"), lv = document.getElementById("lag-val");
      lag.addEventListener("input", () => { lv.textContent = lag.value;
        m2c.setOption({ series: [{ name: `美國 M2（往後移 ${lag.value} 天）`, data: base.map(([t, v]) => [t + lag.value * DAY, v]) }] }); });
    } else { empty("chart-m2", "M2 資料暫時無法取得（來源：聯準會 H.6 經 DBnomics）"); document.querySelector(".lag").style.display = "none"; }

    // net liquidity = Fed assets − TGA − RRP, on Fed-asset (weekly) dates
    if (macro.fedassets && macro.tga && macro.rrp) {
      const asof = (arr) => { const a = arr.map(([d, v]) => [Date.parse(d), v]); return (t) => { let lo = 0, hi = a.length - 1, r = null;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= t) { r = a[m][1]; lo = m + 1; } else hi = m - 1; } return r; }; };
      const tg = asof(macro.tga), rr = asof(macro.rrp);
      const nl = macro.fedassets.map(([d, v]) => { const t = Date.parse(d); const a = tg(t), b = rr(t); return [t, a != null ? v - a - (b || 0) : null]; }).filter(p => p[1] != null);
      macroDual("chart-netliq", "淨流動性", nl, C.sth, (v) => "$" + fmt(v / 1000, 2) + "T", (v) => "$" + fmt(v / 1000, 1) + "T");
    } else empty("chart-netliq", "聯準會資產負債表資料暫時無法取得，無法計算淨流動性");

    const small = (id, arr, color, f) => { if (!arr || !arr.length) return empty(id, "暫時無法取得");
      const c = mk(id); c.setOption({ animation: false, tooltip: tooltip(f), grid: { left: 40, right: 10, top: 10, bottom: 24 },
        xAxis: { type: "time", ...baseAxis(), splitLine: { show: false } }, yAxis: { type: "value", scale: true, ...baseAxis() },
        series: [{ name: id === "chart-dxy" ? "DXY" : "利率", type: "line", data: mp(arr).filter(p => p[0] >= Date.parse("2018-01-01")), showSymbol: false, sampling: "lttb", lineStyle: { width: 1.3, color }, itemStyle: { color }, fmt: f }] }); };
    small("chart-ff", macro.effr, C.btc, (v) => fmt(v, 2) + "%");
    small("chart-real", macro.real10, C.tmm, (v) => fmt(v, 2) + "%");
    small("chart-dxy", macro.dxy, C.sth, (v) => fmt(v, 2));
  }

  // ---------- sources & status
  (function statusTable() {
    const tbl = document.getElementById("status-table");
    const hdr = el("tr"); ["項目", "來源", "狀態", "資料最新日期", "最後成功更新（UTC）"].forEach(h => hdr.appendChild(el("th", {}, h)));
    tbl.appendChild(el("thead")).appendChild(hdr); const body = tbl.appendChild(el("tbody"));
    const names = { onchain: "價格／MVRV／交易所餘額", bgeometrics: "STH 成本／True Market Mean", lth: "長期持有者供給", etf: "現貨 ETF", dat: "DAT 企業金庫", macro: "總經" };
    for (const [k, n] of Object.entries(names)) { const s = status && status[k]; if (!s) continue;
      const tr = body.appendChild(el("tr")); tr.appendChild(el("td", {}, n)); tr.appendChild(el("td", {}, s.source || ""));
      tr.appendChild(el("td", { class: s.ok ? "ok" : "bad" }, s.ok ? "正常" : "失敗（沿用上次資料）"));
      tr.appendChild(el("td", {}, s.latest || "—")); tr.appendChild(el("td", {}, (s.updated || "—").replace("T", " "))); }
    if (macro && macro.notes) for (const [k, v] of Object.entries(macro.notes)) {
      const tr = body.appendChild(el("tr")); tr.appendChild(el("td", {}, "　└ " + ({ effr: "聯邦基金利率", rrp: "逆回購", tga: "TGA", real10: "10 年期實質利率", dxy: "DXY", fedassets: "聯準會資產", m2: "M2" }[k] || k)));
      tr.appendChild(el("td", {}, v.label)); tr.appendChild(el("td", { class: v.ok ? "ok" : "bad" }, v.ok ? "正常" : "失敗"));
      tr.appendChild(el("td", {}, v.latest || "—")); tr.appendChild(el("td", {}, "")); }
  })();
})();
