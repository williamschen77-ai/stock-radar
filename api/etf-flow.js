import { ACTIVE_ETF_CODES, fetchEtfHoldings } from './_lib/moneydj.js';
import { kvEnabled, kvGet, kvZRange } from './_lib/kv.js';

const priceCache = new Map();
const PRICE_TTL = 15 * 60 * 1000;
const UNIVERSE_TTL = 30 * 60 * 1000;
let universeCache = { at: 0, data: [] };

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

async function getUniverse() {
  if (universeCache.data.length && Date.now() - universeCache.at < UNIVERSE_TTL) return universeCache.data;
  const fetched = await Promise.all(ACTIVE_ETF_CODES.map(code => fetchEtfHoldings(code).catch(() => null)));
  const data = fetched.filter(Boolean).filter(etf => etf.holdings.length).map(etf => ({
    code: etf.code,
    name: etf.name,
    asOf: etf.asOf,
    holdingsCount: etf.holdings.length,
    totalHoldingsCount: etf.totalRows || etf.holdings.length,
    topHoldings: [...etf.holdings].sort((a, b) => b.weight - a.weight).slice(0, 3),
  }));
  if (data.length) universeCache = { at: Date.now(), data };
  return universeCache.data;
}

async function getTrackingStatus() {
  if (!kvEnabled()) return {
    kvConnected: false,
    trackedEtfCount: ACTIVE_ETF_CODES.length,
    coveredEtfCount: 0,
    maxSnapshots: 0,
    latestSnapshot: null,
  };
  const rows = await Promise.all(ACTIVE_ETF_CODES.map(async code => {
    const dates = (await kvZRange(`etfsnap:${code}:dates`, 0, -1)) || [];
    return { count: dates.length, latest: dates.at(-1) || null };
  }));
  const covered = rows.filter(row => row.count > 0);
  return {
    kvConnected: true,
    trackedEtfCount: ACTIVE_ETF_CODES.length,
    coveredEtfCount: covered.length,
    maxSnapshots: Math.max(0, ...rows.map(row => row.count)),
    latestSnapshot: covered.map(row => row.latest).sort().at(-1) || null,
  };
}

