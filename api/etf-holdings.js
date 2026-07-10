// 台灣主動/被動 ETF 持股資料
// 資料來源：MoneyDJ ETF 成分股頁面（每日更新的真實持股權重）
// 注意：MoneyDJ 僅提供「目前」持股快照，無歷史權重可查，故本 API 不提供趨勢資料
// （歷史累積另見 cron/snapshot-etf.js + etf-flow.js）。

import { ACTIVE_ETF_CODES, fetchEtfHoldings } from './_lib/moneydj.js';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時
let cache = { time: 0, etfs: [] };

async function getAllHoldings() {
  if (cache.etfs.length && Date.now() - cache.time < CACHE_TTL_MS) return cache.etfs;

  const results = await Promise.all(
    ACTIVE_ETF_CODES.map(code => fetchEtfHoldings(code).catch(() => null))
  );
  const etfs = results.filter(e => e && e.holdings.length > 0);

  // 只在有拿到資料時才更新快取，避免暫時性錯誤把快取清空
  if (etfs.length > 0) cache = { time: Date.now(), etfs };
  return cache.etfs;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  try {
    const etfs = await getAllHoldings();
    if (!etfs.length) return res.json({ data: [], source: 'error' });

    const holders = etfs
      .map(etf => {
        const h = etf.holdings.find(x => x.code === code);
        if (!h) return null;
        return {
          code: etf.code,
          name: etf.name,
          currentWeight: h.weight,
          shares: h.shares,
          asOf: etf.asOf,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.currentWeight - a.currentWeight);

    return res.json({ data: holders, source: holders.length ? 'moneydj' : 'moneydj_empty' });
  } catch (e) {
    return res.status(500).json({ data: [], source: 'error', error: e.message });
  }
}
