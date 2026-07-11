import { ACTIVE_ETF_CODES } from './_lib/moneydj.js';
import { kvEnabled, kvGet, kvZRange } from './_lib/kv.js';

const priceCache = new Map();
const PRICE_TTL = 15 * 60 * 1000;

async function fetchLatestClose(code) {
  const cached = priceCache.get(code);
  if (cached && Date.now() - cached.at < PRICE_TTL) return cached.price;

  for (const suffix of ['TW', 'TWO']) {
    try {
      const response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${code}.${suffix}?range=5d&interval=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) },
      );
      const payload = await response.json();
      const quotes = payload?.chart?.result?.[0]?.indicators?.quote?.[0];
      const closes = quotes?.close || [];
      const volumes = quotes?.volume || [];
      for (let i = closes.length - 1; i >= 0; i--) {
        if (closes[i] != null && (volumes[i] || 0) > 0) {
          priceCache.set(code, { price: closes[i], at: Date.now() });
          return closes[i];
        }
      }
    } catch (_) {
      // Try the other Taiwan suffix.
    }
  }
  return null;
}

function parseSnapshot(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}

function holdingMap(snapshot) {
  return new Map((snapshot?.holdings || []).map(holding => [holding.code, holding]));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const days = Math.min(20, Math.max(2, parseInt(req.query.days, 10) || 5));

  if (!kvEnabled()) {
    return res.json({ ok: false, reason: 'kv_not_configured', message: '尚未連接 Vercel KV，無法讀取 ETF 歷史快照。' });
  }

  try {
    const dateRows = await Promise.all(ACTIVE_ETF_CODES.map(async code => ({
      code,
      dates: (await kvZRange(`etfsnap:${code}:dates`, 0, -1)) || [],
    })));
    const available = dateRows.filter(row => row.dates.length >= 2);
    const daysCollected = Math.max(0, ...dateRows.map(row => row.dates.length));

    if (!available.length) {
      return res.json({
        ok: false, reason: 'collecting', daysCollected,
        message: `資料累積中，目前 ${daysCollected} 個揭露日；至少需要 2 個揭露日才能比較 ETF 加減碼。`,
      });
    }

    const perEtf = await Promise.all(available.map(async ({ code, dates }) => {
      const windowDates = dates.slice(-days);
      const raws = await Promise.all(windowDates.map(date => kvGet(`etfsnap:${code}:${date}`)));
      const snapshots = raws.map(parseSnapshot).filter(Boolean);
      if (snapshots.length < 2) return null;
      const first = snapshots[0];
      const last = snapshots[snapshots.length - 1];
      const startMap = holdingMap(first);
      const endMap = holdingMap(last);
      const allCodes = new Set([...startMap.keys(), ...endMap.keys()]);
      const deltas = [...allCodes].map(stockCode => {
        const from = startMap.get(stockCode);
        const to = endMap.get(stockCode);
        const sharesDelta = (to?.shares || 0) - (from?.shares || 0);
        return {
          stockCode,
          stockName: to?.name || from?.name || stockCode,
          sharesDelta,
          startWeight: from?.weight ?? 0,
          endWeight: to?.weight ?? 0,
          weightDelta: +((to?.weight || 0) - (from?.weight || 0)).toFixed(3),
        };
      }).filter(delta => delta.sharesDelta !== 0);
      return {
        etfCode: code,
        etfName: last.name || code,
        startDate: windowDates[0],
        endDate: windowDates[windowDates.length - 1],
        deltas,
      };
    }));

    const targets = new Map();
    for (const etf of perEtf.filter(Boolean)) {
      for (const delta of etf.deltas) {
        if (!targets.has(delta.stockCode)) {
          targets.set(delta.stockCode, {
            code: delta.stockCode,
            name: delta.stockName,
            buyers: [],
            sellers: [],
            netShares: 0,
          });
        }
        const target = targets.get(delta.stockCode);
        const item = {
          etfCode: etf.etfCode,
          etfName: etf.etfName,
          sharesDelta: delta.sharesDelta,
          startWeight: delta.startWeight,
          endWeight: delta.endWeight,
          weightDelta: delta.weightDelta,
        };
        target.netShares += delta.sharesDelta;
        (delta.sharesDelta > 0 ? target.buyers : target.sellers).push(item);
      }
    }

    let ranked = [...targets.values()].filter(target => target.buyers.length > 0);
    const prices = await Promise.all(ranked.map(target => fetchLatestClose(target.code)));
    ranked = ranked.map((target, index) => {
      const price = prices[index];
      const netNtd = price == null ? null : target.netShares * price;
      return {
        ...target,
        price,
        netNtd,
        buyNtd: price == null ? null : target.buyers.reduce((sum, buyer) => sum + buyer.sharesDelta * price, 0),
        sellNtd: price == null ? null : target.sellers.reduce((sum, seller) => sum + Math.abs(seller.sharesDelta) * price, 0),
      };
    });
    ranked.sort((a, b) => (b.buyNtd || 0) - (a.buyNtd || 0) || b.buyers.length - a.buyers.length);

    const toPublic = target => ({
      code: target.code,
      name: target.name,
      price: target.price,
      etfCount: target.buyers.length,
      sellEtfCount: target.sellers.length,
      buyNtd: target.buyNtd,
      netNtd: target.netNtd,
      buyers: target.buyers
        .sort((a, b) => b.sharesDelta - a.sharesDelta)
        .map(buyer => ({ ...buyer, buyNtd: target.price == null ? null : buyer.sharesDelta * target.price })),
      sellers: target.sellers
        .sort((a, b) => a.sharesDelta - b.sharesDelta)
        .map(seller => ({ ...seller, sellNtd: target.price == null ? null : Math.abs(seller.sharesDelta) * target.price })),
    });

    const rows = ranked.slice(0, 30).map(toPublic);
    return res.json({
      ok: true,
      asOf: perEtf.filter(Boolean).map(row => row.endDate).sort().at(-1) || null,
      days,
      daysCollected,
      trackedEtfCount: ACTIVE_ETF_CODES.length,
      coveredEtfCount: perEtf.filter(Boolean).length,
      ranking: rows,
      consensusBuy: rows.filter(row => row.etfCount >= 3),
      concentrated: rows.filter(row => (row.buyNtd || 0) >= 3e8),
      consensusSell: ranked
        .filter(target => target.sellers.length >= 3)
        .sort((a, b) => b.sellers.length - a.sellers.length)
        .slice(0, 30)
        .map(toPublic),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
