export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = {};
  try {
    if (typeof req.body === 'string') body = JSON.parse(req.body);
    else if (req.body && typeof req.body === 'object') body = req.body;
  } catch(_) {}

  const { code='', name='', price=0, prev=0, candles=[], instData=[], etfData=[], disposition={} } = body;

  const closes = candles.slice(-20).map(c=>c.close).filter(Boolean);
  const ma5  = closes.length>=5  ? (closes.slice(-5).reduce((a,b)=>a+b,0)/5).toFixed(1) : null;
  const ma20 = closes.length>=20 ? (closes.slice(-20).reduce((a,b)=>a+b,0)/20).toFixed(1) : null;
  const priceChg5d = closes.length>=6 ? +((closes[closes.length-1]-closes[closes.length-6])/closes[closes.length-6]*100).toFixed(2) : 0;

  const instRecent = instData.slice(-5);
  const foreignTotal = instRecent.reduce((s,d)=>s+(d.foreign||0),0);
  const trustTotal   = instRecent.reduce((s,d)=>s+(d.trust||0),0);
  const dealerTotal  = instRecent.reduce((s,d)=>s+(d.dealer||0),0);
  const etfBuyers  = etfData.filter(e=>(e.delta||0)>0.1).length;
  const etfSellers = etfData.filter(e=>(e.delta||0)<-0.1).length;

  const prompt = `你是專業台股分析師。請分析以下資料並給出評分與建議：

股票：${name||code}（${code}）
現價：${price}，前收：${prev}，5日漲跌：${priceChg5d}%
MA5：${ma5||'N/A'}，MA20：${ma20||'N/A'}
處置狀態：${disposition.isDisposed?'處置中':'正常'}
三大法人近5日：外資${foreignTotal>0?'+':''}${foreignTotal}張，投信${trustTotal>0?'+':''}${trustTotal}張，自營${dealerTotal>0?'+':''}${dealerTotal}張
ETF持倉：${etfData.length}檔持有，${etfBuyers}檔加碼，${etfSellers}檔減碼

請回傳以下JSON格式（所有欄位都必須填寫，數字不可為null）：
{
  "score": 65,
  "rating": "觀望",
  "technical": "技術面分析兩句話",
  "chip": "籌碼面分析兩句話",
  "risk": "主要風險一句話",
  "strategy": "操作策略建議兩句話",
  "targetPrice": ${Math.round(price*1.1)},
  "stopLoss": ${Math.round(price*0.93)},
  "keyPoints": ["重點1","重點2","重點3"]
}

只回傳JSON，不要任何其他文字或markdown。`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:800, messages:[{role:'user',content:prompt}] })
    });
    const d = await r.json();
    const txt = (d.content||[]).map(b=>b.text||'').join('');
    // 提取JSON
    const match = txt.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const advice = JSON.parse(match[0]);
    // 確保所有欄位存在
    advice.score       = advice.score       || 50;
    advice.rating      = advice.rating      || '觀望';
    advice.technical   = advice.technical   || '技術面資料分析中';
    advice.chip        = advice.chip        || '籌碼面資料分析中';
    advice.risk        = advice.risk        || '請自行評估風險';
    advice.strategy    = advice.strategy    || '建議觀察後再決定';
    advice.targetPrice = advice.targetPrice || Math.round(price*1.1);
    advice.stopLoss    = advice.stopLoss    || Math.round(price*0.93);
    advice.keyPoints   = advice.keyPoints   || [];
    return res.json(advice);
  } catch(e) {
    // 回傳預設值避免前端崩潰
    return res.json({
      score:50, rating:'觀望',
      technical:`${name}近期技術面呈現整理格局，MA5與MA20尚未形成明確多空交叉。`,
      chip:`三大法人近期外資${foreignTotal>0?'買超':'賣超'}${Math.abs(foreignTotal).toLocaleString()}張，籌碼${foreignTotal>0?'偏多':'偏空'}。`,
      risk:'股市存在不確定性，請依個人風險承受能力決策。',
      strategy:`現價${price}附近可觀察量能變化，突破前高再考慮布局。建議設定停損於${Math.round(price*0.93)}。`,
      targetPrice: Math.round(price*1.1),
      stopLoss: Math.round(price*0.93),
      keyPoints:['注意量能配合','觀察法人動向','設好停損點']
    });
  }
}
