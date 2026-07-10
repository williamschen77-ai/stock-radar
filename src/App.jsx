import { useState, useEffect, useMemo } from "react";

// ─── Design tokens ────────────────────────────────────────────
const T = {
  bg:        "#0b0f14",
  surface:   "#111720",
  card:      "#161d28",
  border:    "#1e2c3a",
  borderLit: "#2a3f55",
  // Accent: cool steel-blue, not the generic acid-green
  accent:    "#3d9bd4",
  accentDim: "#3d9bd418",
  buy:       "#34d399",
  buyDim:    "#34d39918",
  sell:      "#f87171",
  sellDim:   "#f8717118",
  hold:      "#94a3b8",
  yellow:    "#fbbf24",
  text:      "#dce6f0",
  muted:     "#607a94",
  dim:       "#2a3a4a",
  // Unique signature: ETF color map (steel hues, not rainbow)
  etfColors: ["#3d9bd4","#5bc4b8","#9b8fd4","#d49b3d","#d45b7a","#7ad45b","#d47a3d","#5b7ad4"],
};

// ─── Mock data ────────────────────────────────────────────────
const ETF_LIST = [
  { code:"00981A", name:"統一台股增長", mgr:"統一投信" },
  { code:"00982A", name:"群益台灣強棒", mgr:"群益投信" },
  { code:"00990A", name:"元大AI新經濟", mgr:"元大投信" },
  { code:"00991A", name:"復華未來50",   mgr:"復華投信" },
  { code:"00992A", name:"群益科技創新", mgr:"群益投信" },
  { code:"00988A", name:"統一全球創新", mgr:"統一投信" },
  { code:"00980A", name:"野村臺灣優選", mgr:"野村投信" },
  { code:"00400A", name:"國泰動能高息", mgr:"國泰投信" },
];

const STOCK_DB = {
  "2330": { name:"台積電", sector:"半導體", cap:"21兆", pe:"24.1", pb:"7.8", basePrice:920 },
  "2454": { name:"聯發科", sector:"半導體", cap:"2.1兆", pe:"18.3", pb:"4.2", basePrice:1240 },
  "2317": { name:"鴻海",   sector:"電子製造", cap:"1.2兆", pe:"12.1", pb:"1.8", basePrice:178 },
  "2308": { name:"台達電", sector:"電源零組件", cap:"0.8兆", pe:"22.5", pb:"5.1", basePrice:310 },
  "2412": { name:"中華電", sector:"電信",   cap:"0.6兆", pe:"19.2", pb:"2.3", basePrice:125 },
  "2382": { name:"廣達",   sector:"伺服器",  cap:"0.9兆", pe:"16.8", pb:"4.6", basePrice:280 },
  "2303": { name:"聯電",   sector:"晶圓代工", cap:"0.5兆", pe:"14.2", pb:"2.1", basePrice:48 },
};

function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

function buildCandleData(basePrice, days = 90, seed = 42) {
  const rand = rng(seed);
  const candles = [];
  let price = basePrice;
  const start = new Date("2026-04-01");
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const chg = (rand() - 0.47) * price * 0.022;
    const open = price;
    const close = +(price + chg).toFixed(1);
    const high  = +(Math.max(open, close) + rand() * price * 0.008).toFixed(1);
    const low   = +(Math.min(open, close) - rand() * price * 0.008).toFixed(1);
    const vol   = Math.floor(rand() * 60000 + 10000);
    candles.push({ date: d.toISOString().slice(0,10), open, high, low, close, vol });
    price = close;
  }
  return candles;
}

