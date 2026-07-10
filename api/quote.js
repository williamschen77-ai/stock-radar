export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { symbol, range = '6mo', interval = '1d' } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: 'No data' });

    const { timestamp, indicators, meta } = result;
    const q = indicators.quote[0];

    const candles = timestamp.map((ts, i) => ({
      date:  new Date(ts * 1000).toISOString().slice(0, 10),
      open:  q.open[i]   != null ? +q.open[i].toFixed(2)  : null,
      high:  q.high[i]   != null ? +q.high[i].toFixed(2)  : null,
      low:   q.low[i]    != null ? +q.low[i].toFixed(2)   : null,
      close: q.close[i]  != null ? +q.close[i].toFixed(2) : null,
      vol:   q.volume[i] || 0,
    })).filter(c => c.close !== null);

    return res.json({
      candles,
      quote: {
        price: meta.regularMarketPrice,
        prev:  meta.previousClose || meta.chartPreviousClose,
        high:  meta.regularMarketDayHigh,
        low:   meta.regularMarketDayLow,
        open:  meta.regularMarketOpen,
        vol:   meta.regularMarketVolume,
        name:  meta.longName || meta.shortName || symbol,
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
