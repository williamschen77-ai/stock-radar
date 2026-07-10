async function fetchChart(symbol, range, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    }
  });
  const data = await r.json();
  return data?.chart?.result?.[0] || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code, symbol, range = '6mo', interval = '1d' } = req.query;
  const baseCode = code || (symbol ? symbol.replace(/\.(TW|TWO)$/i, '') : '');
  if (!baseCode) return res.status(400).json({ error: 'code required' });

  try {
    // TWSE-listed stocks use .TW, TPEx (OTC) stocks use .TWO — try both.
    let result = await fetchChart(`${baseCode}.TW`, range, interval);
    if (!result) result = await fetchChart(`${baseCode}.TWO`, range, interval);
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

    if (!candles.length) return res.status(404).json({ error: 'No data' });

    // Yahoo's meta.previousClose is unreliable for TW symbols (often missing),
    // and chartPreviousClose is the close *before the whole requested range*,
    // not yesterday's close — so derive price/prev directly from the candles.
    const last = candles[candles.length - 1];
    const prevCandle = candles.length > 1 ? candles[candles.length - 2] : null;

    return res.json({
      candles,
      quote: {
        price: last.close,
        prev:  prevCandle ? prevCandle.close : (meta.previousClose || meta.chartPreviousClose || last.close),
        high:  last.high,
        low:   last.low,
        open:  last.open,
        vol:   last.vol,
        name:  meta.longName || meta.shortName || baseCode,
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