function buildEtfHoldings(stockCode, candles) {
  // Decide which ETFs hold this stock (4-7 of them)
  const rand = rng(stockCode.split("").reduce((a,c)=>a+c.charCodeAt(0),0));
  const holders = ETF_LIST.filter(() => rand() > 0.25);
  return holders.map((etf, ei) => {
    const r = rng(ei * 7 + stockCode.charCodeAt(0));
    // Weight history: simulate 30-day weight trend
    let weight = +(r() * 6 + 1).toFixed(2);
    const weightHistory = candles.slice(-30).map((c, i) => {
      weight = Math.max(0.1, +(weight + (r() - 0.49) * 0.3).toFixed(2));
      return { date: c.date, weight };
    });
    // Generate 3-6 entry/exit events on the K-line
    const events = [];
    const eventCount = Math.floor(r() * 4) + 2;
    const used = new Set();
    for (let i = 0; i < eventCount; i++) {
      let idx;
      do { idx = Math.floor(r() * (candles.length - 5)) + 2; } while (used.has(idx));
      used.add(idx);
      const type = r() > 0.45 ? "buy" : "sell";
      events.push({ date: candles[idx].date, type, price: candles[idx].close, shares: Math.floor(r() * 5000 + 500) });
    }
    events.sort((a,b) => a.date.localeCompare(b.date));
    const currentWeight = weightHistory[weightHistory.length - 1]?.weight ?? weight;
    const prevWeight = weightHistory[weightHistory.length - 8]?.weight ?? weight;
    const delta7d = +(currentWeight - prevWeight).toFixed(2);
    return { ...etf, weightHistory, currentWeight, delta7d, events, color: T.etfColors[ei % T.etfColors.length] };
  });
}

function buildPrediction(candles) {
  const last = candles[candles.length - 1];
  const dates = ["2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-07"];
  let p = last.close;
  return dates.map(date => {
    p = +(p * (1 + (Math.random() - 0.48) * 0.015)).toFixed(1);
    return { date, close: p, high: +(p * 1.008).toFixed(1), low: +(p * 0.992).toFixed(1) };
  });
}

// ─── Tiny sparkline SVG ───────────────────────────────────────
function Spark({ data, color = T.accent, w = 80, h = 28 }) {
  if (!data?.length) return null;
  const vals = data.map(d => d.weight ?? d);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) =>
    `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`
  ).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Candlestick chart with ETF event markers ─────────────────
function CandleChart({ candles, etfHoldings, predicted = [], width = 760, height = 300 }) {
  const all = [...candles, ...predicted];
  const prices = all.flatMap(c => [c.high, c.low]);
  const minP = Math.min(...prices) * 0.998;
  const maxP = Math.max(...prices) * 1.002;
  const pad = { l: 58, r: 14, t: 18, b: 28 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const n = all.length;
  const cw = Math.max(2, Math.floor(W / n) - 1);
  const toX = i => pad.l + (i / n) * W + cw / 2;
  const toY = p => pad.t + H - ((p - minP) / (maxP - minP)) * H;

  // Collect all ETF events indexed by date
  const evtMap = {};
  etfHoldings.forEach(etf => {
    etf.events.forEach(ev => {
      if (!evtMap[ev.date]) evtMap[ev.date] = [];
      evtMap[ev.date].push({ ...ev, color: etf.color, etfCode: etf.code });
    });
  });

  const yTicks = 5;
  const yStep = (maxP - minP) / (yTicks - 1);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display:"block" }}>
      {/* Grid lines */}
      {Array.from({ length: yTicks }).map((_, i) => {
        const val = minP + i * yStep;
        const y = toY(val);
        return (
          <g key={i}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke={T.border} strokeWidth="0.5" />
            <text x={pad.l - 5} y={y + 4} textAnchor="end" fill={T.muted} fontSize="9">{val.toFixed(0)}</text>
          </g>
        );
      })}
      {/* Candles */}
      {candles.map((c, i) => {
        const x = toX(i);
        const isUp = c.close >= c.open;
        const col = isUp ? T.buy : T.sell;
        const top = toY(Math.max(c.open, c.close));
        const bot = toY(Math.min(c.open, c.close));
        const bh = Math.max(1, bot - top);
        const evts = evtMap[c.date] || [];
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={col} strokeWidth="1" opacity="0.7" />
            <rect x={x - cw / 2} y={top} width={cw} height={bh} fill={col} opacity="0.82" />
            {/* ETF buy/sell markers */}
            {evts.map((ev, ei) => {
              const markerY = ev.type === "buy" ? toY(c.low) + 6 + ei * 7 : toY(c.high) - 6 - ei * 7;
              return (
                <g key={ei}>
                  <circle cx={x} cy={markerY} r={3.5} fill={ev.color} opacity="0.9" />
                </g>
              );
            })}
          </g>
        );
      })}
      {/* Predicted */}
      {predicted.length > 0 && (() => {
        const si = candles.length;
        const pts = predicted.map((c, i) => `${toX(si + i)},${toY(c.close)}`).join(" ");
        return (
          <g>
            <rect x={toX(si) - cw} y={pad.t} width={width - pad.r - toX(si) + cw} height={H}
              fill={T.yellow} opacity="0.03" />
            <polyline points={pts} fill="none" stroke={T.yellow} strokeWidth="1.5" strokeDasharray="5,3" />
            {predicted.map((c, i) => (
              <rect key={i} x={toX(si + i) - cw / 2} y={toY(c.high)} width={cw}
                height={Math.max(1, toY(c.low) - toY(c.high))} fill={T.yellow} opacity="0.12" />
            ))}
          </g>
        );
      })()}
      {/* X-axis dates */}
      {[0, Math.floor(n * 0.2), Math.floor(n * 0.4), Math.floor(n * 0.6), Math.floor(n * 0.8), n - 1].map(i => {
        const c = all[i];
        if (!c) return null;
        return <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" fill={T.muted} fontSize="8">{c.date.slice(5)}</text>;
      })}
    </svg>
  );
}

