// 極簡 Upstash Redis REST client（不依賴 @vercel/kv 套件，純 fetch）。
// 需要在 Vercel 專案加裝 Vercel KV / Upstash 整合後才會自動注入這兩個環境變數；
// 沒設定時所有函式回傳 null，呼叫端要自行處理「尚未啟用歷史追蹤」的狀態。
const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;

export const kvEnabled = () => !!(URL && TOKEN);

async function cmd(...args) {
  if (!kvEnabled()) return null;
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const d = await r.json();
  return d.result;
}

export const kvSet = (key, value) => cmd('SET', key, value);
export const kvGet = (key) => cmd('GET', key);
export const kvZAdd = (key, score, member) => cmd('ZADD', key, score, member);
export const kvZRange = (key, start, stop) => cmd('ZRANGE', key, start, stop);
