import { useState, useEffect, useMemo, useRef } from "react";

// ─── Design tokens ────────────────────────────────────────────
const T = {
  bg:       "#090e13",
  surface:  "#0f1820",
  card:     "#141f2c",
  border:   "#1a2c3d",
  borderLit:"#2a4560",
  accent:   "#38bdf8",
  accentDim:"#38bdf815",
  buy:      "#22d3a0",
  buyDim:   "#22d3a012",
  sell:     "#fb7185",
  sellDim:  "#fb718512",
  yellow:   "#fbbf24",
  purple:   "#a78bfa",
  text:     "#e2eaf2",
  muted:    "#5a7a96",
  dim:      "#1e3045",
  ma: {
    ma5:   "#facc15",
    ma20:  "#38bdf8",
    ma60:  "#f97316",
    ma120: "#a78bfa",
    ma240: "#f472b6",
  }
};

// ─── CORS proxy + Yahoo Finance ───────────────────────────────
const PROXY = "https://corsproxy.io/?";

async function fetchYahoo(symbol, range = "6mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("No data");
  const { timestamp, indicators } = result;
  const q = indicators.quote[0];
  return timestamp.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open:  +q.open[i]?.toFixed(2)  || null,
    high:  +q.high[i]?.toFixed(2)  || null,
    low:   +q.low[i]?.toFixed(2)   || null,
    close: +q.close[i]?.toFixed(2) || null,
    vol:   q.volume[i] || 0,
  })).filter(c => c.close !== null);
}

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  const data = await res.json();
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error("No quote");
  const meta = r.meta;
  return {
    price:  meta.regularMarketPrice,
    prev:   meta.previousClose || meta.chartPreviousClose,
    high:   meta.regularMarketDayHigh,
    low:    meta.regularMarketDayLow,
    open:   meta.regularMarketOpen,
    vol:    meta.regularMarketVolume,
    name:   meta.longName || meta.shortName || symbol,
  };
}

// ─── TWSE 三大法人 ────────────────────────────────────────────
async function fetchInstitutional(stockCode) {
  // Use TWSE open API
  const today = new Date();
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;
      const res = await fetch(PROXY + encodeURIComponent(url));
      const data = await res.json();
      const found = data?.data?.find(row => row[0] === stockCode);
      if (found) {
        const clean = v => parseInt((v || "0").replace(/,/g, "")) || 0;
        rows.push({
          date: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,
          foreign: clean(found[4]),
          trust:   clean(found[10]),
          dealer:  clean(found[14]) + clean(found[16]),
          total:   clean(found[18]),
        });
      }
    } catch(e) {}
    if (rows.length >= 10) break;
  }
  // Fetch more dates if needed
  if (rows.length < 5) {
    // Try fetching a month range
    const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}01`;
    try {
      const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${dateStr}&selectType=ALLBUT0999`;
      const res = await fetch(PROXY + encodeURIComponent(url));
      const data = await res.json();
      if (data?.data) {
        data.data.forEach(row => {
          if (row[0] === stockCode) {
            const clean = v => parseInt((v || "0").replace(/,/g, "")) || 0;
            const dateRaw = data.date || dateStr;
            rows.push({
              date: dateStr.slice(0,4)+"-"+dateStr.slice(4,6)+"-"+dateStr.slice(6,8),
              foreign: clean(row[4]),
              trust:   clean(row[10]),
              dealer:  clean(row[14]) + clean(row[16]),
              total:   clean(row[18]),
            });
          }
        });
      }
    } catch(e) {}
  }
  return rows.slice(0, 10).reverse();
}

// ─── AI helpers ───────────────────────────────────────────────
async function aiJSON(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const d = await res.json();
  const txt = d.content?.map(b => b.text || "").join("") || "{}";
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
}

async function fetchAIAnalysis(stockCode, name, quote, instData) {
  const instSummary = instData.length
    ? instData.slice(-3).map(d => `${d.date} 外資${d.foreign>0?"+":""}${d.foreign} 投信${d.trust>0?"+":""}${d.trust} 自營${d.dealer>0?"+":""}${d.dealer}`).join("；")
    : "資料載入中";
  return aiJSON(`你是台股分析師。針對「${name}（${stockCode}）」，現價${quote?.price}，
三大法人近期：${instSummary}。
請只回傳JSON，不要其他文字：
{"summary":"2句話概述近期基本面與籌碼狀況","consensus":"1句話法人共識評估","risk":"1句話主要風險",
"news":[{"title":"標題","date":"2026-07-XX","sentiment":"正面"},{"title":"標題","date":"2026-07-XX","sentiment":"中性"},{"title":"標題","date":"2026-07-XX","sentiment":"負面"}]}`);
}

