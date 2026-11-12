# 比特幣週期儀表板

週期級別持有用的客觀數據，GitHub Actions 每天 09:17（台北時間）自動抓取並重新發布。

網站：https://maxhuang1030.github.io/btc-dashboard/

| 區塊 | 資料來源 |
|---|---|
| 價格、市值、MVRV、已實現價格、交易所餘額 | Coin Metrics 社群版 API |
| 短期持有者成本、True Market Mean、長期持有者供給 | BGeometrics 免費 API（延遲 7 天） |
| 現貨 ETF 每日流量 | Farside Investors；AUM 取自 DefiLlama |
| DAT 企業金庫 | DefiLlama Digital Asset Treasuries |
| 總經 | NY Fed、美國財政部、DBnomics（聯準會 H.4.1／H.6）、Yahoo Finance |

手動更新：Actions → update-data → Run workflow。
