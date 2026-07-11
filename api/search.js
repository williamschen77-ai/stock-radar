// Full Taiwan security search index.  FinMind's TaiwanStockInfo includes
// TWSE, TPEx, emerging securities and ETFs; this endpoint normalizes its
// duplicate records and adds ETF/active-ETF classification for the UI.
let cachedUniverse = [];
let cacheAt = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000;

const ALIASES = {
  '2330': ['台積', 'tsmc'],
  '2454': ['發哥', 'mtk'],
  '2317': ['foxconn'],
  '5347': ['世界先進', 'vis'],
  '00980A': ['主動野村', '野村主動'],
  '00981A': ['主動統一', '統一主動'],
  '00982A': ['主動群益', '群益主動'],
  '00407A': ['主動凱基', '凱基主動'],
};

const normalize = value => String(value || '').toLowerCase().replace(/[\s\-_.（）()]/g, '');
const isEtf = item => /ETF|指數股票型基金|交易所交易基金/i.test(item.sector || '') || /ETF/i.test(item.name || '');
const isActiveEtf = item => isEtf(item) && (/主動/.test(item.name || '') || /A$/i.test(item.code || ''));

async function loadUniverse() {
  if (cachedUniverse.length && Date.now() - cacheAt < CACHE_TTL) return cachedUniverse;
  const response = await fetch('https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo', {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'Stock-Radar/1.0' },
  });
  const payload = await response.json();
  if (!payload?.data?.length) return cachedUniverse;

  const deduped = new Map();
  for (const row of payload.data) {
    const code = String(row.stock_id || '').trim().toUpperCase();
    const name = String(row.stock_name || '').trim();
    if (!code || !name) continue;
    const item = {
      code,
      name,
      sector: row.industry_category || '其他',
      market: row.type || 'unknown',
    };
    item.kind = isEtf(item) ? 'ETF' : 'STOCK';
    item.active = isActiveEtf(item);
    item.aliases = ALIASES[code] || [];
    const existing = deduped.get(code);
    // Prefer ETF classification and a non-empty sector when FinMind has
    // duplicate TWSE/TPEx reference rows for the same fund.
    if (!existing || (item.kind === 'ETF' && existing.kind !== 'ETF') || item.sector.length > existing.sector.length) deduped.set(code, item);
  }
  cachedUniverse = [...deduped.values()];
  cacheAt = Date.now();
  return cachedUniverse;
}

function score(item, query) {
  const code = item.code.toLowerCase();
  const name = normalize(item.name);
  const sector = normalize(item.sector);
  const aliases = item.aliases.map(normalize);
  const q = normalize(query);
  const wantsActive = /主動|active/.test(query.toLowerCase());
  const wantsEtf = /etf|基金|主動|active/.test(query.toLowerCase());

  if (wantsActive && !item.active) return -1;
  if (wantsEtf && !item.kind.includes('ETF') && q.length <= 5) return -1;
  if (code === q) return 1000;
  if (name === q || aliases.includes(q)) return 900;
  if (code.startsWith(q)) return 800;
  if (name.startsWith(q)) return 700;
  if (aliases.some(alias => alias.includes(q))) return 650;
  if (name.includes(q)) return 600;
  if (sector.includes(q)) return 400;
  if (wantsActive && item.active) return 300;
  if (wantsEtf && item.kind === 'ETF') return 250;
  return -1;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  const rawQuery = String(req.query.q || '').trim();
  const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 20));
  if (!rawQuery) return res.json({ data: [], total: cachedUniverse.length, source: 'finmind' });

  try {
    const universe = await loadUniverse();
    const data = universe
      .map(item => ({ ...item, _score: score(item, rawQuery) }))
      .filter(item => item._score >= 0)
      .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name, 'zh-Hant'))
      .slice(0, limit)
      .map(({ _score, ...item }) => item);
    return res.json({ data, total: universe.length, source: 'finmind' });
  } catch (error) {
    return res.status(503).json({ data: [], total: cachedUniverse.length, source: 'error', error: error.message });
  }
}