async function fetchAIPrediction(name, candles) {
  const recent = candles.slice(-10).map(c=>`${c.date} C:${c.close}`).join(" | ");
  return aiJSON(`根據${name}近10日收盤（${recent}），預測未來5個交易日。
只回傳JSON陣列不要其他文字：
[{"date":"2026-07-08","close":數字,"high":數字,"low":數字},{"date":"2026-07-09","close":數字,"high":數字,"low":數字},{"date":"2026-07-10","close":數字,"high":數字,"low":數字},{"date":"2026-07-11","close":數字,"high":數字,"low":數字},{"date":"2026-07-14","close":數字,"high":數字,"low":數字}]`);
}

// ─── Moving average calculator ────────────────────────────────
function calcMA(candles, period) {
  return candles.map((_, i) => {
    if (i < period - 1) return null;
    const slice = candles.slice(i - period + 1, i + 1);
    return +(slice.reduce((s, c) => s + c.close, 0) / period).toFixed(2);
  });
}

// ─── Breakout detector ────────────────────────────────────────
function findKeyDates(candles) {
  const out = [];
  for (let i = 20; i < candles.length; i++) {
    const win = candles.slice(i - 20, i);
    const maxH = Math.max(...win.map(c => c.high));
    const minL = Math.min(...win.map(c => c.low));
    const c = candles[i];
    if (c.close >= maxH * 0.999) out.push({ date: c.date, type: "突破", price: c.close, desc: "突破20日高點" });
    else if (c.close <= minL * 1.001) out.push({ date: c.date, type: "跌破", price: c.close, desc: "跌破20日低點" });
  }
  return out.slice(-6).reverse();
}

// ─── Chart: Candlestick + MA lines ────────────────────────────
function CandleChart({ candles, predicted = [], maLines = {}, showMA = {} }) {
  const W = 800, H = 340;
  const pad = { l: 62, r: 16, t: 20, b: 30 };
  const all = [...candles, ...predicted];
  const prices = all.flatMap(c => [c.high, c.low].filter(Boolean));
  const maVals = Object.values(maLines).flat().filter(v => v !== null);
  const allPrices = [...prices, ...maVals];
  const minP = Math.min(...allPrices) * 0.998;
  const maxP = Math.max(...allPrices) * 1.002;
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  const n = all.length;
  const bw = Math.max(2, Math.floor(cW / n) - 1);
  const toX = i => pad.l + (i / n) * cW + bw / 2;
  const toY = p => pad.t + cH - ((p - minP) / (maxP - minP)) * cH;
  const yTicks = 6;

  const maConfigs = [
    { key: "ma5",   label: "MA5",   period: 5,   color: T.ma.ma5 },
    { key: "ma20",  label: "MA20",  period: 20,  color: T.ma.ma20 },
    { key: "ma60",  label: "MA60",  period: 60,  color: T.ma.ma60 },
    { key: "ma120", label: "MA120", period: 120, color: T.ma.ma120 },
    { key: "ma240", label: "MA240", period: 240, color: T.ma.ma240 },
  ];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      {/* Y grid */}
      {Array.from({ length: yTicks }).map((_, i) => {
        const val = minP + (i / (yTicks - 1)) * (maxP - minP);
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke={T.border} strokeWidth="0.5" />
            <text x={pad.l - 5} y={y + 4} textAnchor="end" fill={T.muted} fontSize="9">{val.toFixed(1)}</text>
          </g>
        );
      })}
      {/* MA lines */}
      {maConfigs.map(({ key, color }) => {
        if (!showMA[key] || !maLines[key]) return null;
        const pts = maLines[key].map((v, i) => v !== null ? `${toX(i)},${toY(v)}` : null).filter(Boolean);
        if (pts.length < 2) return null;
        return <polyline key={key} points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.2" opacity="0.85" strokeLinejoin="round" />;
      })}
      {/* Candles */}
      {candles.map((c, i) => {
        const x = toX(i);
        const isUp = c.close >= c.open;
        const col = isUp ? T.buy : T.sell;
        const top = toY(Math.max(c.open, c.close));
        const bot = toY(Math.min(c.open, c.close));
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={col} strokeWidth="1" opacity="0.7" />
            <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1, bot - top)} fill={col} opacity="0.85" />
          </g>
        );
      })}
      {/* Predicted overlay */}
      {predicted.length > 0 && (() => {
        const si = candles.length;
        const pts = predicted.map((c, i) => `${toX(si + i)},${toY(c.close)}`).join(" ");
        return (
          <g>
            <rect x={toX(si) - bw} y={pad.t} width={W - pad.r - toX(si) + bw} height={cH} fill={T.yellow} opacity="0.04" />
            <polyline points={pts} fill="none" stroke={T.yellow} strokeWidth="1.8" strokeDasharray="5,3" />
            {predicted.map((c, i) => (
              <rect key={i} x={toX(si + i) - bw / 2} y={toY(c.high)} width={bw}
                height={Math.max(1, toY(c.low) - toY(c.high))} fill={T.yellow} opacity="0.15" />
            ))}
            <text x={toX(si) + 2} y={pad.t + 10} fill={T.yellow} fontSize="9" opacity="0.9">▶ AI預測</text>
          </g>
        );
      })()}
      {/* X-axis dates */}
      {[0, Math.floor(n * 0.2), Math.floor(n * 0.4), Math.floor(n * 0.6), Math.floor(n * 0.8), n - 1].map(i => {
        const c = all[i]; if (!c) return null;
        return <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fill={T.muted} fontSize="8">{c.date?.slice(5)}</text>;
      })}
    </svg>
  );
}

