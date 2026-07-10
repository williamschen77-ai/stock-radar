export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });
  const token = process.env.FINMIND_TOKEN || '';
  if (!token) return res.json({ data: [], source: 'no_token' });

  const ACTIVE_ETFS = [
    { code:"00892", name:"富邦台灣半導體", mgr:"富邦投信" },
    { code:"00891", name:"中信關鍵半導體", mgr:"中信投信" },
    { code:"00881", name:"國泰台灣5G+",    mgr:"國泰投信" },
    { code:"00878", name:"國泰永續高股息",  mgr:"國泰投信" },
    { code:"00919", name:"群益台灣精選高息",mgr:"群益投信" },
    { code:"00929", name:"復華台灣科技優息",mgr:"復華投信" },
    { code:"00934", name:"中信成長高股息",  mgr:"中信投信" },
    { code:"00940", name:"元大台灣價值高息",mgr:"元大投信" },
    { code:"00900", name:"富邦特選高股息30",mgr:"富邦投信" },
    { code:"0050",  name:"元大台灣50",     mgr:"元大投信" },
    { code:"0056",  name:"元大高股息",      mgr:"元大投信" },
    { code:"006208",name:"富邦台50",        mgr:"富邦投信" },
    { code:"00944", name:"群益半導體收益",  mgr:"群益投信" },
    { code:"00946", name:"元大台灣晶圓製造",mgr:"元大投信" },
    { code:"00679B",name:"元大美債20年",    mgr:"元大投信" },
  ];

  // 計算日期區間（6個月）
  const today = new Date();
  const start = new Date(today); start.setMonth(start.getMonth() - 6);
  const startStr = start.toISOString().slice(0,10);
  const endStr   = today.toISOString().slice(0,10);

  try {
    // 並行查詢所有ETF成分股
    const results = await Promise.all(
      ACTIVE_ETFS.map(async (etf) => {
        try {
          // FinMind TaiwanETFComponents dataset
          const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanETFComponents&data_id=${etf.code}&start_date=${startStr}&end_date=${endStr}&token=${token}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
          const d = await r.json();
          if (!d?.data) return null;

          // 找到包含此股票代號的記錄
          const rows = d.data.filter(row =>
            row.stock_id === code ||
            row.component_id === code ||
            row.symbol === code
          );
          if (!rows.length) return null;

          // 建立歷史趨勢
          const weightHistory = rows
            .map(row => ({
              date:   row.date,
              weight: parseFloat(row.weight || row.percent || row.holding_ratio || 0)
            }))
            .filter(r => r.date)
            .sort((a,b) => a.date.localeCompare(b.date));

          if (!weightHistory.length) return null;
          const latest = weightHistory[weightHistory.length - 1];
          const prev   = weightHistory.length > 1 ? weightHistory[weightHistory.length - 2] : latest;
          const delta  = +(latest.weight - prev.weight).toFixed(2);

          return { ...etf, currentWeight: latest.weight, delta, weightHistory, source: 'finmind' };
        } catch (_) { return null; }
      })
    );

    const holders = results.filter(Boolean);
    if (holders.length > 0) return res.json({ data: holders, source: 'finmind' });

    // Fallback: 用 TaiwanStockHoldingSharesPer 查大股東（可能包含ETF）
    try {
      const url2 = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockHoldingSharesPer&data_id=${code}&start_date=${startStr}&end_date=${endStr}&token=${token}`;
      const r2 = await fetch(url2, { signal: AbortSignal.timeout(10000) });
      const d2 = await r2.json();
      const etfKeywords = ['投信','基金','ETF','元大','富邦','國泰','群益','中信','復華','野村'];
      const etfRows = (d2?.data||[]).filter(row =>
        etfKeywords.some(kw => (row.name||'').includes(kw))
      );
      if (etfRows.length) {
        const grouped = {};
        etfRows.forEach(row => {
          const key = row.name||row.shareholder_name||'未知';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push({ date: row.date, weight: parseFloat(row.percent||row.ratio||0) });
        });
        const data = Object.entries(grouped).map(([name, history]) => {
          const sorted = history.sort((a,b) => a.date.localeCompare(b.date));
          const latest = sorted[sorted.length-1];
          const prev   = sorted.length > 1 ? sorted[sorted.length-2] : latest;
          return { code:'', name, mgr:'', currentWeight: latest?.weight||0, delta: +(( latest?.weight||0)-(prev?.weight||0)).toFixed(2), weightHistory: sorted, source:'finmind_holder' };
        });
        return res.json({ data, source: 'finmind_holder' });
      }
    } catch(_) {}

    return res.json({ data: [], source: 'finmind_empty' });
  } catch(e) {
    return res.status(500).json({ data: [], source: 'error', error: e.message });
  }
}
