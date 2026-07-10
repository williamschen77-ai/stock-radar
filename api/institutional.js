export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const clean = v => parseInt((v || '0').replace(/,/g, '')) || 0;
  const rows = [];

  // Try last 14 calendar days to get ~5 trading days
  const today = new Date();
  for (let i = 0; i <= 14 && rows.length < 10; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;

    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await r.json();
      if (!data?.data) continue;

      const found = data.data.find(row => row[0] === code);
      if (found) {
        rows.push({
          date:    `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
          foreign: clean(found[4]),
          trust:   clean(found[10]),
          dealer:  clean(found[14]) + clean(found[16]),
          total:   clean(found[18]),
        });
      }
    } catch (_) {}
  }

  return res.json({ data: rows.reverse() });
}