// ─── Volume chart ─────────────────────────────────────────────
function VolumeChart({ candles }) {
  const W = 800, H = 80;
  const pad = { l: 62, r: 16, t: 8, b: 20 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  const n = candles.length;
  const maxV = Math.max(...candles.map(c => c.vol), 1);
  const bw = Math.max(2, Math.floor(cW / n) - 1);
  const toX = i => pad.l + (i / n) * cW + bw / 2;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <text x={pad.l - 5} y={pad.t + 8} textAnchor="end" fill={T.muted} fontSize="8">{fmtVol(maxV)}</text>
      {candles.map((c, i) => {
        const bh = (c.vol / maxV) * cH;
        return <rect key={i} x={toX(i) - bw / 2} y={pad.t + cH - bh} width={bw} height={bh}
          fill={c.close >= c.open ? T.buy : T.sell} opacity="0.55" />;
      })}
    </svg>
  );
}

// ─── Institutional bar chart ──────────────────────────────────
function InstBarChart({ data }) {
  if (!data?.length) return <div style={{ color: T.muted, padding: 20, textAlign: "center" }}>載入中…</div>;
  const W = 800, H = 160;
  const pad = { l: 62, r: 16, t: 20, b: 28 };
  const cW = W - pad.l - pad.r;
  const cH = H - pad.t - pad.b;
  const vals = data.flatMap(d => [d.foreign, d.trust, d.dealer].map(Math.abs));
  const maxV = Math.max(...vals, 1);
  const n = data.length;
  const bw = Math.max(4, Math.floor(cW / n / 4));
  const toX = i => pad.l + (i / n) * cW;
  const zero = pad.t + cH / 2;
  const toY = v => zero - (v / maxV) * (cH / 2);

  const series = [
    { key: "foreign", color: T.accent,  label: "外資" },
    { key: "trust",   color: T.yellow,  label: "投信" },
    { key: "dealer",  color: T.purple,  label: "自營" },
  ];

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <line x1={pad.l} x2={W - pad.r} y1={zero} y2={zero} stroke={T.borderLit} strokeWidth="1" />
      {data.map((d, i) => (
        series.map((s, j) => {
          const val = d[s.key];
          const y = val >= 0 ? toY(val) : zero;
          const h = Math.max(1, Math.abs(toY(val) - zero));
          return <rect key={`${i}-${j}`} x={toX(i) + j * (bw + 1)} y={y} width={bw} height={h} fill={s.color} opacity="0.8" />;
        })
      ))}
      {/* X labels */}
      {data.map((d, i) => (
        <text key={i} x={toX(i) + bw * 1.5} y={H - 4} textAnchor="middle" fill={T.muted} fontSize="8">{d.date?.slice(5)}</text>
      ))}
      {/* Legend */}
      {series.map((s, i) => (
        <g key={i}>
          <rect x={pad.l + i * 52} y={4} width={8} height={8} fill={s.color} rx="1" />
          <text x={pad.l + i * 52 + 11} y={12} fill={T.muted} fontSize="9">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

// ─── Helpers ──────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtVol(v) {
  if (!v) return "—";
  if (v >= 1e8) return (v / 1e8).toFixed(1) + "億";
  if (v >= 1e4) return (v / 1e4).toFixed(0) + "萬";
  return v.toLocaleString();
}
function pctColor(v) { return v > 0 ? T.buy : v < 0 ? T.sell : T.muted; }
function pctStr(v) { return (v > 0 ? "+" : "") + v?.toFixed(2) + "%"; }
function instColor(v) { return v > 0 ? T.buy : v < 0 ? T.sell : T.muted; }

const TABS = [
  { id: "kline",  label: "K線圖" },
  { id: "inst",   label: "三大法人" },
  { id: "dates",  label: "關鍵突破" },
  { id: "ai",     label: "AI 分析" },
];

const MA_OPTIONS = [
  { key: "ma5",   label: "MA5",   color: T.ma.ma5   },
  { key: "ma20",  label: "MA20",  color: T.ma.ma20  },
  { key: "ma60",  label: "季線",  color: T.ma.ma60  },
  { key: "ma120", label: "半年",  color: T.ma.ma120 },
  { key: "ma240", label: "年線",  color: T.ma.ma240 },
];

const RANGE_OPTIONS = [
  { label: "1個月", range: "1mo"  },
  { label: "3個月", range: "3mo"  },
  { label: "6個月", range: "6mo"  },
  { label: "1年",   range: "1y"   },
  { label: "2年",   range: "2y"   },
];

const POPULAR = ["2330", "2454", "2317", "2382", "2308", "2412"];

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [stockCode, setStockCode] = useState("2330");
  const [inputVal, setInputVal]   = useState("");
  const [tab, setTab]             = useState("kline");
  const [range, setRange]         = useState("6mo");
  const [showMA, setShowMA]       = useState({ ma5: true, ma20: true, ma60: true, ma120: false, ma240: false });

  const [candles,  setCandles]  = useState([]);
  const [quote,    setQuote]    = useState(null);
  const [instData, setInstData] = useState([]);
  const [aiData,   setAiData]   = useState(null);
  const [predicted,setPredicted]= useState([]);

  const [loading,     setLoading]     = useState(false);
  const [instLoading, setInstLoading] = useState(false);
  const [aiLoading,   setAiLoading]   = useState(false);
  const [predLoading, setPredLoading] = useState(false);
  const [error,       setError]       = useState("");

  const symbol = stockCode + ".TW";

  // Fetch K-line + quote
  useEffect(() => {
    setLoading(true); setError(""); setCandles([]); setQuote(null);
    Promise.all([fetchYahoo(symbol, range), fetchQuote(symbol)])
      .then(([c, q]) => { setCandles(c); setQuote(q); })
      .catch(() => setError("股票代號無效或網路問題，請確認後重試"))
      .finally(() => setLoading(false));
  }, [stockCode, range]);

  // Fetch institutional (when code changes)
  useEffect(() => {
    setInstData([]); setInstLoading(true);
    fetchInstitutional(stockCode)
      .then(setInstData)
      .catch(() => setInstData([]))
      .finally(() => setInstLoading(false));
  }, [stockCode]);

  // Fetch AI when candles + inst ready
  useEffect(() => {
    if (!candles.length || !quote) return;
    setAiData(null); setAiLoading(true);
    fetchAIAnalysis(stockCode, quote.name, quote, instData)
      .then(setAiData).catch(() => setAiData(null)).finally(() => setAiLoading(false));

    setPredicted([]); setPredLoading(true);
    fetchAIPrediction(quote.name, candles)
      .then(setPredicted).catch(() => setPredicted([])).finally(() => setPredLoading(false));
  }, [candles.length, quote?.price, instData.length]);

  // MA lines
  const maLines = useMemo(() => ({
    ma5:   calcMA(candles, 5),
    ma20:  calcMA(candles, 20),
    ma60:  calcMA(candles, 60),
    ma120: calcMA(candles, 120),
    ma240: calcMA(candles, 240),
  }), [candles]);

  const keyDates = useMemo(() => findKeyDates(candles), [candles]);

  const chg    = quote ? +(quote.price - quote.prev).toFixed(2) : 0;
  const chgPct = quote ? +((chg / quote.prev) * 100).toFixed(2) : 0;

  function search() {
    const c = inputVal.trim().replace(/[^0-9A-Za-z]/g, "");
    if (c) { setStockCode(c); setInputVal(""); setTab("kline"); }
  }

  // Latest MA values for display
  const latestMA = {};
  MA_OPTIONS.forEach(m => {
    const arr = maLines[m.key];
    if (arr) latestMA[m.key] = arr.slice().reverse().find(v => v !== null);
  });

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text,
      fontFamily: "'SF Pro Text','PingFang TC','Helvetica Neue',system-ui,sans-serif", fontSize: 13 }}>

      {/* ── Header ── */}
      <header style={{ borderBottom: `1px solid ${T.border}`, padding: "0 20px",
        display: "flex", alignItems: "center", gap: 16, height: 52,
        position: "sticky", top: 0, background: T.bg, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: T.accentDim,
            border: `1px solid ${T.accent}40`, display: "grid", placeItems: "center",
            fontSize: 13, fontWeight: 900, color: T.accent }}>個</div>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>個股透視</span>
          <span style={{ color: T.muted, fontSize: 11, paddingLeft: 10, borderLeft: `1px solid ${T.border}` }}>
            台股即時籌碼分析
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {POPULAR.map(c => (
            <button key={c} onClick={() => { setStockCode(c); setTab("kline"); }}
              style={{ background: c === stockCode ? T.accentDim : "none",
                border: `1px solid ${c === stockCode ? T.accent + "80" : T.border}`,
                color: c === stockCode ? T.accent : T.muted,
                borderRadius: 6, padding: "4px 9px", cursor: "pointer", fontSize: 11,
                fontWeight: c === stockCode ? 700 : 400 }}>{c}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", background: T.card, border: `1px solid ${T.border}`,
            borderRadius: 8, overflow: "hidden" }}>
            <input value={inputVal} onChange={e => setInputVal(e.target.value)}
              onKeyDown={e => e.key === "Enter" && search()}
              placeholder="輸入股票代號…"
              style={{ background: "none", border: "none", outline: "none", color: T.text,
                fontSize: 12, padding: "7px 12px", width: 140 }} />
            <button onClick={search}
              style={{ background: T.accent, border: "none", color: "#000", fontWeight: 700,
                padding: "7px 14px", cursor: "pointer", fontSize: 12 }}>查詢</button>
          </div>
        </div>
      </header>

      {/* ── Quote bar ── */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "14px 20px", display: "flex", alignItems: "center", gap: 28 }}>
        {loading ? (
          <div style={{ color: T.muted }}>⏳ 載入中…</div>
        ) : error ? (
          <div style={{ color: T.sell }}>{error}</div>
        ) : quote ? (
          <>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 900 }}>{quote.name}</span>
                <span style={{ color: T.muted, fontSize: 12 }}>{stockCode}</span>
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                延遲報價 · 資料來源 Yahoo Finance
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 32, fontWeight: 900 }}>{fmt(quote.price)}</span>
              <span style={{ color: pctColor(chg), fontWeight: 700, fontSize: 15 }}>
                {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)} ({pctStr(chgPct)})
              </span>
            </div>
            <div style={{ display: "flex", gap: 20, marginLeft: 8 }}>
              {[["開盤", quote.open], ["最高", quote.high], ["最低", quote.low], ["昨收", quote.prev]].map(([l, v]) => (
                <div key={l}>
                  <div style={{ fontSize: 10, color: T.muted }}>{l}</div>
                  <div style={{ fontWeight: 600 }}>{fmt(v)}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: T.muted }}>成交量</div>
                <div style={{ fontWeight: 600 }}>{fmtVol(quote.vol)}</div>
              </div>
            </div>
            {/* Latest MA values */}
            <div style={{ display: "flex", gap: 14, marginLeft: "auto" }}>
              {MA_OPTIONS.map(m => latestMA[m.key] ? (
                <div key={m.key} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 9, color: m.color, fontWeight: 700 }}>{m.label}</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{fmt(latestMA[m.key])}</div>
                </div>
              ) : null)}
            </div>
          </>
        ) : null}
      </div>

      {/* ── Tabs ── */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 20px", display: "flex" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background: "none", border: "none", cursor: "pointer",
              padding: "10px 18px", fontSize: 12, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? T.accent : T.muted,
              borderBottom: `2px solid ${tab === t.id ? T.accent : "transparent"}` }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Main content ── */}
      <main style={{ padding: "16px 20px" }}>

        {/* K-LINE TAB */}
        {tab === "kline" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Controls row */}
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {/* Range selector */}
              <div style={{ display: "flex", gap: 4 }}>
                {RANGE_OPTIONS.map(r => (
                  <button key={r.range} onClick={() => setRange(r.range)}
                    style={{ background: range === r.range ? T.accentDim : T.card,
                      border: `1px solid ${range === r.range ? T.accent + "80" : T.border}`,
                      color: range === r.range ? T.accent : T.muted,
                      borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 11,
                      fontWeight: range === r.range ? 700 : 400 }}>{r.label}</button>
                ))}
              </div>
              <div style={{ width: 1, height: 20, background: T.border }} />
              {/* MA toggles */}
              {MA_OPTIONS.map(m => (
                <button key={m.key} onClick={() => setShowMA(s => ({ ...s, [m.key]: !s[m.key] }))}
                  style={{ background: showMA[m.key] ? m.color + "18" : T.card,
                    border: `1px solid ${showMA[m.key] ? m.color + "80" : T.border}`,
                    color: showMA[m.key] ? m.color : T.muted,
                    borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 11,
                    fontWeight: showMA[m.key] ? 700 : 400 }}>{m.label}</button>
              ))}
              {predLoading && <span style={{ color: T.yellow, fontSize: 11 }}>⏳ AI預測中…</span>}
            </div>

            {/* Candle chart */}
            <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "12px 8px" }}>
              {loading
                ? <div style={{ height: 340, display: "grid", placeItems: "center", color: T.muted }}>⏳ 載入K線中…</div>
                : candles.length > 0
                  ? <CandleChart candles={candles} predicted={predicted} maLines={maLines} showMA={showMA} />
                  : <div style={{ height: 340, display: "grid", placeItems: "center", color: T.muted }}>無資料</div>
              }
            </div>

            {/* Volume chart */}
            {candles.length > 0 && (
              <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "8px 8px 4px" }}>
                <div style={{ fontSize: 10, color: T.muted, paddingLeft: 8, marginBottom: 4 }}>成交量</div>
                <VolumeChart candles={candles} />
              </div>
            )}

            {/* AI prediction cards */}
            {predicted.length > 0 && (
              <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.yellow}33`, padding: "14px 16px" }}>
                <div style={{ color: T.yellow, fontWeight: 700, fontSize: 11, marginBottom: 10 }}>
                  🤖 AI 預測未來5交易日（僅供參考，非投資建議）
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8 }}>
                  {predicted.map((p, i) => {
                    const ref = candles[candles.length - 1]?.close;
                    const diff = ref ? +(p.close - ref).toFixed(2) : 0;
                    return (
                      <div key={i} style={{ background: T.surface, borderRadius: 8, padding: "10px 12px", border: `1px solid ${T.border}` }}>
                        <div style={{ fontSize: 9, color: T.muted, marginBottom: 4 }}>{p.date?.slice(5) || `+${i+1}日`}</div>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{fmt(p.close)}</div>
                        <div style={{ fontSize: 10, color: pctColor(diff), marginTop: 2 }}>
                          {diff >= 0 ? "+" : ""}{diff}
                        </div>
                        <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                          H <span style={{ color: T.buy }}>{fmt(p.high)}</span> L <span style={{ color: T.sell }}>{fmt(p.low)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* INSTITUTIONAL TAB */}
        {tab === "inst" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "14px 8px" }}>
              <div style={{ fontSize: 10, color: T.muted, paddingLeft: 8, marginBottom: 6 }}>
                三大法人買賣超（張）· 近期交易日 · 資料來源 台灣證交所
              </div>
              {instLoading
                ? <div style={{ height: 160, display: "grid", placeItems: "center", color: T.muted }}>⏳ 載入中…</div>
                : <InstBarChart data={instData} />
              }
            </div>

            {/* Table */}
            <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {["日期", "外資買賣超", "投信買賣超", "自營買賣超", "三大合計"].map((h, i) => (
                      <th key={i} style={{ padding: "10px 14px", textAlign: i === 0 ? "left" : "right",
                        color: T.muted, fontWeight: 600, fontSize: 11 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {instLoading
                    ? <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: T.muted }}>⏳ 載入中…</td></tr>
                    : instData.length === 0
                    ? <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: T.muted }}>暫無資料（市場休市或資料延遲）</td></tr>
                    : [...instData].reverse().map((d, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${T.border}30`,
                        background: i % 2 === 0 ? "transparent" : T.surface + "80" }}>
                        <td style={{ padding: "9px 14px", color: T.muted }}>{d.date}</td>
                        {[d.foreign, d.trust, d.dealer, d.total].map((v, j) => (
                          <td key={j} style={{ padding: "9px 14px", textAlign: "right",
                            fontWeight: j === 3 ? 700 : 400, color: instColor(v) }}>
                            {v > 0 ? "+" : ""}{v?.toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>

            {/* Summary cards */}
            {instData.length > 0 && (() => {
              const totF = instData.reduce((s, d) => s + d.foreign, 0);
              const totT = instData.reduce((s, d) => s + d.trust, 0);
              const totD = instData.reduce((s, d) => s + d.dealer, 0);
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                  {[["外資", totF, T.accent], ["投信", totT, T.yellow], ["自營", totD, T.purple]].map(([l, v, c]) => (
                    <div key={l} style={{ background: T.card, borderRadius: 10,
                      border: `1px solid ${v > 0 ? c + "40" : T.border}`, padding: "14px 18px" }}>
                      <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>{l} 近期累計</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: instColor(v) }}>
                        {v > 0 ? "+" : ""}{v?.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>張</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* KEY DATES TAB */}
        {tab === "dates" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>
              20日高低點突破／跌破偵測，可作為籌碼進出的重要參考訊號
            </div>
            {keyDates.length === 0 && !loading && (
              <div style={{ color: T.muted, padding: 20 }}>近期無明顯突破訊號</div>
            )}
            {keyDates.map((k, i) => (
              <div key={i} style={{ background: T.card, borderRadius: 12,
                border: `1px solid ${k.type === "突破" ? T.buy + "44" : T.sell + "44"}`,
                padding: "16px 20px", display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ fontSize: 24 }}>{k.type === "突破" ? "🔓" : "🔒"}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15,
                    color: k.type === "突破" ? T.buy : T.sell }}>{k.type}</div>
                  <div style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>{k.desc}</div>
                </div>
                <div style={{ color: T.muted, fontSize: 12 }}>{k.date}</div>
                <div style={{ marginLeft: "auto", fontWeight: 800, fontSize: 20 }}>{fmt(k.price)}</div>
              </div>
            ))}
          </div>
        )}

        {/* AI TAB */}
        {tab === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {aiLoading && (
              <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`,
                padding: 30, textAlign: "center", color: T.muted }}>⏳ AI 分析中，請稍候…</div>
            )}
            {aiData && (
              <>
                <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "16px 20px" }}>
                  <div style={{ color: T.accent, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>📊 基本面 & 籌碼摘要</div>
                  <p style={{ margin: 0, lineHeight: 1.8 }}>{aiData.summary}</p>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "16px 20px" }}>
                    <div style={{ color: T.buy, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>🏦 法人共識</div>
                    <p style={{ margin: 0, lineHeight: 1.8 }}>{aiData.consensus}</p>
                  </div>
                  <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.sell}33`, padding: "16px 20px" }}>
                    <div style={{ color: T.sell, fontSize: 11, fontWeight: 700, marginBottom: 8 }}>⚠️ 主要風險</div>
                    <p style={{ margin: 0, lineHeight: 1.8 }}>{aiData.risk}</p>
                  </div>
                </div>
                {aiData.news?.length > 0 && (
                  <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: "16px 20px" }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.muted, marginBottom: 10 }}>📰 近期相關新聞（AI生成）</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {aiData.news.map((n, i) => {
                        const sc = n.sentiment === "正面" ? T.buy : n.sentiment === "負面" ? T.sell : T.yellow;
                        return (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                            padding: "10px 14px", background: T.surface, borderRadius: 8, border: `1px solid ${T.border}` }}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{n.title}</div>
                              <div style={{ color: T.muted, fontSize: 10, marginTop: 3 }}>{n.date}</div>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                              background: sc + "22", color: sc }}>{n.sentiment}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
