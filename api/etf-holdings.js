export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const token = process.env.FINMIND_TOKEN || '';

  // 主動型ETF清單
  const ACTIVE_ETFS = [
    { code:"00892", name:"富邦台灣半導體", mgr:"富邦投信" },
    { code:"00891", name:"中信關鍵半導體", mgr:"中信投信" },
    { code:"00881", name:"國泰台灣5G+",   mgr:"國泰投信" },
    { code:"00878", name:"國泰永續高股息", mgr:"國泰投信" },
    { code:"00919", name:"群益台灣精選高息",mgr:"群益投信" },
    { code:"00929", name:"復華台灣科技優息",mgr:"復華投信" },
    { code:"00934", name:"中信成長高股息", mgr:"中信投信" },
    { code:"00940", name:"元大台灣價值高息",mgr:"元大投信" },
    { code:"00900", name:"富邦特選高股息30",mgr:"富邦投信" },
    { code:"0050",  name:"元大台灣50",    mgr:"元大投信" },
    { code:"0056",  name:"元大高股息",     mgr:"元大投信" },
    { code:"006208",name:"富邦台50",       mgr:"富邦投信" },
    { code:"00944", name:"群益半導體收益", mgr:"群益投信" },
    { code:"00946", name:"元大台灣晶圓製造",mgr:"元大投信" },
  ];

  if (!token) {
    return res.json({ data: [], source: 'no_token', note: '請設定 FINMIND_TOKEN 環境變數' });
  }

  try {
    // 取得3個月前的日期
    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - 3);
    const startStr = start.toISOString().slice(0,10);
    const endStr   = today.toISOString().slice(0,10);

    // 並行查詢所有ETF持股
    const results = await Promise.all(
      ACTIVE_ETFS.map(async (etf) => {
        try {
          const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanETFComponents&data_id=${etf.code}&start_date=${startStr}&end_date=${endStr}&token=${token}`;
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          const d = await r.json();
          const rows = (d?.data || []).filter(row => row.stock_id === code);
          if (!rows.length) return null;

          const weightHistory = rows
            .map(row => ({ date: row.date, weight: parseFloat(row.weight || row.holding_shares || 0) }))
            .sort((a,b) => a.date.localeCompare(b.date));

          const latest = weightHistory[weightHistory.length - 1];
          const prev8  = weightHistory.length > 1 ? weightHistory[Math.max(0, weightHistory.length - 2)] : latest;
          const delta  = latest ? +(latest.weight - prev8.weight).toFixed(2) : 0;

          return { ...etf, currentWeight: latest?.weight ?? 0, delta, weightHistory, source: 'finmind' };
        } catch (_) { return null; }
      })
    );

    // 若 TaiwanETFComponents 無資料，改查 TaiwanStockHoldingSharesPer
    const holders = results.filter(Boolean);
    if (holders.length > 0) {
      return res.json({ data: holders, source: 'finmind' });
    }

    // fallback: TaiwanStockHoldingSharesPer (大股東持股)
    const url2 = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockHoldingSharesPer&data_id=${code}&start_date=${startStr}&end_date=${endStr}&token=${token}`;
    const r2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
    const d2 = await r2.json();
    if (d2?.data?.length) {
      const etfRows = (d2.data || []).filter(row =>
        ACTIVE_ETFS.some(e => row.name?.includes(e.name.slice(0,4)) || row.shareholder_id === e.code)
      );
      if (etfRows.length > 0) {
        const grouped = {};
        etfRows.forEach(row => {
          if (!grouped[row.name]) grouped[row.name] = [];
          grouped[row.name].push({ date: row.date, weight: parseFloat(row.percent || 0) });
        });
        const data = Object.entries(grouped).map(([name, history]) => {
          const sorted = history.sort((a,b) => a.date.localeCompare(b.date));
          const latest = sorted[sorted.length-1];
          const prev   = sorted.length > 1 ? sorted[sorted.length-2] : latest;
          return { code: name, name, mgr:'', currentWeight: latest?.weight??0, delta: +(latest.weight-prev.weight).toFixed(2), weightHistory: sorted, source:'finmind' };
        });
        return res.json({ data, source: 'finmind' });
      }
    }
    return res.json({ data: [], source: 'finmind_empty', note: '此股票無ETF持倉資料' });
  } catch(e) {
    return res.status(500).json({ data: [], source: 'error', error: e.message });
  }
}
