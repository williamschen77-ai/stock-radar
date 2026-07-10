// 共用的 MoneyDJ ETF 持股爬蟲，供即時查詢 (etf-holdings.js) 與每日快照
// (cron/snapshot-etf.js) 共用，避免兩邊邏輯各自為政、日後改一邊忘改另一邊。

export const ACTIVE_ETF_CODES = [
  "0050", "0056", "006208",
  "00878", "00881", "00891", "00892", "00900",
  "00919", "00929", "00934", "00940", "00944", "00946",
  "00679B",
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

  const rowRe = /etfid=(\d+)\.TW[^']*'>([^(<]+)\([^)]*\)<\/a><\/td><td class="col06">([\d.]+)<\/td><td class="col07">([\d,]+)<\/td>/g;
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

  return { code, name, asOf, holdings };
}
