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
      // 欄位順序（TWSE punish API）：0編號 1公布日期 2證券代號 3證券名稱 4累計
      // 5處置條件 6處置起迄時間(如 "115/07/03～115/07/16") 7處置措施 8處置內容 9備註
      if (d?.data) {
        const found = d.data.find(row => row[2] === code);
        if (found) {
          const [startRoc, endRoc] = (found[6] || '').split('～').map(s => s?.trim());
          const rocToDate = s => {
            const m = s?.match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
            return m ? `${+m[1] + 1911}-${m[2]}-${m[3]}` : '';
          };
          const startDate = rocToDate(startRoc);
          const endDate = rocToDate(endRoc);
          result.isDisposed = true;
          result.dispositionInfo = {
            name: found[3],
            startDate,
            endDate,
            reason: found[5] || '處置中',
          };
          if (endDate) {
            const unlockD = new Date(endDate);
            const daysLeft = Math.ceil((unlockD - today) / 86400000);
            result.unlockDate = endDate;
            if (daysLeft <= 5) result.nearUnlock = true;
          }
        }
      }
    } catch(_) {}

    // 2. 查詢融資融券暫停期間（除息、股東會等原因，FinMind 免token即可查詢）
    try {
      const token = process.env.FINMIND_TOKEN || '';
      const tokenParam = token ? `&token=${token}` : '';
      const fmUrl = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockMarginShortSaleSuspension&data_id=${code}&start_date=${startDate.toISOString().slice(0,10)}${tokenParam}`;
      const r2 = await fetch(fmUrl, { signal: AbortSignal.timeout(8000) });
      const d2 = await r2.json();
      if (d2?.data?.length > 0) {
        // 只取尚未結束（今天或未來）的暫停期間，避免顯示過期資訊
        const upcoming = d2.data.filter(row => row.end_date && new Date(row.end_date) >= new Date(today.toISOString().slice(0,10)));
        const latest = upcoming[upcoming.length - 1];
        if (latest) {
          result.marginShortSale = {
            stockCode: code,
            lastBuyDate: latest.date || '',
            repayDate: latest.end_date || '',
            reason: latest.reason || '融資融券暫停',
          };
          result.nearLock = true;
          result.lockDate = latest.date || '';
          result.unlockDate = latest.end_date || '';
        }
      }
    } catch(_) {}

  } catch(e) {
    result.error = e.message;
  }

  return res.json(result);
}
