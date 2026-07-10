// 真正的「這N天內被幾檔ETF加碼」排行——用 cron/snapshot-etf.js 每日存進 KV
// 的真實持股快照，比較窗口起訖兩次快照的持股張數變化。
// 這是逐檔ETF的真實數據（不像 fund-flow.js 是投信彙總的近似值），但需要
// 實際運行幾天之後才會有意義的資料，剛啟用時會回傳「資料累積中」。

import { ACTIVE_ETF_CODES } from './_lib/moneydj.js';
import { kvEnabled, kvGet, kvZRange } from './_lib/kv.js';

async function fetchLatestClose(code) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?range=5d&interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000),
    });
    const d = await r.json();
    const closes = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(c => c != null);
    return closes?.length ? closes[closes.length - 1] : null;
  } catch (_) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const days = Math.min(20, Math.max(1, parseInt(req.query.days, 10) || 5));

  if (!kvEnabled()) {
    return res.json({ ok: false, reason: 'kv_not_configured', message: '尚未啟用歷史持股追蹤（需連接 Vercel KV）' });
  }

  try {
    // 每檔ETF各自的快照日期清單（依日期由舊到新）
    const perEtfDates = await Promise.all(
      ACTIVE_ETF_CODES.map(code => kvZRange(`etfsnap:${code}:dates`, 0, -1).then(dates => ({ code, dates: dates || [] })))
    );
    const daysCollected = Math.max(0, ...perEtfDates.map(e => e.dates.length));

    if (daysCollected < 2) {
      return res.json({ ok: false, reason: 'collecting', daysCollected, message: `歷史資料累積中（目前 ${daysCollected} 天），至少需要 2 天才能算出變化` });
    }

    // 每檔ETF：取窗口內最早與最新的快照，比較持股張數變化
    const perEtfDelta = await Promise.all(perEtfDates.map(async ({ code, dates }) => {
      const window = dates.slice(-days);
      if (window.length < 2) return null;
      const [startDate, endDate] = [window[0], window[window.length - 1]];
      const [startRaw, endRaw] = await Promise.all([
        kvGet(`etfsnap:${code}:${startDate}`),
        kvGet(`etfsnap:${code}:${endDate}`),
      ]);
      if (!startRaw || !endRaw) return null;
      const start = JSON.parse(startRaw), end = JSON.parse(endRaw);
      const startMap = new Map(start.holdings.map(h => [h.code, h.shares]));
      const deltas = end.holdings.map(h => ({
        stockCode: h.code, stockName: h.name,
        sharesDelta: h.shares - (startMap.get(h.code) || 0),
      }));
      return { etfCode: code, etfName: end.name, startDate, endDate, deltas };
    }));

    const valid = perEtfDelta.filter(Boolean);
    if (!valid.length) {
      return res.json({ ok: false, reason: 'collecting', daysCollected, message: '窗口內資料不足，請稍後再試或縮短天數' });
    }

    // 依股票彙總：幾檔ETF加碼/減碼、總張數變化
    const agg = new Map();
    for (const etf of valid) {
      for (const d of etf.deltas) {
        if (d.sharesDelta === 0) continue;
        if (!agg.has(d.stockCode)) agg.set(d.stockCode, { code: d.stockCode, name: d.stockName, etfsUp: [], etfsDown: [], netShares: 0 });
        const e = agg.get(d.stockCode);
        e.netShares += d.sharesDelta;
        if (d.sharesDelta > 0) e.etfsUp.push(etf.etfCode); else e.etfsDown.push(etf.etfCode);
      }
    }

    let list = Array.from(agg.values());
    list.sort((a, b) => b.etfsUp.length - a.etfsUp.length || b.netShares - a.netShares);
    list = list.slice(0, 30);

    const prices = await Promise.all(list.map(e => fetchLatestClose(e.code)));
    list.forEach((e, i) => {
      e.price = prices[i];
      // netShares 已是原始股數（非「張」），直接乘價格換算金額（億元）
      e.amountYi = e.price != null ? +((e.netShares * e.price) / 1e8).toFixed(1) : null;
    });

    const consensusBuy = list.filter(e => e.etfsUp.length >= 3).sort((a, b) => b.etfsUp.length - a.etfsUp.length);
    const concentrated = list.filter(e => (e.amountYi || 0) >= 3).sort((a, b) => (b.amountYi || 0) - (a.amountYi || 0));
    const consensusSell = Array.from(agg.values()).filter(e => e.etfsDown.length >= 3).sort((a, b) => b.etfsDown.length - a.etfsDown.length);

    return res.json({
      ok: true, days, daysCollected, trackedEtfCount: ACTIVE_ETF_CODES.length,
      consensusBuy: consensusBuy.map(e => ({ code: e.code, name: e.name, etfCount: e.etfsUp.length, amountYi: e.amountYi })),
      concentrated: concentrated.map(e => ({ code: e.code, name: e.name, etfCount: e.etfsUp.length, amountYi: e.amountYi })),
      consensusSell: consensusSell.map(e => ({ code: e.code, name: e.name, etfCount: e.etfsDown.length, amountYi: e.amountYi })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
