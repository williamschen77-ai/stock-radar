// 查詢個股處置（被關）狀態與融券回補日
// 資料來源：台灣證交所 + FinMind
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const result = {
    isDisposed: false,
    dispositionInfo: null,
    marginShortSale: null,
    nearLock: false,
    nearUnlock: false,
    lockDate: null,
    unlockDate: null,
    source: 'twse'
  };

  try {
    // 1. 查詢處置股（被關）
    const today = new Date();
    const startDate = new Date(today);
    startDate.setMonth(startDate.getMonth() - 1);
    const start = startDate.toISOString().slice(0,10).replace(/-/g,'');

    const dispUrl = `https://www.twse.com.tw/rwd/zh/announcement/punish?response=json&strDate=${start}&endDate=${today.toISOString().slice(0,10).replace(/-/g,'')}`;
    try {
      const r = await fetch(dispUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      if (d?.data) {
        const found = d.data.find(row => row[1] === code || row[0]?.includes(code));
        if (found) {
          result.isDisposed = true;
          result.dispositionInfo = {
            name: found[0],
            startDate: found[2] || '',
            endDate: found[3] || '',
            reason: found[4] || '處置中',
          };
          // Check if close to unlock
          if (found[3]) {
            const unlockD = new Date(found[3].replace(/\//g,'-'));
            const daysLeft = Math.ceil((unlockD - today) / 86400000);
            result.unlockDate = found[3];
            if (daysLeft >= 0 && daysLeft <= 5) result.nearUnlock = true;
            if (daysLeft < 0) result.nearUnlock = true;
          }
        }
      }
    } catch(_) {}

    // 2. 查詢融券回補日（即將被關的前兆）
    try {
      const suspUrl = `https://www.twse.com.tw/rwd/zh/fund/shortSaleMarginPurchase?response=json&selectType=MS`;
      const r2 = await fetch(suspUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d2 = await r2.json();
      if (d2?.data) {
        const found2 = d2.data.find(row => row[0] === code);
        if (found2) {
          result.marginShortSale = {
            stockCode: found2[0],
            stockName: found2[1],
            lastBuyDate: found2[2] || '',
            repayDate: found2[3] || '',
            reason: found2[4] || '',
          };
          result.nearLock = true;
          result.lockDate = found2[2] || '';
          result.unlockDate = found2[3] || '';
        }
      }
    } catch(_) {}

    // 3. 查詢暫停融券賣出（另一種被關）
    try {
      const token = process.env.FINMIND_TOKEN || '';
      if (token) {
        const fmUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginShortSaleSuspension&data_id=${code}&start_date=${startDate.toISOString().slice(0,10)}&token=${token}`;
        const r3 = await fetch(fmUrl);
        const d3 = await r3.json();
        if (d3?.data?.length > 0) {
          const latest = d3.data[d3.data.length - 1];
          result.marginShortSale = result.marginShortSale || {
            stockCode: code,
            repayDate: latest.end_date || '',
            reason: '暫停融券賣出',
          };
          result.nearLock = true;
        }
      }
    } catch(_) {}

  } catch(e) {
    result.error = e.message;
  }

  return res.json(result);
}
