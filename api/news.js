// 個股新聞 API：結合 AI 生成 + Yahoo Finance RSS
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { code, name } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const stockName = name || code;
  const newsItems = [];

  // 1. Yahoo Finance 新聞 RSS（台股格式 code.TW）
  try {
    const rssUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.TW?range=1d&interval=1d`;
    const r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    // Yahoo doesn't have RSS for TW stocks easily, try news endpoint
    const newsUrl = `https://query2.finance.yahoo.com/v2/finance/news?symbols=${code}.TW&newsCount=10`;
    const r2 = await fetch(newsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r2.ok) {
      const d = await r2.json();
      const items = d?.data?.main?.stream || [];
      items.slice(0,5).forEach(item => {
        if (item?.content) {
          newsItems.push({
            title: item.content.title || '',
            date: item.content.pubDate?.slice(0,10) || '',
            summary: item.content.summary || '',
            source: item.content.provider?.displayName || 'Yahoo Finance',
            url: item.content.canonicalUrl?.url || '',
            sentiment: 'neutral',
          });
        }
      });
    }
  } catch(_) {}

  // 2. AI 生成補充新聞（確保有內容）
  try {
    const today = new Date().toISOString().slice(0,10);
    const prompt = `你是台股財經記者。請為「${stockName}（${code}）」生成5則模擬近期財經新聞（日期在${today}前後）。
包含技術面、法人動向、產業消息、財報、市場展望等不同面向。
只回傳JSON陣列，不要其他文字：
[{"title":"標題（30字內）","date":"${today}","summary":"摘要（50字內）","source":"媒體名稱","sentiment":"正面|中性|負面"},...]`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const aiData = await aiRes.json();
    const txt = aiData.content?.map(b => b.text || '').join('') || '[]';
    const aiNews = JSON.parse(txt.replace(/```json|```/g,'').trim());
    if (Array.isArray(aiNews)) newsItems.push(...aiNews.slice(0,5));
  } catch(_) {}

  // Deduplicate and sort by date
  const seen = new Set();
  const deduped = newsItems.filter(n => {
    if (!n.title || seen.has(n.title)) return false;
    seen.add(n.title);
    return true;
  }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  return res.json({ data: deduped.slice(0, 8) });
}