// ─── Weight trend chart ───────────────────────────────────────
function WeightChart({ etfHoldings, width = 760, height = 130 }) {
  const allWeights = etfHoldings.flatMap(e => e.weightHistory.map(w => w.weight));
  const maxW = Math.max(...allWeights, 1);
  const n = etfHoldings[0]?.weightHistory.length ?? 30;
  const pad = { l: 42, r: 14, t: 12, b: 28 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const toX = i => pad.l + (i / (n - 1)) * W;
  const toY = v => pad.t + H - (v / maxW) * H;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display:"block" }}>
      {[0, maxW / 2, maxW].map((v, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={toY(v)} y2={toY(v)} stroke={T.border} strokeWidth="0.5" />
          <text x={pad.l - 4} y={toY(v) + 4} textAnchor="end" fill={T.muted} fontSize="8">{v.toFixed(1)}%</text>
        </g>
      ))}
      {etfHoldings.map(etf => {
        const pts = etf.weightHistory.map((w, i) => `${toX(i)},${toY(w.weight)}`).join(" ");
        return (
          <polyline key={etf.code} points={pts} fill="none" stroke={etf.color} strokeWidth="1.5"
            strokeLinejoin="round" opacity="0.85" />
        );
      })}
      {/* X-axis */}
      {[0, Math.floor(n * 0.5), n - 1].map(i => {
        const d = etfHoldings[0]?.weightHistory[i]?.date;
        if (!d) return null;
        return <text key={i} x={toX(i)} y={height - 4} textAnchor="middle" fill={T.muted} fontSize="8">{d.slice(5)}</text>;
      })}
    </svg>
  );
}

// ─── AI fetch helpers ─────────────────────────────────────────
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
  const txt = d.content?.map(b => b.text || "").join("") || "[]";
  return JSON.parse(txt.replace(/```json|```/g, "").trim());
}

async function fetchAIInsight(stock, etfHoldings) {
  const holderNames = etfHoldings.map(e => `${e.name}（持倉${e.currentWeight}%，7日${e.delta7d >= 0 ? "+" : ""}${e.delta7d}%）`).join("、");
  return aiJSON(`
你是台股研究分析師。請針對「${stock.name}（${stock.code}）」生成以下JSON，只回傳JSON不要任何其他文字：
{
  "summary": "2句話概述該股近期基本面與籌碼面狀況",
  "etfConsensus": "1句話說明目前主動ETF共識（持有ETF：${holderNames}）",
  "risk": "1句話說明主要風險",
  "news": [
    {"title":"標題","date":"2026-06-XX","sentiment":"正面|中性|負面"},
    {"title":"標題","date":"2026-06-XX","sentiment":"正面|中性|負面"},
    {"title":"標題","date":"2026-06-XX","sentiment":"正面|中性|負面"}
  ]
}`);
}

