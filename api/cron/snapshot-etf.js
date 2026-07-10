// 每日排程：把目前 15 檔追蹤ETF的真實持股快照存進 Vercel KV，
// 讓 etf-flow.js 之後能算出「這N天內被幾檔ETF加碼」的真實數據。
// 由 vercel.json 的 crons 設定觸發（約每個交易日下午收盤後跑一次）。
// 需要專案已連接 Vercel KV（Upstash Redis）才會真正寫入；未連接時安全地跳過。

import { ACTIVE_ETF_CODES, fetchEtfHoldings } from '../_lib/moneydj.js';
import { kvEnabled, kvSet, kvZAdd } from '../_lib/kv.js';

function isoFromMoneyDJDate(s) {
  // MoneyDJ格式 "2026/07/09" → "2026-07-09"
  const m = s?.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // 若有設定 CRON_SECRET，要求 Bearer token 才能觸發（避免被任意呼叫洗資料）；
  // 沒設定時預設放行，方便未設定密鑰也能先跑起來。
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  }

  if (!kvEnabled()) {
    return res.json({ ok: false, reason: 'kv_not_configured', message: '尚未連接 Vercel KV，快照未儲存' });
  }

  const results = await Promise.all(ACTIVE_ETF_CODES.map(async code => {
    try {
      const etf = await fetchEtfHoldings(code);
      if (!etf.holdings.length) return { code, ok: false, reason: 'empty' };

      const date = isoFromMoneyDJDate(etf.asOf) || new Date().toISOString().slice(0, 10);
      const payload = JSON.stringify({ name: etf.name, asOf: etf.asOf, holdings: etf.holdings });

      await kvSet(`etfsnap:${code}:${date}`, payload);
      await kvZAdd(`etfsnap:${code}:dates`, Number(date.replace(/-/g, '')), date);

      return { code, ok: true, date, holdings: etf.holdings.length };
    } catch (e) {
      return { code, ok: false, reason: e.message };
    }
  }));

  return res.json({ ok: true, results });
}