async function getEtfDetail(code) {
  if (!ACTIVE_ETF_CODES.includes(code)) throw new Error('Unsupported active ETF code');
  const current = await fetchEtfHoldings(code);
  const holdings = [...current.holdings].sort((a, b) => b.weight - a.weight);
  const result = {
    code,
    name: current.name,
    asOf: current.asOf,
    holdingsCount: holdings.length,
    totalHoldingsCount: current.totalRows || holdings.length,
    holdings: holdings.slice(0, 30),
    snapshotCount: 0,
    latestSnapshot: null,
    changes: [],
  };
  if (!kvEnabled()) return result;

  const dates = (await kvZRange(`etfsnap:${code}:dates`, 0, -1)) || [];
  result.snapshotCount = dates.length;
  result.latestSnapshot = dates.at(-1) || null;
  if (dates.length < 2) return result;

  const beforeDate = dates.at(-2), afterDate = dates.at(-1);
  const [beforeRaw, afterRaw] = await Promise.all([
    kvGet(`etfsnap:${code}:${beforeDate}`),
    kvGet(`etfsnap:${code}:${afterDate}`),
  ]);
  const before = parseSnapshot(beforeRaw);
  const after = parseSnapshot(afterRaw);
  if (!before || !after) return result;

  result.compareDates = { before: beforeDate, after: afterDate };

  const beforeMap = holdingMap(before);
  const afterMap = holdingMap(after);
  const allCodes = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changed = [...allCodes].map(stockCode => {
    const from = beforeMap.get(stockCode);
    const to = afterMap.get(stockCode);
    const sharesDelta = (to?.shares || 0) - (from?.shares || 0);
    const action = !from ? 'NEW' : !to ? 'EXIT' : sharesDelta > 0 ? 'ADD' : sharesDelta < 0 ? 'REDUCE' : 'HOLD';
    return {
      code: stockCode,
      name: to?.name || from?.name || stockCode,
      action,
      sharesDelta,
      startWeight: from?.weight ?? 0,
      endWeight: to?.weight ?? 0,
      weightDelta: +((to?.weight || 0) - (from?.weight || 0)).toFixed(3),
    };
  }).filter(change => change.action !== 'HOLD').sort((a, b) => Math.abs(b.sharesDelta) - Math.abs(a.sharesDelta)).slice(0, 30);

  const prices = await Promise.all(changed.map(change => fetchLatestClose(change.code)));
  result.changes = changed.map((change, index) => ({
    ...change,
    price: prices[index],
    amountNtd: prices[index] == null ? null : change.sharesDelta * prices[index],
  }));
  return result;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  const view = req.query.view || 'flow';
  const days = Math.min(20, Math.max(2, parseInt(req.query.days, 10) || 5));

  try {
    if (view === 'universe') return res.json({ data: await getUniverse(), source: 'moneydj' });
    if (view === 'status') return res.json(await getTrackingStatus());
    if (view === 'etf') return res.json(await getEtfDetail(String(req.query.code || '').toUpperCase()));
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }

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
      const datedSnapshots = raws.map((raw, index) => ({ date: windowDates[index], snapshot: parseSnapshot(raw) })).filter(row => row.snapshot);
      if (datedSnapshots.length < 2) return null;
      const snapshots = datedSnapshots.map(row => row.snapshot);
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
      const dailyDeltas = datedSnapshots.slice(1).map((row, index) => {
        const previous = datedSnapshots[index].snapshot;
        const previousMap = holdingMap(previous);
        const currentMap = holdingMap(row.snapshot);
        const codes = new Set([...previousMap.keys(), ...currentMap.keys()]);
        return {
          date: row.date,
          deltas: [...codes].map(stockCode => {
            const from = previousMap.get(stockCode), to = currentMap.get(stockCode);
            return { stockCode, stockName: to?.name || from?.name || stockCode, sharesDelta: (to?.shares || 0) - (from?.shares || 0) };
          }).filter(delta => delta.sharesDelta !== 0),
        };
      });
      return {
        etfCode: code,
        etfName: last.name || code,
        startDate: windowDates[0],
        endDate: windowDates[windowDates.length - 1],
        deltas,
        dailyDeltas,
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
            timelineMap: new Map(),
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

    for (const etf of perEtf.filter(Boolean)) {
      for (const day of etf.dailyDeltas || []) {
        for (const delta of day.deltas) {
          if (!targets.has(delta.stockCode)) {
            targets.set(delta.stockCode, { code: delta.stockCode, name: delta.stockName, buyers: [], sellers: [], netShares: 0, timelineMap: new Map() });
          }
          const target = targets.get(delta.stockCode);
          if (!target.timelineMap.has(day.date)) target.timelineMap.set(day.date, { date: day.date, netShares: 0, buyers: new Set() });
          const timeline = target.timelineMap.get(day.date);
          timeline.netShares += delta.sharesDelta;
          if (delta.sharesDelta > 0) timeline.buyers.add(etf.etfCode);
        }
      }
    }

    // 對「全部」有異動的個股（含純減碼、buyers.length===0 的股票）算價格與金額，
    // 避免只算買方名單導致純被賣出的個股永遠進不了「共識賣」。
    const allTargets = [...targets.values()];
    const prices = await Promise.all(allTargets.map(target => fetchLatestClose(target.code)));
    const enriched = allTargets.map((target, index) => {
      const price = prices[index];
      const netNtd = price == null ? null : target.netShares * price;
      return {
        ...target,
        price,
        netNtd,
        buyNtd: price == null ? null : target.buyers.reduce((sum, buyer) => sum + buyer.sharesDelta * price, 0),
        sellNtd: price == null ? null : target.sellers.reduce((sum, seller) => sum + Math.abs(seller.sharesDelta) * price, 0),
        timeline: [...target.timelineMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map(item => ({
          date: item.date,
          etfCount: item.buyers.size,
          netNtd: price == null ? null : item.netShares * price,
          buyNtd: price == null ? null : Math.max(0, item.netShares) * price,
        })),
      };
    });

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
      timeline: target.timeline,
    });

    const ranked = enriched
      .filter(target => target.buyers.length > 0)
      .sort((a, b) => (b.buyNtd || 0) - (a.buyNtd || 0) || b.buyers.length - a.buyers.length);
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
      consensusSell: enriched
        .filter(target => target.sellers.length >= 3)
        .sort((a, b) => b.sellers.length - a.sellers.length || (b.sellNtd || 0) - (a.sellNtd || 0))
        .slice(0, 30)
        .map(toPublic),
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
}