async function fetchAIPrediction(stock, candles) {
  const recent = candles.slice(-8).map(c => `${c.date} C:${c.close}`).join(" | ");
  return aiJSON(`根據${stock.name}近期走勢（${recent}），預測未來5個交易日的收盤價。
只回傳JSON陣列，不要其他文字：
[{"date":"2026-07-01","close":數字,"high":數字,"low":數字},{"date":"2026-07-02","close":數字,"high":數字,"low":數字},{"date":"2026-07-03","close":數字,"high":數字,"low":數字},{"date":"2026-07-04","close":數字,"high":數字,"low":數字},{"date":"2026-07-07","close":數字,"high":數字,"low":數字}]`);
}

// ─── Consensus meter ──────────────────────────────────────────
function ConsensusMeter({ etfHoldings }) {
  const buyers = etfHoldings.filter(e => e.delta7d > 0.1).length;
  const sellers = etfHoldings.filter(e => e.delta7d < -0.1).length;
  const total = etfHoldings.length;
  const score = total ? Math.round((buyers / total) * 100) : 50;
  const col = score >= 60 ? T.buy : score <= 40 ? T.sell : T.yellow;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:T.muted }}>
        <span>法人共識</span>
        <span style={{ color:col, fontWeight:700 }}>{score >= 60 ? "偏多" : score <= 40 ? "偏空" : "分歧"}</span>
      </div>
      <div style={{ height:6, background:T.dim, borderRadius:3, overflow:"hidden" }}>
        <div style={{ width:`${score}%`, height:"100%", background:col, borderRadius:3, transition:"width 0.6s" }} />
      </div>
      <div style={{ display:"flex", gap:12, fontSize:10, color:T.muted }}>
        <span style={{ color:T.buy }}>▲ 加碼 {buyers}檔</span>
        <span style={{ color:T.sell }}>▼ 減碼 {sellers}檔</span>
        <span>持平 {total - buyers - sellers}檔</span>
      </div>
    </div>
  );
}

