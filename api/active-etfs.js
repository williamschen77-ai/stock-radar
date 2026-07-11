import { ACTIVE_ETF_CODES, fetchEtfHoldings } from './_lib/moneydj.js';

const CACHE_TTL = 30 * 60 * 1000;
let cache = { at: 0, data: [] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  if (cache.data.length && Date.now() - cache.at < CACHE_TTL) {
    return res.json({ data: cache.data, source: 'moneydj', cached: true });
  }

  try {
    const fetched = await Promise.all(ACTIVE_ETF_CODES.map(code => fetchEtfHoldings(code).catch(() => null)));
    const data = fetched.filter(Boolean).filter(etf => etf.holdings.length).map(etf => ({
      code: etf.code,
      name: etf.name,
      asOf: etf.asOf,
      holdingsCount: etf.holdings.length,
      topHoldings: [...etf.holdings].sort((a, b) => b.weight - a.weight).slice(0, 3),
    }));
    if (data.length) cache = { at: Date.now(), data };
    return res.json({ data: cache.data, source: 'moneydj', cached: false });
  } catch (error) {
    return res.status(500).json({ data: [], source: 'error', error: error.message });
  }
}
