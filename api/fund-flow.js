// 近期資金流排行：以 TWSE T86 報表的「投信買賣超」彙總近N個交易日，
// 找出被投信（含ETF發行商）集中買超的個股。
// 注意：T86 的「投信」是彙總所有投信公司（含主動基金與ETF發行商），
// 並非單一ETF的逐日持股變化，故本功能呈現的是市場級的資金流向，而非
// 「某檔ETF買了哪些股票」的精確持股歸因（後者需要每日歷史持股快照，
// 目前無穩定的免費資料源可回溯）。

const MAX_TRADING_DAYS = 23;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小時
let cache = { time: 0, byDate: [] };

const clean = v => Math.round((parseInt((v || '0').toString().replace(/,/g, '')) || 0) / 1000);

async function fetchDay(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(9000) });
  const d = await r.json();
  if (d.stat !== 'OK' || !d.data) return null;
  const map = new Map();
  for (const row of d.data) {
    map.set(row[0], { name: (row[1] || '').trim(), trust: clean(row[10]) });
  }
  return map;
}

async function getRecentDays() {
  if (cache.byDate.length && Date.now() - cache.time < CACHE_TTL_MS) return cache.byDate;

  const today = new Date();
  const candidates = [];
  for (let i = 0; i < 35 && candidates.length < 25; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    candidates.push({
      iso: d.toISOString().slice(0, 10),
      ds: `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`,
    });
  }

  const results = await Promise.all(
    candidates.map(async ({ iso, ds }) => ({ iso, map: await fetchDay(ds).catch(() => null) }))
  );
  const byDate = results
    .filter(r => r.map)
    .sort((a, b) => a.iso.localeCompare(b.iso))
    .slice(-MAX_TRADING_DAYS);

  if (byDate.length) cache = { time: Date.now(), byDate };
  return cache.byDate;
}

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
  const limit = Math.min(30, Math.max(1, parseInt(req.query.limit, 10) || 20));

  try {
    const byDate = await getRecentDays();
    if (!byDate.length) return res.json({ data: [], days, asOf: null, error: 'no_data' });

    const window = byDate.slice(-days);
    const asOf = window[window.length - 1]?.iso || null;

    const agg = new Map();
    for (const day of window) {
      for (const [code, { name, trust }] of day.map) {
        if (!agg.has(code)) agg.set(code, { code, name, net: 0, series: [] });
        const e = agg.get(code);
        e.net += trust;
        e.series.push(trust);
      }
    }

    let list = Array.from(agg.values()).filter(e => e.net > 0);
    list.sort((a, b) => b.net - a.net);
    list = list.slice(0, limit);

    for (const e of list) {
      let streak = 0;
      for (let i = e.series.length - 1; i >= 0; i--) {
        if (e.series[i] > 0) streak++; else break;
      }
      e.streak = streak;
      e.buyDays = e.series.filter(v => v > 0).length;
    }

    const prices = await Promise.all(list.map(e => fetchLatestClose(e.code)));
    list.forEach((e, i) => {
      e.price = prices[i];
      // net 單位為「張」(1000股)；金額換算成「億元」
      e.amountYi = e.price != null ? +((e.net * 1000 * e.price) / 1e8).toFixed(1) : null;
    });

    return res.json({
      data: list.map(e => ({
        code: e.code, name: e.name, netLots: e.net, amountYi: e.amountYi,
        buyDays: e.buyDays, streak: e.streak, windowDays: window.length,
      })),
      days, asOf, windowTradingDays: window.length,
      note: '以TWSE T86「投信買賣超」彙總，涵蓋所有投信（含ETF發行商與主動基金），非單一ETF逐日持股變化。',
    });
  } catch (e) {
    return res.status(500).json({ data: [], error: e.message });
  }
}
