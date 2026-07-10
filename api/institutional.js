// 三大法人買賣超（單位：張，1張=1,000股）
// TWSE（上市）用 T86 報表可查近幾個交易日；TPEx（上櫃）的公開資料僅提供最新一個交易日。
// TPEx 開放資料的欄位名稱含不一致的空白（例如 "...Include MainlandArea..."），
// 且部分欄位互為子字串（如 "Dealers-Difference" 是 "ForeignDealers-Difference" 的子字串），
// 故需去除所有空白後做「完全比對」，不能用 includes()。
function getField(row, target) {
  const t = target.replace(/\s+/g, '');
  for (const [k, v] of Object.entries(row)) {
    if (k.replace(/\s+/g, '') === t) return v;
  }
  return undefined;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const clean = v => Math.round((parseInt((v || '0').toString().replace(/,/g, '')) || 0) / 1000);
  const rows = [];

  // 1. TWSE（上市）：逐日查詢近14個曆日，取得約5個交易日的資料
  const today = new Date();
  for (let i = 0; i <= 14 && rows.length < 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await r.json();
      if (!data?.data) continue;

      const found = data.data.find(row => row[0] === code);
      if (found) {
        rows.push({
          date:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
          foreign: clean(found[4]),
          trust:   clean(found[10]),
          dealer:  clean(found[14]) + clean(found[16]),
          total:   clean(found[18]),
        });
      }
    } catch (_) {}
  }

  if (rows.length > 0) return res.json({ data: rows.reverse() });

  // 2. TPEx（上櫃）：官方公開資料僅提供最新一個交易日的快照
  try {
    const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading', {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    const found = Array.isArray(data) ? data.find(row => row.SecuritiesCompanyCode === code) : null;
    if (found) {
      const dateStr = found.Date; // 民國年格式 例如 1150709
      const m = dateStr.match(/^(\d{2,3})(\d{2})(\d{2})$/);
      const date = m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : dateStr;
      rows.push({
        date,
        foreign: clean(getField(found, 'ForeignInvestorsIncludeMainlandAreaInvestors-Difference')),
        trust:   clean(getField(found, 'SecuritiesInvestmentTrustCompanies-Difference')),
        dealer:  clean(getField(found, 'Dealers-Difference')),
        total:   clean(found.TotalDifference),
      });
    }
  } catch (_) {}

  return res.json({ data: rows });
}
