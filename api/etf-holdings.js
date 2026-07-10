// ETF持倉API：查詢哪些主動ETF持有某支股票
// 資料來源：FinMind TaiwanStockHoldingSharesPer (需token) + 靜態主動ETF清單
// 目前以靜態對照為主，可在 FINMIND_TOKEN 環境變數設定後自動升級為真實資料

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const token = process.env.FINMIND_TOKEN || '';

  // 主動型ETF清單（台灣主要主動操作ETF）
  const ACTIVE_ETFS = [
    { code: "00981A", name: "統一台股增長", mgr: "統一投信" },
    { code: "00982A", name: "群益台灣強棒", mgr: "群益投信" },
    { code: "00990A", name: "元大AI新經濟", mgr: "元大投信" },
    { code: "00991A", name: "復華未來50",   mgr: "復華投信" },
    { code: "00992A", name: "群益科技創新", mgr: "群益投信" },
    { code: "00988A", name: "統一全球創新", mgr: "統一投信" },
    { code: "00980A", name: "野村臺灣優選", mgr: "野村投信" },
    { code: "00400A", name: "國泰動能高息", mgr: "國泰投信" },
  ];

  // 嘗試用 FinMind 查詢各ETF持股（需token）
  if (token) {
    try {
      const today = new Date();
      const startDate = new Date(today);
      startDate.setMonth(startDate.getMonth() - 3);
      const start = startDate.toISOString().slice(0, 10);
      const end = today.toISOString().slice(0, 10);

      const results = await Promise.all(
        ACTIVE_ETFS.map(async (etf) => {
          try {
            const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockHoldingSharesPer&data_id=${etf.code}&start_date=${start}&end_date=${end}&token=${token}`;
            const r = await fetch(url);
            const d = await r.json();
            const rows = (d?.data || []).filter(row => row.stock_id === code);
            if (!rows.length) return null;

            // Build weight history (monthly snapshots)
            const weightHistory = rows.map(row => ({
              date: row.date,
              weight: parseFloat(row.weight_per || 0)
            })).sort((a, b) => a.date.localeCompare(b.date));

            const latest = weightHistory[weightHistory.length - 1];
            const prev = weightHistory.length > 1 ? weightHistory[weightHistory.length - 2] : latest;
            const delta = latest ? +(latest.weight - prev.weight).toFixed(2) : 0;

            return {
              ...etf,
              currentWeight: latest?.weight || 0,
              delta: delta,
              weightHistory,
              source: 'finmind'
            };
          } catch (_) { return null; }
        })
      );

      const holders = results.filter(Boolean);
      if (holders.length > 0) {
        return res.json({ data: holders, source: 'finmind' });
      }
    } catch (_) {}
  }

  // Fallback: 模擬資料（無token時使用，標示為模擬）
  function rng(seed) {
    let s = seed;
    return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  const rand = rng(code.split('').reduce((a, c) => a + c.charCodeAt(0), 0));
  const holders = ACTIVE_ETFS.filter(() => rand() > 0.3).map((etf, i) => {
    const r = rng(i * 13 + code.charCodeAt(0));
    let w = +(r() * 5 + 0.5).toFixed(2);
    const weightHistory = Array.from({ length: 6 }, (_, j) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - j));
      w = Math.max(0.1, +(w + (r() - 0.5) * 0.5).toFixed(2));
      return { date: d.toISOString().slice(0, 10), weight: w };
    });
    const cur = weightHistory[weightHistory.length - 1].weight;
    const prev = weightHistory[weightHistory.length - 2].weight;
    return { ...etf, currentWeight: cur, delta: +(cur - prev).toFixed(2), weightHistory, source: 'mock' };
  });

  return res.json({ data: holders, source: 'mock', note: '設定 FINMIND_TOKEN 環境變數可顯示真實資料' });
}