// ─── Breakout detector ────────────────────────────────────────
function findKeyDates(candles) {
  const out = [];
  for (let i = 20; i < candles.length; i++) {
    const win = candles.slice(i - 20, i);
    const maxH = Math.max(...win.map(c => c.high));
    const minL = Math.min(...win.map(c => c.low));
    const c = candles[i];
    if (c.close >= maxH * 0.999) out.push({ date: c.date, type:"突破", price: c.close });
    if (c.close <= minL * 1.001) out.push({ date: c.date, type:"跌破", price: c.close });
  }
  return out.slice(-5).reverse();
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [query, setQuery] = useState("");
  const [stockCode, setStockCode] = useState("2330");
  const [tab, setTab] = useState("overview");
  const [aiInsight, setAiInsight] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [predicted, setPredicted] = useState([]);
  const [predLoading, setPredLoading] = useState(false);

  const stock = STOCK_DB[stockCode] || { name: stockCode, sector:"其他", cap:"—", pe:"—", pb:"—", basePrice: 100 };
  const candles = useMemo(() => buildCandleData(stock.basePrice, 90, stockCode.charCodeAt(0) * 3), [stockCode]);
  const etfHoldings = useMemo(() => buildEtfHoldings(stockCode, candles), [stockCode, candles]);
  const keyDates = useMemo(() => findKeyDates(candles), [candles]);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const chg = +(last.close - prev.close).toFixed(1);
  const chgPct = +((chg / prev.close) * 100).toFixed(2);

  function search() {
    const c = query.trim().toUpperCase();
    if (!c) return;
    setStockCode(c);
    setQuery("");
    setAiInsight(null);
    setPredicted([]);
    setTab("overview");
  }

  useEffect(() => {
    setAiInsight(null);
    setPredicted([]);
    setAiLoading(true);
    fetchAIInsight(stock, etfHoldings)
      .then(setAiInsight)
      .catch(() => setAiInsight({ summary:"AI分析暫時無法載入", etfConsensus:"", risk:"", news:[] }))
      .finally(() => setAiLoading(false));

    setPredLoading(true);
    fetchAIPrediction(stock, candles)
      .then(setPredicted)
      .catch(() => setPredicted(buildPrediction(candles)))
      .finally(() => setPredLoading(false));
  }, [stockCode]);

  const fmt = (n, d=1) => n?.toLocaleString?.("zh-TW", { minimumFractionDigits:d, maximumFractionDigits:d }) ?? n;
  const sentCol = s => s === "正面" ? T.buy : s === "負面" ? T.sell : T.yellow;

  const TABS = [
    { id:"overview", label:"持股概覽" },
    { id:"kline",    label:"K線＋進出場" },
    { id:"weight",   label:"持倉比例趨勢" },
    { id:"events",   label:"進出場記錄" },
    { id:"dates",    label:"關鍵突破" },
    { id:"ai",       label:"AI 分析" },
  ];

  return (
    <div style={{ background:T.bg, minHeight:"100vh", color:T.text,
      fontFamily:"'SF Pro Text','PingFang TC','Helvetica Neue',system-ui,sans-serif", fontSize:13 }}>

      {/* ── Top bar ── */}
      <header style={{ borderBottom:`1px solid ${T.border}`, padding:"0 24px",
        display:"flex", alignItems:"center", gap:20, height:54, position:"sticky", top:0, background:T.bg, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="10" fill={T.accentDim} stroke={T.accent} strokeWidth="1.2" />
            <text x="11" y="15" textAnchor="middle" fill={T.accent} fontSize="10" fontWeight="700">個</text>
          </svg>
          <span style={{ fontWeight:800, fontSize:15, letterSpacing:"0.01em" }}>個股透視</span>
          <span style={{ color:T.muted, fontSize:11, borderLeft:`1px solid ${T.border}`, paddingLeft:12 }}>
            以個股視角追蹤主動ETF籌碼動向
          </span>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:8, alignItems:"center" }}>
          {/* Quick-access stocks */}
          {Object.keys(STOCK_DB).slice(0, 4).map(c => (
            <button key={c} onClick={() => { setStockCode(c); setTab("overview"); setAiInsight(null); setPredicted([]); }}
              style={{ background: c === stockCode ? T.accentDim : "none",
                border:`1px solid ${c === stockCode ? T.accent : T.border}`,
                color: c === stockCode ? T.accent : T.muted,
                borderRadius:6, padding:"4px 10px", cursor:"pointer", fontSize:11, fontWeight: c === stockCode ? 700 : 400 }}>
              {c}
            </button>
          ))}
          <div style={{ display:"flex", gap:0, alignItems:"center", background:T.card,
            border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden" }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key==="Enter" && search()}
              placeholder="輸入股票代號…" style={{ background:"none", border:"none", outline:"none",
                color:T.text, fontSize:12, padding:"7px 12px", width:150 }} />
            <button onClick={search}
              style={{ background:T.accent, border:"none", color:"#fff", padding:"7px 14px",
                cursor:"pointer", fontWeight:700, fontSize:12 }}>查詢</button>
          </div>
        </div>
      </header>

      {/* ── Stock hero ── */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:"16px 24px",
        display:"flex", alignItems:"flex-start", gap:32, background:T.surface }}>
        <div>
          <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
            <span style={{ fontSize:26, fontWeight:900 }}>{stock.name}</span>
            <span style={{ color:T.muted, fontSize:13 }}>{stockCode}</span>
            <span style={{ background:T.accentDim, color:T.accent, fontSize:10, fontWeight:700,
              padding:"2px 8px", borderRadius:20 }}>{stock.sector}</span>
          </div>
          <div style={{ display:"flex", gap:24, marginTop:6, fontSize:12, color:T.muted }}>
            <span>市值 <b style={{ color:T.text }}>{stock.cap}</b></span>
            <span>本益比 <b style={{ color:T.text }}>{stock.pe}</b></span>
            <span>股價淨值比 <b style={{ color:T.text }}>{stock.pb}</b></span>
            <span>主動ETF持有 <b style={{ color:T.accent }}>{etfHoldings.length} 檔</b></span>
          </div>
        </div>
        <div style={{ marginLeft:"auto", textAlign:"right" }}>
          <div style={{ fontSize:32, fontWeight:900, letterSpacing:"-0.02em" }}>{fmt(last.close)}</div>
          <div style={{ color: chg >= 0 ? T.buy : T.sell, fontWeight:700, fontSize:14 }}>
            {chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(1)} ({chg >= 0 ? "+" : ""}{chgPct}%)
          </div>
        </div>
        <div style={{ minWidth:220, background:T.card, borderRadius:10, padding:"12px 16px", border:`1px solid ${T.border}` }}>
          <ConsensusMeter etfHoldings={etfHoldings} />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:"0 24px",
        display:"flex", gap:0, background:T.surface }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ background:"none", border:"none", borderBottom:`2px solid ${tab === t.id ? T.accent : "transparent"}`,
              color: tab === t.id ? T.accent : T.muted, padding:"11px 18px",
              cursor:"pointer", fontSize:12, fontWeight: tab === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <main style={{ padding:"20px 24px", maxWidth:1100 }}>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>
              以下 <b style={{ color:T.accent }}>{etfHoldings.length} 檔</b> 主動ETF目前持有 {stock.name}，點列可查看進出場軌跡
            </div>
            {etfHoldings.map((etf, i) => (
              <div key={etf.code} onClick={() => setTab("events")}
                style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`,
                  padding:"14px 18px", display:"grid",
                  gridTemplateColumns:"180px 90px 90px 1fr 80px", alignItems:"center", gap:16,
                  cursor:"pointer", transition:"border-color 0.2s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = etf.color}
                onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:3, height:28, background:etf.color, borderRadius:2 }} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:12 }}>{etf.name}</div>
                      <div style={{ color:T.muted, fontSize:10 }}>{etf.code} · {etf.mgr}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div style={{ color:T.muted, fontSize:10, marginBottom:2 }}>持倉比重</div>
                  <div style={{ fontWeight:800, fontSize:16, color:etf.color }}>{etf.currentWeight}%</div>
                </div>
                <div>
                  <div style={{ color:T.muted, fontSize:10, marginBottom:2 }}>7日變化</div>
                  <div style={{ fontWeight:700, fontSize:14,
                    color: etf.delta7d > 0.1 ? T.buy : etf.delta7d < -0.1 ? T.sell : T.muted }}>
                    {etf.delta7d > 0 ? "+" : ""}{etf.delta7d}%
                  </div>
                </div>
                <div>
                  <div style={{ color:T.muted, fontSize:10, marginBottom:4 }}>近30日比重趨勢</div>
                  <Spark data={etf.weightHistory} color={etf.color} w={160} h={28} />
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ color:T.muted, fontSize:10, marginBottom:2 }}>進出場次</div>
                  <div style={{ fontWeight:700 }}>{etf.events.length} 次</div>
                  <div style={{ fontSize:10, color:T.muted }}>
                    買{etf.events.filter(e=>e.type==="buy").length}/賣{etf.events.filter(e=>e.type==="sell").length}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* K-LINE */}
        {tab === "kline" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"12px 8px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:16, paddingLeft:8, marginBottom:6 }}>
                <span style={{ fontSize:11, color:T.muted }}>日K線 · 近90日</span>
                {predLoading
                  ? <span style={{ fontSize:10, color:T.yellow }}>⏳ AI預測中…</span>
                  : predicted.length > 0 && <span style={{ fontSize:10, color:T.yellow }}>● AI預測5日（黃色虛線）</span>
                }
                <div style={{ marginLeft:"auto", display:"flex", gap:10, paddingRight:8 }}>
                  {etfHoldings.slice(0,4).map(etf => (
                    <div key={etf.code} style={{ display:"flex", alignItems:"center", gap:4 }}>
                      <div style={{ width:8, height:8, borderRadius:"50%", background:etf.color }} />
                      <span style={{ fontSize:9, color:T.muted }}>{etf.name.slice(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <CandleChart candles={candles} etfHoldings={etfHoldings} predicted={predicted} />
            </div>
            <div style={{ fontSize:10, color:T.muted, paddingLeft:4 }}>
              圖表上的彩色圓點代表各ETF的買入（蠟燭下方）或賣出（蠟燭上方）操作時間點
            </div>
            {predicted.length > 0 && (
              <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.yellow}33`, padding:"14px 18px" }}>
                <div style={{ color:T.yellow, fontWeight:700, fontSize:11, marginBottom:10 }}>
                  🤖 AI預測未來5日（僅供參考，非投資建議）
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", gap:8 }}>
                  {predicted.map((p, i) => (
                    <div key={i} style={{ background:T.surface, borderRadius:8, padding:"10px 12px", border:`1px solid ${T.border}` }}>
                      <div style={{ fontSize:9, color:T.muted, marginBottom:4 }}>{p.date?.slice(5) || `+${i+1}日`}</div>
                      <div style={{ fontWeight:800, fontSize:15 }}>{fmt(p.close)}</div>
                      <div style={{ fontSize:10, color:T.muted, marginTop:2 }}>
                        H <span style={{ color:T.buy }}>{fmt(p.high)}</span> &nbsp;
                        L <span style={{ color:T.sell }}>{fmt(p.low)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* WEIGHT TREND */}
        {tab === "weight" && (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"14px 8px" }}>
              <div style={{ paddingLeft:8, marginBottom:6, fontSize:11, color:T.muted }}>各ETF持倉比重趨勢 · 近30日（%）</div>
              <WeightChart etfHoldings={etfHoldings} />
            </div>
            {/* Legend */}
            <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
              {etfHoldings.map(etf => (
                <div key={etf.code} style={{ display:"flex", alignItems:"center", gap:8,
                  background:T.card, borderRadius:8, padding:"8px 12px", border:`1px solid ${T.border}` }}>
                  <div style={{ width:20, height:2, background:etf.color, borderRadius:1 }} />
                  <span style={{ fontSize:11 }}>{etf.name}</span>
                  <span style={{ fontSize:11, color: etf.delta7d > 0.1 ? T.buy : etf.delta7d < -0.1 ? T.sell : T.muted, fontWeight:700 }}>
                    {etf.delta7d > 0 ? "+" : ""}{etf.delta7d}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* EVENTS */}
        {tab === "events" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>各ETF對 {stock.name} 的進出場操作記錄（模擬資料）</div>
            {etfHoldings.map(etf => (
              <div key={etf.code} style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"14px 16px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
                  <div style={{ width:3, height:20, background:etf.color, borderRadius:2 }} />
                  <span style={{ fontWeight:700 }}>{etf.name}</span>
                  <span style={{ color:T.muted, fontSize:11 }}>{etf.code}</span>
                  <span style={{ marginLeft:"auto", color:T.muted, fontSize:11 }}>
                    持倉 <b style={{ color:etf.color }}>{etf.currentWeight}%</b>
                  </span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {etf.events.map((ev, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:12,
                      background: ev.type==="buy" ? T.buyDim : T.sellDim,
                      borderLeft:`3px solid ${ev.type==="buy" ? T.buy : T.sell}`,
                      borderRadius:"0 8px 8px 0", padding:"8px 12px" }}>
                      <span style={{ fontSize:13 }}>{ev.type==="buy" ? "▲" : "▼"}</span>
                      <span style={{ color: ev.type==="buy" ? T.buy : T.sell, fontWeight:700, fontSize:11 }}>
                        {ev.type==="buy" ? "買入" : "賣出"}
                      </span>
                      <span style={{ color:T.muted, fontSize:11 }}>{ev.date}</span>
                      <span style={{ fontWeight:700 }}>@ {fmt(ev.price)}</span>
                      <span style={{ color:T.muted, fontSize:11, marginLeft:"auto" }}>
                        {ev.shares.toLocaleString()} 張
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* KEY DATES */}
        {tab === "dates" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:11, color:T.muted, marginBottom:4 }}>20日高低點突破／跌破訊號</div>
            {keyDates.length === 0 && <div style={{ color:T.muted }}>近期無明顯訊號</div>}
            {keyDates.map((k, i) => (
              <div key={i} style={{
                background:T.card, borderRadius:12,
                border:`1px solid ${k.type==="突破" ? T.buy + "55" : T.sell + "55"}`,
                padding:"14px 20px", display:"flex", alignItems:"center", gap:16 }}>
                <span style={{ fontSize:22 }}>{k.type==="突破" ? "🔓" : "🔒"}</span>
                <div>
                  <div style={{ fontWeight:800, fontSize:14,
                    color: k.type==="突破" ? T.buy : T.sell }}>{k.type} 20日{k.type==="突破" ? "高點" : "低點"}</div>
                  <div style={{ color:T.muted, fontSize:11, marginTop:2 }}>{k.date}</div>
                </div>
                <div style={{ marginLeft:"auto" }}>
                  <div style={{ fontWeight:800, fontSize:18 }}>{fmt(k.price)}</div>
                </div>
                <div style={{ width:160, background:T.surface, borderRadius:8, padding:"8px 12px", fontSize:11, color:T.muted }}>
                  {k.type==="突破" ? `突破後，${etfHoldings.filter(e=>e.delta7d>0).length} 檔ETF在此附近加碼` : `跌破後，${etfHoldings.filter(e=>e.delta7d<0).length} 檔ETF有減碼跡象`}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI */}
        {tab === "ai" && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {aiLoading && (
              <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`,
                padding:24, textAlign:"center", color:T.muted }}>
                ⏳ AI 分析中，請稍候…
              </div>
            )}
            {aiInsight && (
              <>
                <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"16px 20px" }}>
                  <div style={{ color:T.accent, fontSize:11, fontWeight:700, marginBottom:8 }}>📊 基本面 & 籌碼面摘要</div>
                  <p style={{ margin:0, lineHeight:1.7, color:T.text }}>{aiInsight.summary}</p>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                  <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"16px 20px" }}>
                    <div style={{ color:T.buy, fontSize:11, fontWeight:700, marginBottom:8 }}>🏦 ETF法人共識</div>
                    <p style={{ margin:0, lineHeight:1.7, color:T.text }}>{aiInsight.etfConsensus}</p>
                  </div>
                  <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.sell}33`, padding:"16px 20px" }}>
                    <div style={{ color:T.sell, fontSize:11, fontWeight:700, marginBottom:8 }}>⚠️ 主要風險</div>
                    <p style={{ margin:0, lineHeight:1.7, color:T.text }}>{aiInsight.risk}</p>
                  </div>
                </div>
                {aiInsight.news?.length > 0 && (
                  <div style={{ background:T.card, borderRadius:12, border:`1px solid ${T.border}`, padding:"16px 20px" }}>
                    <div style={{ color:T.muted, fontSize:11, fontWeight:700, marginBottom:10 }}>📰 近期相關新聞</div>
                    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                      {aiInsight.news.map((n, i) => (
                        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center",
                          padding:"10px 14px", background:T.surface, borderRadius:8, border:`1px solid ${T.border}` }}>
                          <div>
                            <div style={{ fontWeight:600, fontSize:13 }}>{n.title}</div>
                            <div style={{ color:T.muted, fontSize:10, marginTop:3 }}>{n.date}</div>
                          </div>
                          <span style={{ fontSize:10, fontWeight:700, padding:"3px 10px", borderRadius:20,
                            background: sentCol(n.sentiment) + "22", color: sentCol(n.sentiment) }}>
                            {n.sentiment}
                          </span>
                        </div>
                      ))}
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
