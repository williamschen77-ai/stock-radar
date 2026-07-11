import { ACTIVE_ETF_CODES } from './_lib/moneydj.js';
import { kvEnabled, kvZRange } from './_lib/kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!kvEnabled()) {
    return res.json({
      kvConnected: false,
      trackedEtfCount: ACTIVE_ETF_CODES.length,
      coveredEtfCount: 0,
      maxSnapshots: 0,
      latestSnapshot: null,
    });
  }

  try {
    const rows = await Promise.all(ACTIVE_ETF_CODES.map(async code => {
      const dates = (await kvZRange(`etfsnap:${code}:dates`, 0, -1)) || [];
      return { code, count: dates.length, latest: dates.at(-1) || null };
    }));
    const covered = rows.filter(row => row.count > 0);
    return res.json({
      kvConnected: true,
      trackedEtfCount: ACTIVE_ETF_CODES.length,
      coveredEtfCount: covered.length,
      maxSnapshots: Math.max(0, ...rows.map(row => row.count)),
      latestSnapshot: covered.map(row => row.latest).sort().at(-1) || null,
    });
  } catch (error) {
    return res.status(500).json({ kvConnected: true, error: error.message });
  }
}
