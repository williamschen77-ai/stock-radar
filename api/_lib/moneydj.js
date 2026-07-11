// 共用的 MoneyDJ ETF 持股爬蟲，供即時查詢 (etf-holdings.js) 與每日快照
// (cron/snapshot-etf.js) 共用，避免兩邊邏輯各自為政、日後改一邊忘改另一邊。

// Taiwan equity active ETFs.  The trailing "A" is the TWSE convention for
// active equity ETFs.  Keep this universe separate from passive ETFs: flow
// analytics must not silently mix the two products.
export const ACTIVE_ETF_CODES = [
  "00980A", "00981A", "00982A", "00984A", "00985A", "00986A",
  "00989A", "00990A", "00991A", "00992A", "00993A", "00994A",
  "00995A", "00996A", "00997A", "00998A", "00999A",
  "00403A", "00404A", "00405A", "00406A", "00407A",
];

export async function fetchEtfHoldings(code) {
  const url = `https://www.moneydj.com/ETF/X/Basic/Basic0007B.xdjhtm?etfid=${code}.TW`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(8000),
  });
  const html = await r.text();

  const titleMatch = html.match(/<title>([^<]*)<\/title>/);
  const name = titleMatch ? titleMatch[1].trim() : code;

  const dateMatch = html.match(/資料日期[：:]\s*(\d{4}\/\d{2}\/\d{2})/);
  const asOf = dateMatch ? dateMatch[1] : null;

  // ETF and constituent ids can contain an A suffix (active ETF).  MoneyDJ
  // still uses the same table layout for those pages.
  // Some active ETFs (e.g. global/AI-themed ones) also hold foreign stocks
  // (GOOGL.US, NVDA.US, ...). We only track TW/TWO-listed holdings here since
  // this app has no quote/chart pipeline for non-Taiwan tickers — but we still
  // count every row so callers can report an honest "X of Y holdings tracked"
  // instead of silently implying the fund only holds a couple of stocks.
  const totalRowRe = /class="col05"/g;
  const totalRows = (html.match(totalRowRe) || []).length;

  const rowRe = /etfid=([0-9A-Z]+)\.(?:TW|TWO)[^']*'>([^(<]+)\([^)]*\)<\/a><\/td><td class="col06">([\d.]+)<\/td><td class="col07">([\d,]+)<\/td>/g;
  const holdings = [];
  let m;
  while ((m = rowRe.exec(html))) {
    holdings.push({
      code: m[1],
      name: m[2],
      weight: parseFloat(m[3]),
      shares: parseInt(m[4].replace(/,/g, ''), 10),
    });
  }

  return { code, name, asOf, holdings, totalRows };
}
