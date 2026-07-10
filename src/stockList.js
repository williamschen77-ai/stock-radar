// 台股中文名稱對照表（含搜尋用）
export const STOCK_MAP = {
  "2330": { name: "台積電", sector: "半導體" },
  "2317": { name: "鴻海", sector: "電子製造" },
  "2454": { name: "聯發科", sector: "半導體" },
  "2382": { name: "廣達", sector: "伺服器" },
  "2308": { name: "台達電", sector: "電源零組件" },
  "2412": { name: "中華電", sector: "電信" },
  "2303": { name: "聯電", sector: "晶圓代工" },
  "2881": { name: "富邦金", sector: "金融" },
  "2882": { name: "國泰金", sector: "金融" },
  "2886": { name: "兆豐金", sector: "金融" },
  "2891": { name: "中信金", sector: "金融" },
  "2892": { name: "第一金", sector: "金融" },
  "2884": { name: "玉山金", sector: "金融" },
  "2885": { name: "元大金", sector: "金融" },
  "2887": { name: "台新金", sector: "金融" },
  "2890": { name: "永豐金", sector: "金融" },
  "2801": { name: "彰化銀行", sector: "銀行" },
  "1301": { name: "台塑", sector: "塑膠" },
  "1303": { name: "南亞", sector: "塑膠" },
  "1326": { name: "台化", sector: "塑膠" },
  "6505": { name: "台塑化", sector: "石化" },
  "2002": { name: "中鋼", sector: "鋼鐵" },
  "1101": { name: "台泥", sector: "水泥" },
  "1216": { name: "統一", sector: "食品" },
  "2912": { name: "統一超", sector: "零售" },
  "2327": { name: "國巨", sector: "被動元件" },
  "2379": { name: "瑞昱", sector: "IC設計" },
  "3008": { name: "大立光", sector: "光學" },
  "2357": { name: "華碩", sector: "電腦" },
  "2353": { name: "宏碁", sector: "電腦" },
  "2395": { name: "研華", sector: "工業電腦" },
  "4904": { name: "遠傳", sector: "電信" },
  "3045": { name: "台灣大", sector: "電信" },
  "2408": { name: "南亞科", sector: "記憶體" },
  "3711": { name: "日月光投控", sector: "封測" },
  "2301": { name: "光寶科", sector: "電子" },
  "2324": { name: "仁寶", sector: "電腦" },
  "2337": { name: "旺宏", sector: "記憶體" },
  "2376": { name: "技嘉", sector: "主機板" },
  "2385": { name: "群光", sector: "電子" },
  "2393": { name: "億光", sector: "LED" },
  "2474": { name: "可成", sector: "機殼" },
  "6669": { name: "緯穎", sector: "伺服器" },
  "3034": { name: "聯詠", sector: "IC設計" },
  "6415": { name: "矽力-KY", sector: "IC設計" },
  "8046": { name: "南電", sector: "PCB" },
  "3533": { name: "嘉澤", sector: "連接器" },
  "2404": { name: "漢唐", sector: "工程" },
  // ETF
  "0050": { name: "元大台灣50", sector: "ETF" },
  "0056": { name: "元大高股息", sector: "ETF" },
  "00878": { name: "國泰永續高股息", sector: "ETF" },
  "00881": { name: "國泰台灣5G+", sector: "ETF" },
  "00886": { name: "國泰美國道瓊", sector: "ETF" },
  "006208": { name: "富邦台50", sector: "ETF" },
  "00891": { name: "中信關鍵半導體", sector: "ETF" },
  "00900": { name: "富邦特選高股息30", sector: "ETF" },
  "00919": { name: "群益台灣精選高息", sector: "ETF" },
  "00929": { name: "復華台灣科技優息", sector: "ETF" },
  "00934": { name: "中信成長高股息", sector: "ETF" },
  "00940": { name: "元大台灣價值高息", sector: "ETF" },
  "00944": { name: "群益半導體收益", sector: "ETF" },
  "00946": { name: "元大台灣晶圓製造", sector: "ETF" },
  "00979": { name: "富蘭克林永續美國成長", sector: "ETF" },
};

// 反向查詢：中文名稱 → 股票代號
export const NAME_TO_CODE = Object.fromEntries(
  Object.entries(STOCK_MAP).map(([code, v]) => [v.name, code])
);

// 搜尋函數：支援代號或中文名稱模糊搜尋
export function searchStock(query) {
  const q = query.trim();
  if (!q) return [];
  // 完全符合代號
  if (STOCK_MAP[q]) return [{ code: q, ...STOCK_MAP[q] }];
  // 模糊搜尋
  return Object.entries(STOCK_MAP)
    .filter(([code, v]) =>
      code.includes(q) || v.name.includes(q) || v.sector.includes(q)
    )
    .slice(0, 8)
    .map(([code, v]) => ({ code, ...v }));
}

export function getStockName(code) {
  return STOCK_MAP[code]?.name || null;
}
