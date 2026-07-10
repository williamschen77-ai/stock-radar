// 訪客人數計數器
// 使用 CountAPI（免登入、免金鑰的公開計數服務）記錄真實的造訪次數。
// 若服務暫時無法連線，回傳 null 讓前端隱藏計數器，而非顯示假數字。
const NS = 'stock-radar-williamschen';

async function hit(key) {
  const r = await fetch(`https://countapi.mileshilliard.com/api/v1/hit/${key}`, {
    signal: AbortSignal.timeout(5000),
  });
  const d = await r.json();
  return typeof d.value === 'number' ? d.value : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // 以台北時區日期作為「今日」的計數 key，每天自然歸零重新累計
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }).replace(/-/g, '');

  try {
    const [total, today] = await Promise.all([
      hit(`${NS}-total`),
      hit(`${NS}-${todayStr}`),
    ]);
    if (total == null || today == null) return res.json({ total: null, today: null });
    return res.json({ total, today });
  } catch (_) {
    return res.json({ total: null, today: null });
  }
}
