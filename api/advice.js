// AI 買進建議 API：綜合技術面、籌碼面、法人動向給出評分與建議
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch(_) {}

  const { code, name, price, prev, candles = [], instData = [], etfData = [], disposition = {} } = body;
  if (!code) return res.status(400).json({ error: 'code required' });

  // Build technical context
  const recentCandles = candles.slice(-20);
  const closes = recentCandles.map(c => c.close).filter(Boolean);
  const ma5  = closes.length >= 5  ? (closes.slice(-5).reduce((a,b)=>a+b,0)/5).toFixed(1)  : null;
  const ma20 = closes.length >= 20 ? (closes.slice(-20).reduce((a,b)=>a+b,0)/20).toFixed(1) : null;
  const priceChange5d = closes.length >= 5 ? +((closes[closes.length-1] - closes[closes.length-6]) / closes[closes.length-6] * 100).toFixed(2) : null;
  const high20 = closes.length ? Math.max(...recentCandles.map(c=>c.high||0)) : null;
  const low20  = closes.length ? Math.min(...recentCandles.map(c=>c.low||Infinity)) : null;

  // Inst summary
  const instRecent = instData.slice(-5);
  const foreignTotal = instRecent.reduce((s,d)=>s+(d.foreign||0), 0);
  const trustTotal   = instRecent.reduce((s,d)=>s+(d.trust||0),   0);
  const dealerTotal  = instRecent.reduce((s,d)=>s+(d.dealer||0),  0);

  // ETF consensus
  const etfBuyers  = etfData.filter(e => (e.delta||0) > 0.1).length;
  const etfSellers = etfData.filter(e => (e.delta||0) < -0.1).length;

  const prompt = `你是專業台股分析師，需要給出清晰的投資建議。請分析以下資料：

股票：${name}（${code}）
現價：${price}，前收：${prev}，5日漲跌：${priceChange5d}%
MA5：${ma5}，MA20：${ma20}
20日高點：${high20}，20日低點：${low20}
處置狀態：${disposition.isDisposed ? '⚠️ 目前處置中' + (disposition.unlockDate ? '，預計'+disposition.unlockDate+'出關':'') : '正常'}
融券回補：${disposition.nearLock ? '⚠️ 即將面臨融券回補，'+disposition.lockDate+'最後買進日' : '無'}

三大法人近5日（張）：
- 外資合計：${foreignTotal > 0 ? '+' : ''}${foreignTotal}
- 投信合計：${trustTotal > 0 ? '+' : ''}${trustTotal}
- 自營合計：${dealerTotal > 0 ? '+' : ''}${dealerTotal}

主動ETF：${etfData.length}檔持有，${etfBuyers}檔加碼，${etfSellers}檔減碼

請從技術面、籌碼面、風險面三個角度分析，給出評分和建議。
只回傳JSON，不要其他文字：
{
  "score": 數字(0-100，越高越適合買進),
  "rating": "強力買進|買進|觀望|偏空|賣出",
  "ratingColor": "green|lightgreen|yellow|orange|red",
  "technical": "技術面分析（2句話）",
  "chip": "籌碼面分析（2句話）",
  "risk": "主要風險（1句話）",
  "strategy": "操作策略建議（2句話，含進場價位或條件）",
  "targetPrice": 數字(目標價),
  "stopLoss": 數字(停損價),
  "keyPoints": ["重點1","重點2","重點3"]
}`;

  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const aiData = await aiRes.json();
    const txt = aiData.content?.map(b => b.text || '').join('') || '{}';
    const advice = JSON.parse(txt.replace(/```json|```/g,'').trim());
    return res.json(advice);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
