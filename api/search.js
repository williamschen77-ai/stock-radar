// 股票搜尋 API：從 FinMind 或 TWSE 取得完整股票清單
let cachedStocks = null;
let cacheTime = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json({ data: [] });

  // 快取1小時
  if (!cachedStocks || Date.now() - cacheTime > 3600000) {
    try {
      const r = await fetch('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo', {
        signal: AbortSignal.timeout(8000)
      });
      const d = await r.json();
      if (d?.data?.length) {
        cachedStocks = d.data.map(s => ({
          code: s.stock_id,
          name: s.stock_name,
          sector: s.industry_category || '其他',
          type: s.type
        }));
        cacheTime = Date.now();
      }
    } catch(_) {}
  }

  const query = q.trim().toLowerCase();
  const stocks = cachedStocks || [];

  const results = stocks.filter(s =>
    s.code?.startsWith(query) ||
    s.code === query ||
    s.name?.includes(q) ||
    s.sector?.includes(q)
  ).slice(0, 10);

  return res.json({ data: results });
}
