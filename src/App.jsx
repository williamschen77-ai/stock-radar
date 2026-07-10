import { useState, useEffect, useMemo, useRef } from "react";
import { STOCK_MAP, searchStock, getStockName } from "./stockList.js";

const T = {
  bg:"#090e13",surface:"#0f1820",card:"#141f2c",border:"#1a2c3d",borderLit:"#2a4560",
  accent:"#38bdf8",accentDim:"#38bdf815",buy:"#22d3a0",buyDim:"#22d3a012",
  sell:"#fb7185",sellDim:"#fb718512",yellow:"#fbbf24",purple:"#a78bfa",
  orange:"#f97316",pink:"#f472b6",text:"#e2eaf2",muted:"#5a7a96",dim:"#1e3045",
  etfColors:["#38bdf8","#22d3a0","#a78bfa","#fbbf24","#f97316","#f472b6","#34d399","#60a5fa"],
  ma:{ma5:"#facc15",ma20:"#38bdf8",ma60:"#f97316",ma120:"#a78bfa",ma240:"#f472b6"}
};

// ── API helpers ────────────────────────────────────────────────
const apiFetch = async (url) => { const r = await fetch(url); if(!r.ok) throw new Error(r.status); return r.json(); };
const apiPost  = async (url, body) => {
  const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!r.ok) throw new Error(r.status); return r.json();
};

async function fetchAll(code, range) {
  return Promise.all([
    apiFetch(`/api/quote?symbol=${code}.TW&range=${range}&interval=1d`),
    apiFetch(`/api/institutional?code=${code}`).then(d=>d.data||[]).catch(()=>[]),
    apiFetch(`/api/etf-holdings?code=${code}`).then(d=>({data:d.data||[],source:d.source})).catch(()=>({data:[],source:'error'})),
    apiFetch(`/api/disposition?code=${code}`).catch(()=>({})),
    apiFetch(`/api/news?code=${code}&name=${encodeURIComponent(getStockName(code)||code)}`).then(d=>d.data||[]).catch(()=>[]),
  ]);
}

async function fetchAdvice(code,name,price,prev,candles,instData,etfData,disposition) {
  return apiPost('/api/advice',{code,name,price,prev,candles,instData,etfData,disposition});
}

async function fetchAIPrediction(name,candles) {
  const recent=candles.slice(-10).map(c=>`${c.date} C:${c.close}`).join("|");
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:800,
      messages:[{role:"user",content:`根據${name}近10日（${recent}），預測未來5交易日。只回傳JSON陣列：[{"date":"2026-07-08","close":0,"high":0,"low":0},{"date":"2026-07-09","close":0,"high":0,"low":0},{"date":"2026-07-10","close":0,"high":0,"low":0},{"date":"2026-07-11","close":0,"high":0,"low":0},{"date":"2026-07-14","close":0,"high":0,"low":0}]`}]})});
  const d=await r.json();
  const txt=d.content?.map(b=>b.text||"").join("")||"[]";
  return JSON.parse(txt.replace(/```json|```/g,"").trim());
}

// ── Utils ──────────────────────────────────────────────────────
function calcMA(candles,period){return candles.map((_,i)=>{if(i<period-1)return null;return +(candles.slice(i-period+1,i+1).reduce((s,c)=>s+c.close,0)/period).toFixed(2);});}
function findKeyDates(candles){const out=[];for(let i=20;i<candles.length;i++){const win=candles.slice(i-20,i);const maxH=Math.max(...win.map(c=>c.high)),minL=Math.min(...win.map(c=>c.low));const c=candles[i];if(c.close>=maxH*0.999)out.push({date:c.date,type:"突破",price:c.close,desc:"突破20日高點"});else if(c.close<=minL*1.001)out.push({date:c.date,type:"跌破",price:c.close,desc:"跌破20日低點"});}return out.slice(-6).reverse();}
const fmt=(n,d=2)=>(n==null||isNaN(n))?"—":n.toLocaleString("zh-TW",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtVol=v=>!v?"—":v>=1e8?(v/1e8).toFixed(1)+"億":v>=1e4?(v/1e4).toFixed(0)+"萬":v.toLocaleString();
const pctColor=v=>v>0?T.buy:v<0?T.sell:T.muted;
const pctStr=v=>(v>0?"+":"")+v?.toFixed(2)+"%";
const sentCol=s=>s==="正面"?T.buy:s==="負面"?T.sell:T.yellow;
const ratingColorMap={"強力買進":"#22d3a0","買進":"#86efac","觀望":"#fbbf24","偏空":"#fb923c","賣出":"#fb7185"};

// ── Charts ─────────────────────────────────────────────────────
function CandleChart({candles,predicted=[],maLines={},showMA={}}){
  const W=800,H=320,pad={l:62,r:16,t:16,b:28};
  const all=[...candles,...predicted];
  const prices=all.flatMap(c=>[c.high,c.low].filter(Boolean));
  const maVals=Object.entries(maLines).filter(([k])=>showMA[k]).flatMap(([,v])=>v).filter(v=>v!=null);
  const allP=[...prices,...maVals];if(!allP.length)return null;
  const minP=Math.min(...allP)*0.998,maxP=Math.max(...allP)*1.002;
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,n=all.length;
  const bw=Math.max(2,Math.floor(cW/n)-1);
  const toX=i=>pad.l+(i/n)*cW+bw/2,toY=p=>pad.t+cH-((p-minP)/(maxP-minP))*cH;
  const maConf=[{k:"ma5",c:T.ma.ma5},{k:"ma20",c:T.ma.ma20},{k:"ma60",c:T.ma.ma60},{k:"ma120",c:T.ma.ma120},{k:"ma240",c:T.ma.ma240}];
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    {Array.from({length:6}).map((_,i)=>{const val=minP+(i/5)*(maxP-minP),y=toY(val);return<g key={i}><line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={T.border} strokeWidth="0.5"/><text x={pad.l-5} y={y+4} textAnchor="end" fill={T.muted} fontSize="9">{val.toFixed(1)}</text></g>;})}
    {maConf.map(({k,c})=>{if(!showMA[k]||!maLines[k])return null;const pts=maLines[k].map((v,i)=>v!=null?`${toX(i)},${toY(v)}`:null).filter(Boolean);return pts.length>1?<polyline key={k} points={pts.join(" ")} fill="none" stroke={c} strokeWidth="1.2" opacity="0.85" strokeLinejoin="round"/>:null;})}
    {candles.map((c,i)=>{const x=toX(i),isUp=c.close>=c.open,col=isUp?T.buy:T.sell;const top=toY(Math.max(c.open,c.close)),bot=toY(Math.min(c.open,c.close));return<g key={i}><line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={col} strokeWidth="1" opacity="0.7"/><rect x={x-bw/2} y={top} width={bw} height={Math.max(1,bot-top)} fill={col} opacity="0.85"/></g>;})}
    {predicted.length>0&&(()=>{const si=candles.length;const pts=predicted.map((c,i)=>`${toX(si+i)},${toY(c.close)}`).join(" ");return<g><rect x={toX(si)-bw} y={pad.t} width={W-pad.r-toX(si)+bw} height={cH} fill={T.yellow} opacity="0.04"/><polyline points={pts} fill="none" stroke={T.yellow} strokeWidth="1.8" strokeDasharray="5,3"/>{predicted.map((c,i)=><rect key={i} x={toX(si+i)-bw/2} y={toY(c.high)} width={bw} height={Math.max(1,toY(c.low)-toY(c.high))} fill={T.yellow} opacity="0.15"/>)}<text x={toX(si)+2} y={pad.t+10} fill={T.yellow} fontSize="9">▶ AI預測</text></g>;})()}
    {[0,Math.floor(n*0.2),Math.floor(n*0.4),Math.floor(n*0.6),Math.floor(n*0.8),n-1].map(i=>{const c=all[i];if(!c)return null;return<text key={i} x={toX(i)} y={H-4} textAnchor="middle" fill={T.muted} fontSize="8">{c.date?.slice(5)}</text>;})}
  </svg>);
}

function VolumeChart({candles}){
  const W=800,H=72,pad={l:62,r:16,t:6,b:18};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,n=candles.length;
  const maxV=Math.max(...candles.map(c=>c.vol),1);
  const bw=Math.max(2,Math.floor(cW/n)-1),toX=i=>pad.l+(i/n)*cW+bw/2;
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <text x={pad.l-5} y={pad.t+8} textAnchor="end" fill={T.muted} fontSize="8">{fmtVol(maxV)}</text>
    {candles.map((c,i)=>{const bh=(c.vol/maxV)*cH;return<rect key={i} x={toX(i)-bw/2} y={pad.t+cH-bh} width={bw} height={bh} fill={c.close>=c.open?T.buy:T.sell} opacity="0.55"/>;})}</svg>);
}

function InstBarChart({data}){
  if(!data?.length)return<div style={{color:T.muted,padding:20,textAlign:"center"}}>暫無資料</div>;
  const W=800,H=140,pad={l:62,r:16,t:20,b:24};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
  const vals=data.flatMap(d=>[Math.abs(d.foreign),Math.abs(d.trust),Math.abs(d.dealer)]);
  const maxV=Math.max(...vals,1),n=data.length,bw=Math.max(3,Math.floor(cW/n/4));
  const toX=i=>pad.l+(i/n)*cW,zero=pad.t+cH/2,toY=v=>zero-(v/maxV)*(cH/2);
  const series=[{key:"foreign",color:T.accent,label:"外資"},{key:"trust",color:T.yellow,label:"投信"},{key:"dealer",color:T.purple,label:"自營"}];
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <line x1={pad.l} x2={W-pad.r} y1={zero} y2={zero} stroke={T.borderLit} strokeWidth="1"/>
    {data.map((d,i)=>series.map((s,j)=>{const val=d[s.key],y=val>=0?toY(val):zero,h=Math.max(1,Math.abs(toY(val)-zero));return<rect key={`${i}-${j}`} x={toX(i)+j*(bw+1)} y={y} width={bw} height={h} fill={s.color} opacity="0.8"/>; }))}
    {data.map((d,i)=><text key={i} x={toX(i)+bw*1.5} y={H-4} textAnchor="middle" fill={T.muted} fontSize="8">{d.date?.slice(5)}</text>)}
    {series.map((s,i)=><g key={i}><rect x={pad.l+i*52} y={4} width={8} height={8} fill={s.color} rx="1"/><text x={pad.l+i*52+11} y={12} fill={T.muted} fontSize="9">{s.label}</text></g>)}
  </svg>);
}

function Spark({data,color,w=160,h=28}){
  if(!data?.length)return null;
  const vals=data.map(d=>d.weight);
  const min=Math.min(...vals),max=Math.max(...vals),range=max-min||0.1;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*w},${h-((v-min)/range)*h}`).join(" ");
  return(<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.9"/></svg>);
}

function ConsensusMeter({etfData}){
  if(!etfData?.length)return null;
  const buyers=etfData.filter(e=>e.delta>0.05).length;
  const sellers=etfData.filter(e=>e.delta<-0.05).length;
  const score=Math.round((buyers/etfData.length)*100);
  const col=score>=60?T.buy:score<=40?T.sell:T.yellow;
  return(<div style={{minWidth:180,background:T.card,borderRadius:10,padding:"10px 14px",border:`1px solid ${T.border}`}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:5}}>
      <span style={{color:T.muted}}>ETF共識</span>
      <span style={{color:col,fontWeight:700}}>{score>=60?"偏多":score<=40?"偏空":"分歧"}</span>
    </div>
    <div style={{height:4,background:T.dim,borderRadius:2,overflow:"hidden",marginBottom:5}}>
      <div style={{width:`${score}%`,height:"100%",background:col,borderRadius:2,transition:"width 0.5s"}}/>
    </div>
    <div style={{display:"flex",gap:10,fontSize:9,color:T.muted}}>
      <span style={{color:T.buy}}>▲{buyers}</span><span style={{color:T.sell}}>▼{sellers}</span><span>持{etfData.length-buyers-sellers}</span>
    </div>
  </div>);
}

// ── Search box ─────────────────────────────────────────────────
function SearchBox({onSelect}){
  const [val,setVal]=useState("");
  const [results,setResults]=useState([]);
  const [open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{if(val.length<1){setResults([]);return;}setResults(searchStock(val));setOpen(true);},[val]);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  function submit(){const r=searchStock(val);if(r.length>0){onSelect(r[0].code);setVal("");setOpen(false);}else if(/^\d{4,6}$/.test(val.trim())){onSelect(val.trim());setVal("");setOpen(false);}}
  return(<div ref={ref} style={{position:"relative"}}>
    <div style={{display:"flex",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} onFocus={()=>val&&setOpen(true)}
        placeholder="股票代號或中文名稱…" style={{background:"none",border:"none",outline:"none",color:T.text,fontSize:12,padding:"7px 12px",width:180}}/>
      <button onClick={submit} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"7px 14px",cursor:"pointer",fontSize:12}}>查詢</button>
    </div>
    {open&&results.length>0&&(<div style={{position:"absolute",top:"100%",right:0,width:240,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,zIndex:50,marginTop:4,overflow:"hidden",boxShadow:"0 8px 24px #00000060"}}>
      {results.map(r=>(<div key={r.code} onMouseDown={()=>{onSelect(r.code);setVal("");setOpen(false);}}
        style={{padding:"9px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}30`,display:"flex",justifyContent:"space-between",alignItems:"center"}}
        onMouseEnter={e=>e.currentTarget.style.background=T.accentDim} onMouseLeave={e=>e.currentTarget.style.background="none"}>
        <div><span style={{fontWeight:700}}>{r.name}</span><span style={{color:T.muted,fontSize:11,marginLeft:6}}>{r.sector}</span></div>
        <span style={{color:T.muted,fontSize:11}}>{r.code}</span>
      </div>))}
    </div>)}
  </div>);
}

// ── Score gauge ────────────────────────────────────────────────
function ScoreGauge({score,rating,color}){
  const r=54,cx=70,cy=70,stroke=10;
  const circ=2*Math.PI*r;
  const arc=circ*0.75;
  const filled=arc*(score/100);
  const col=color||"#22d3a0";
  return(<svg width={140} height={100} viewBox="0 0 140 100">
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.dim} strokeWidth={stroke} strokeDasharray={`${arc} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round"/>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={stroke} strokeDasharray={`${filled} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round" style={{transition:"stroke-dasharray 0.8s"}}/>
    <text x={cx} y={cy-6} textAnchor="middle" fill={col} fontSize="22" fontWeight="900">{score}</text>
    <text x={cx} y={cy+12} textAnchor="middle" fill={col} fontSize="9" fontWeight="700">{rating}</text>
  </svg>);
}

const POPULAR=["2330","2454","2317","2382","0050","00878"];
const TABS=[{id:"kline",label:"K線圖"},{id:"advice",label:"買進建議"},{id:"news",label:"個股新聞"},{id:"etf",label:"ETF持倉"},{id:"inst",label:"三大法人"},{id:"lock",label:"關出關"},{id:"dates",label:"關鍵突破"}];
const MA_OPTIONS=[{key:"ma5",label:"MA5",color:T.ma.ma5},{key:"ma20",label:"MA20",color:T.ma.ma20},{key:"ma60",label:"季線",color:T.ma.ma60},{key:"ma120",label:"半年",color:T.ma.ma120},{key:"ma240",label:"年線",color:T.ma.ma240}];
const RANGE_OPTIONS=[{label:"1月",range:"1mo"},{label:"3月",range:"3mo"},{label:"6月",range:"6mo"},{label:"1年",range:"1y"},{label:"2年",range:"2y"}];

export default function App(){
  const [stockCode,setStockCode]=useState("2330");
  const [tab,setTab]=useState("kline");
  const [range,setRange]=useState("6mo");
  const [showMA,setShowMA]=useState({ma5:true,ma20:true,ma60:true,ma120:false,ma240:false});

  const [candles,setCandles]=useState([]);
  const [quote,setQuote]=useState(null);
  const [instData,setInstData]=useState([]);
  const [etfData,setEtfData]=useState([]);
  const [etfSource,setEtfSource]=useState("mock");
  const [disposition,setDisposition]=useState({});
  const [news,setNews]=useState([]);
  const [advice,setAdvice]=useState(null);
  const [predicted,setPredicted]=useState([]);

  const [loading,setLoading]=useState(false);
  const [adviceLoading,setAdviceLoading]=useState(false);
  const [newsLoading,setNewsLoading]=useState(false);
  const [predLoading,setPredLoading]=useState(false);
  const [error,setError]=useState("");

  const localName=getStockName(stockCode);

  // Load everything when code or range changes
  useEffect(()=>{
    setLoading(true);setError("");
    setCandles([]);setQuote(null);setInstData([]);setEtfData([]);
    setDisposition({});setNews([]);setAdvice(null);setPredicted([]);

    fetchAll(stockCode,range).then(([qd,inst,etf,disp,newsData])=>{
      setCandles(qd.candles||[]);setQuote(qd.quote||null);
      setInstData(inst);setEtfData(etf.data);setEtfSource(etf.source);
      setDisposition(disp);setNews(newsData);
    }).catch(()=>setError("無法載入資料，請確認股票代號")).finally(()=>setLoading(false));
  },[stockCode,range]);

  // AI prediction after candles load
  useEffect(()=>{
    if(!candles.length||!quote)return;
    const name=localName||quote.name||stockCode;
    setPredLoading(true);
    fetchAIPrediction(name,candles).then(setPredicted).catch(()=>setPredicted([])).finally(()=>setPredLoading(false));
  },[candles.length,quote?.price]);

  // AI advice (lazy: load when tab opened)
  function loadAdvice(){
    if(advice||adviceLoading||!quote)return;
    const name=localName||quote.name||stockCode;
    setAdviceLoading(true);
    fetchAdvice(stockCode,name,quote.price,quote.prev,candles,instData,etfData,disposition)
      .then(setAdvice).catch(()=>setAdvice(null)).finally(()=>setAdviceLoading(false));
  }

  const maLines=useMemo(()=>({ma5:calcMA(candles,5),ma20:calcMA(candles,20),ma60:calcMA(candles,60),ma120:calcMA(candles,120),ma240:calcMA(candles,240)}),[candles]);
  const keyDates=useMemo(()=>findKeyDates(candles),[candles]);
  const chg=quote?+(quote.price-quote.prev).toFixed(2):0;
  const chgPct=quote?+((chg/quote.prev)*100).toFixed(2):0;
  const latestMA={};MA_OPTIONS.forEach(m=>{const a=maLines[m.key];if(a)latestMA[m.key]=a.slice().reverse().find(v=>v!=null);});
  const displayName=localName||quote?.name||stockCode;

  function selectStock(code){setStockCode(code);setTab("kline");setAdvice(null);}

  const card=(children,extra={})=>(
    <div style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:"14px 16px",...extra}}>{children}</div>
  );

  return(
    <div style={{background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'SF Pro Text','PingFang TC',system-ui,sans-serif",fontSize:13}}>

      {/* Header */}
      <header style={{borderBottom:`1px solid ${T.border}`,padding:"0 16px",display:"flex",alignItems:"center",gap:12,height:52,position:"sticky",top:0,background:T.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:8,background:T.accentDim,border:`1px solid ${T.accent}40`,display:"grid",placeItems:"center",fontSize:13,fontWeight:900,color:T.accent}}>個</div>
          <span style={{fontWeight:800,fontSize:16}}>個股透視</span>
          <span style={{color:T.muted,fontSize:11,paddingLeft:10,borderLeft:`1px solid ${T.border}`}}>台股即時籌碼分析</span>
        </div>
        <div style={{display:"flex",gap:5,marginLeft:8,flexWrap:"wrap"}}>
          {POPULAR.map(c=>(<button key={c} onClick={()=>selectStock(c)}
            style={{background:c===stockCode?T.accentDim:"none",border:`1px solid ${c===stockCode?T.accent+"80":T.border}`,color:c===stockCode?T.accent:T.muted,borderRadius:6,padding:"4px 8px",cursor:"pointer",fontSize:11,fontWeight:c===stockCode?700:400}}>
            {getStockName(c)||c}</button>))}
        </div>
        <div style={{marginLeft:"auto"}}><SearchBox onSelect={selectStock}/></div>
      </header>

      {/* Disposition alert banner */}
      {(disposition.isDisposed||disposition.nearLock)&&(
        <div style={{background:disposition.isDisposed?"#7f1d1d":"#451a03",borderBottom:`1px solid ${disposition.isDisposed?T.sell:T.orange}`,padding:"8px 20px",display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:16}}>{disposition.isDisposed?"🔒":"⚠️"}</span>
          <div>
            {disposition.isDisposed&&<span style={{color:T.sell,fontWeight:700}}>【處置股】{displayName} 目前受到主管機關處置</span>}
            {disposition.nearLock&&!disposition.isDisposed&&<span style={{color:T.orange,fontWeight:700}}>【融券回補】{displayName} 面臨融券回補，最後買進日：{disposition.lockDate}</span>}
            {disposition.unlockDate&&<span style={{color:T.muted,marginLeft:12,fontSize:11}}>預計出關日：{disposition.unlockDate}</span>}
          </div>
        </div>
      )}

      {/* Quote bar */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"12px 20px",display:"flex",alignItems:"center",gap:20,minHeight:62,flexWrap:"wrap"}}>
        {loading?<div style={{color:T.muted}}>⏳ 載入中…</div>
        :error?<div style={{color:T.sell,fontWeight:600}}>{error}</div>
        :quote?<>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:10}}>
              <span style={{fontSize:22,fontWeight:900}}>{displayName}</span>
              <span style={{color:T.muted,fontSize:12}}>{stockCode}</span>
              {STOCK_MAP[stockCode]&&<span style={{background:T.accentDim,color:T.accent,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20}}>{STOCK_MAP[stockCode].sector}</span>}
              {disposition.isDisposed&&<span style={{background:"#7f1d1d",color:T.sell,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20}}>🔒 處置中</span>}
              {disposition.nearLock&&!disposition.isDisposed&&<span style={{background:"#451a03",color:T.orange,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:20}}>⚠ 融券回補</span>}
            </div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>延遲報價 · Yahoo Finance</div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:8}}>
            <span style={{fontSize:30,fontWeight:900}}>{fmt(quote.price)}</span>
            <span style={{color:pctColor(chg),fontWeight:700,fontSize:14}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)} ({pctStr(chgPct)})</span>
          </div>
          <div style={{display:"flex",gap:14}}>
            {[["開盤",quote.open],["最高",quote.high],["最低",quote.low],["昨收",quote.prev]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:10,color:T.muted}}>{l}</div><div style={{fontWeight:600}}>{fmt(v)}</div></div>
            ))}
            <div><div style={{fontSize:10,color:T.muted}}>成交量</div><div style={{fontWeight:600}}>{fmtVol(quote.vol)}</div></div>
          </div>
          <div style={{display:"flex",gap:10,marginLeft:"auto",flexWrap:"wrap",alignItems:"center"}}>
            {MA_OPTIONS.map(m=>latestMA[m.key]?(<div key={m.key} style={{textAlign:"center"}}><div style={{fontSize:9,color:m.color,fontWeight:700}}>{m.label}</div><div style={{fontSize:12,fontWeight:600}}>{fmt(latestMA[m.key])}</div></div>):null)}
            {etfData.length>0&&<ConsensusMeter etfData={etfData}/>}
          </div>
        </>:null}
      </div>

      {/* Tabs */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"0 16px",display:"flex",overflowX:"auto"}}>
        {TABS.map(t=>(<button key={t.id} onClick={()=>{setTab(t.id);if(t.id==="advice")loadAdvice();}}
          style={{background:"none",border:"none",cursor:"pointer",padding:"10px 14px",fontSize:12,fontWeight:tab===t.id?700:400,color:tab===t.id?T.accent:T.muted,borderBottom:`2px solid ${tab===t.id?T.accent:"transparent"}`,whiteSpace:"nowrap"}}>
          {t.label}
          {t.id==="lock"&&(disposition.isDisposed||disposition.nearLock)&&<span style={{marginLeft:4,width:6,height:6,borderRadius:"50%",background:T.sell,display:"inline-block"}}/>}
          {t.id==="news"&&news.length>0&&<span style={{marginLeft:4,fontSize:10,background:T.accentDim,color:T.accent,padding:"1px 5px",borderRadius:8}}>{news.length}</span>}
        </button>))}
      </div>

      <main style={{padding:"14px 16px"}}>

        {/* K-LINE */}
        {tab==="kline"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
            {RANGE_OPTIONS.map(r=>(<button key={r.range} onClick={()=>setRange(r.range)}
              style={{background:range===r.range?T.accentDim:T.card,border:`1px solid ${range===r.range?T.accent+"80":T.border}`,color:range===r.range?T.accent:T.muted,borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:range===r.range?700:400}}>{r.label}</button>))}
            <div style={{width:1,height:16,background:T.border}}/>
            {MA_OPTIONS.map(m=>(<button key={m.key} onClick={()=>setShowMA(s=>({...s,[m.key]:!s[m.key]}))}
              style={{background:showMA[m.key]?m.color+"18":T.card,border:`1px solid ${showMA[m.key]?m.color+"80":T.border}`,color:showMA[m.key]?m.color:T.muted,borderRadius:6,padding:"5px 8px",cursor:"pointer",fontSize:11,fontWeight:showMA[m.key]?700:400}}>{m.label}</button>))}
            {predLoading&&<span style={{color:T.yellow,fontSize:11}}>⏳ AI預測中…</span>}
          </div>
          {card(loading?<div style={{height:320,display:"grid",placeItems:"center",color:T.muted}}>⏳ 載入K線中…</div>:candles.length>0?<CandleChart candles={candles} predicted={predicted} maLines={maLines} showMA={showMA}/>:<div style={{height:320,display:"grid",placeItems:"center",color:T.muted}}>無資料</div>,{padding:"10px 6px"})}
          {candles.length>0&&card(<><div style={{fontSize:10,color:T.muted,paddingLeft:6,marginBottom:3}}>成交量</div><VolumeChart candles={candles}/></>,{padding:"8px 6px 4px"})}
          {predicted.length>0&&(<div style={{background:T.card,borderRadius:12,border:`1px solid ${T.yellow}33`,padding:"12px 14px"}}>
            <div style={{color:T.yellow,fontWeight:700,fontSize:11,marginBottom:8}}>🤖 AI 預測未來5交易日（僅供參考，非投資建議）</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
              {predicted.map((p,i)=>{const ref=candles[candles.length-1]?.close,diff=ref?+(p.close-ref).toFixed(2):0;return(
                <div key={i} style={{background:T.surface,borderRadius:8,padding:"8px 10px",border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:9,color:T.muted,marginBottom:3}}>{p.date?.slice(5)||`+${i+1}日`}</div>
                  <div style={{fontWeight:800,fontSize:14}}>{fmt(p.close)}</div>
                  <div style={{fontSize:10,color:pctColor(diff)}}>{diff>=0?"+":""}{diff}</div>
                  <div style={{fontSize:9,color:T.muted}}>H<span style={{color:T.buy}}>{fmt(p.high,0)}</span> L<span style={{color:T.sell}}>{fmt(p.low,0)}</span></div>
                </div>);})}
            </div>
          </div>)}
        </div>)}

        {/* AI ADVICE */}
        {tab==="advice"&&(<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {adviceLoading&&card(<div style={{padding:30,textAlign:"center",color:T.muted}}>⏳ AI 綜合分析中，請稍候…</div>)}
          {!advice&&!adviceLoading&&card(<div style={{padding:20,textAlign:"center"}}>
            <div style={{color:T.muted,marginBottom:12}}>點擊下方按鈕，AI 將綜合技術面、籌碼面、法人動向給出買進建議</div>
            <button onClick={loadAdvice} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"10px 24px",borderRadius:8,cursor:"pointer",fontSize:13}}>🤖 開始 AI 分析</button>
          </div>)}
          {advice&&(<>
            {/* Score card */}
            <div style={{background:T.card,borderRadius:14,border:`1px solid ${ratingColorMap[advice.rating]||T.border}55`,padding:"20px",display:"flex",gap:24,alignItems:"center"}}>
              <ScoreGauge score={advice.score} rating={advice.rating} color={ratingColorMap[advice.rating]}/>
              <div style={{flex:1}}>
                <div style={{fontSize:22,fontWeight:900,color:ratingColorMap[advice.rating]||T.text,marginBottom:6}}>{advice.rating}</div>
                <div style={{display:"flex",gap:16,marginBottom:10}}>
                  <div style={{background:T.buy+"18",borderRadius:8,padding:"8px 14px"}}>
                    <div style={{fontSize:10,color:T.muted,marginBottom:2}}>目標價</div>
                    <div style={{fontWeight:800,fontSize:16,color:T.buy}}>{fmt(advice.targetPrice)}</div>
                  </div>
                  <div style={{background:T.sell+"18",borderRadius:8,padding:"8px 14px"}}>
                    <div style={{fontSize:10,color:T.muted,marginBottom:2}}>停損價</div>
                    <div style={{fontWeight:800,fontSize:16,color:T.sell}}>{fmt(advice.stopLoss)}</div>
                  </div>
                  <div style={{background:T.accentDim,borderRadius:8,padding:"8px 14px"}}>
                    <div style={{fontSize:10,color:T.muted,marginBottom:2}}>現價</div>
                    <div style={{fontWeight:800,fontSize:16,color:T.accent}}>{fmt(quote?.price)}</div>
                  </div>
                </div>
                {advice.keyPoints?.length>0&&(
                  <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                    {advice.keyPoints.map((p,i)=>(
                      <span key={i} style={{fontSize:11,background:T.dim,borderRadius:20,padding:"4px 10px",color:T.text}}>{p}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
              {[["📈 技術面",advice.technical,T.accent],["🏦 籌碼面",advice.chip,T.buy],["⚠️ 風險",advice.risk,T.sell]].map(([title,content,col])=>(
                card(<><div style={{color:col,fontSize:11,fontWeight:700,marginBottom:8}}>{title}</div><p style={{margin:0,lineHeight:1.7,color:T.text,fontSize:12}}>{content}</p></>)
              ))}
            </div>
            {card(<><div style={{color:T.yellow,fontSize:11,fontWeight:700,marginBottom:8}}>💡 操作策略</div><p style={{margin:0,lineHeight:1.8}}>{advice.strategy}</p></>)}
            <div style={{fontSize:10,color:T.muted,textAlign:"center",padding:"4px 0"}}>⚠ AI 建議僅供參考，不構成投資建議，投資請自行評估風險</div>
            <button onClick={()=>{setAdvice(null);loadAdvice();}} style={{background:T.card,border:`1px solid ${T.border}`,color:T.muted,borderRadius:8,padding:"8px 18px",cursor:"pointer",fontSize:12,alignSelf:"center"}}>🔄 重新分析</button>
          </>)}
        </div>)}

        {/* NEWS */}
        {tab==="news"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:11,color:T.muted,marginBottom:4}}>個股相關新聞（AI生成，僅供參考）</div>
          {newsLoading&&card(<div style={{padding:20,textAlign:"center",color:T.muted}}>⏳ 載入新聞中…</div>)}
          {news.length===0&&!newsLoading&&card(<div style={{padding:20,textAlign:"center",color:T.muted}}>暫無新聞資料</div>)}
          {news.map((n,i)=>(
            <div key={i} style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,padding:"12px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,marginBottom:6}}>
                <div style={{fontWeight:700,fontSize:13,lineHeight:1.4,flex:1}}>{n.title}</div>
                <span style={{fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,flexShrink:0,background:sentCol(n.sentiment)+"22",color:sentCol(n.sentiment)}}>{n.sentiment}</span>
              </div>
              {n.summary&&<div style={{color:T.muted,fontSize:11,lineHeight:1.6,marginBottom:4}}>{n.summary}</div>}
              <div style={{display:"flex",gap:12,fontSize:10,color:T.dim}}>
                <span>{n.date}</span>
                {n.source&&<span>{n.source}</span>}
              </div>
            </div>
          ))}
        </div>)}

        {/* ETF HOLDINGS */}
        {tab==="etf"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:2}}>
            <span style={{fontSize:11,color:T.muted}}>目前有 <b style={{color:T.accent}}>{etfData.length} 檔</b> 主動ETF持有 {displayName}</span>
            {etfSource==="mock"&&<span style={{fontSize:10,background:T.yellow+"18",color:T.yellow,padding:"2px 8px",borderRadius:20}}>⚠ 模擬資料</span>}
            {etfSource==="finmind"&&<span style={{fontSize:10,background:T.buy+"18",color:T.buy,padding:"2px 8px",borderRadius:20}}>✓ 真實資料</span>}
          </div>
          {etfData.length===0&&card(<div style={{padding:20,textAlign:"center",color:T.muted}}>目前查無主動ETF持有此股票</div>)}
          {etfData.map((etf,i)=>(
            <div key={etf.code} style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:"12px 16px",display:"grid",gridTemplateColumns:"190px 85px 85px 1fr 120px",alignItems:"center",gap:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:3,height:28,background:T.etfColors[i%T.etfColors.length],borderRadius:2}}/>
                <div><div style={{fontWeight:700,fontSize:12}}>{etf.name}</div><div style={{color:T.muted,fontSize:10}}>{etf.code} · {etf.mgr}</div></div>
              </div>
              <div><div style={{fontSize:10,color:T.muted,marginBottom:2}}>持倉比重</div><div style={{fontWeight:800,fontSize:16,color:T.etfColors[i%T.etfColors.length]}}>{etf.currentWeight?.toFixed(2)}%</div></div>
              <div><div style={{fontSize:10,color:T.muted,marginBottom:2}}>月變化</div><div style={{fontWeight:700,fontSize:14,color:etf.delta>0.05?T.buy:etf.delta<-0.05?T.sell:T.muted}}>{etf.delta>0?"+":""}{etf.delta?.toFixed(2)}%</div></div>
              <div>
                <div style={{fontSize:10,color:T.muted,marginBottom:4}}>比重趨勢</div>
                <Spark data={etf.weightHistory} color={T.etfColors[i%T.etfColors.length]} w={150} h={26}/>
              </div>
              <div style={{fontSize:9,color:T.muted,lineHeight:1.8}}>
                {etf.weightHistory?.slice(-4).map((h,j)=>(
                  <div key={j}>{h.date?.slice(5)} <span style={{color:T.text,fontWeight:600}}>{h.weight?.toFixed(2)}%</span></div>
                ))}
              </div>
            </div>
          ))}
        </div>)}

        {/* INSTITUTIONAL */}
        {tab==="inst"&&(<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {card(<><div style={{fontSize:10,color:T.muted,marginBottom:6}}>三大法人買賣超（張）· 資料來源：台灣證交所</div>
            {instData.length?<InstBarChart data={instData}/>:<div style={{height:140,display:"grid",placeItems:"center",color:T.muted}}>暫無資料</div>}</>)}
          <div style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                {["日期","外資","投信","自營","合計"].map((h,i)=>(<th key={i} style={{padding:"9px 14px",textAlign:i===0?"left":"right",color:T.muted,fontWeight:600,fontSize:11}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {instData.length===0?<tr><td colSpan={5} style={{padding:20,textAlign:"center",color:T.muted}}>暫無資料（市場休市或資料延遲）</td></tr>
                :[...instData].reverse().map((d,i)=>(
                  <tr key={i} style={{borderBottom:`1px solid ${T.border}30`,background:i%2===0?"transparent":T.surface+"80"}}>
                    <td style={{padding:"8px 14px",color:T.muted}}>{d.date}</td>
                    {[d.foreign,d.trust,d.dealer,d.total].map((v,j)=>(<td key={j} style={{padding:"8px 14px",textAlign:"right",fontWeight:j===3?700:400,color:v>0?T.buy:v<0?T.sell:T.muted}}>{v>0?"+":""}{v?.toLocaleString()}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {instData.length>0&&(()=>{
            const totF=instData.reduce((s,d)=>s+d.foreign,0),totT=instData.reduce((s,d)=>s+d.trust,0),totD=instData.reduce((s,d)=>s+d.dealer,0);
            return(<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["外資",totF,T.accent],["投信",totT,T.yellow],["自營",totD,T.purple]].map(([l,v,c])=>(
                card(<><div style={{fontSize:11,color:T.muted,marginBottom:6}}>{l} 近期累計</div><div style={{fontSize:22,fontWeight:800,color:v>0?T.buy:v<0?T.sell:T.muted}}>{v>0?"+":""}{v?.toLocaleString()}</div><div style={{fontSize:10,color:T.muted,marginTop:4}}>張</div></>,{border:`1px solid ${v>0?c+"40":T.border}`})
              ))}
            </div>);
          })()}
        </div>)}

        {/* LOCK/UNLOCK */}
        {tab==="lock"&&(<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {/* Disposition status */}
            <div style={{background:T.card,borderRadius:12,border:`1px solid ${disposition.isDisposed?T.sell+"55":T.border}`,padding:"16px 20px"}}>
              <div style={{fontSize:11,fontWeight:700,color:disposition.isDisposed?T.sell:T.muted,marginBottom:10}}>
                🔒 處置股狀態
              </div>
              {disposition.isDisposed?(
                <><div style={{fontWeight:800,fontSize:16,color:T.sell,marginBottom:8}}>目前處置中</div>
                {disposition.dispositionInfo&&<>
                  <div style={{fontSize:11,color:T.muted}}>處置期間</div>
                  <div style={{fontWeight:600,marginBottom:4}}>{disposition.dispositionInfo.startDate} ～ {disposition.dispositionInfo.endDate}</div>
                  <div style={{fontSize:11,color:T.muted}}>原因</div>
                  <div style={{fontWeight:600}}>{disposition.dispositionInfo.reason}</div>
                </>}
                {disposition.nearUnlock&&<div style={{marginTop:10,background:T.buy+"18",borderRadius:8,padding:"8px 12px",color:T.buy,fontWeight:700,fontSize:12}}>
                  🔓 即將於 {disposition.unlockDate} 出關
                </div>}</>
              ):(
                <div style={{color:T.buy,fontWeight:700,fontSize:15}}>✓ 正常，未受處置</div>
              )}
            </div>
            {/* Margin short sale */}
            <div style={{background:T.card,borderRadius:12,border:`1px solid ${disposition.nearLock?T.orange+"55":T.border}`,padding:"16px 20px"}}>
              <div style={{fontSize:11,fontWeight:700,color:disposition.nearLock?T.orange:T.muted,marginBottom:10}}>
                ⚠️ 融券回補狀態
              </div>
              {disposition.nearLock?(
                <><div style={{fontWeight:800,fontSize:16,color:T.orange,marginBottom:8}}>即將融券回補</div>
                {disposition.marginShortSale&&<>
                  <div style={{fontSize:11,color:T.muted}}>最後融券買進日</div>
                  <div style={{fontWeight:700,color:T.sell,marginBottom:4}}>{disposition.lockDate}</div>
                  <div style={{fontSize:11,color:T.muted}}>融券回補截止日</div>
                  <div style={{fontWeight:700,color:T.orange}}>{disposition.unlockDate}</div>
                  {disposition.marginShortSale.reason&&<div style={{marginTop:8,fontSize:11,color:T.muted}}>{disposition.marginShortSale.reason}</div>}
                </>}</>
              ):(
                <div style={{color:T.buy,fontWeight:700,fontSize:15}}>✓ 無融券回補壓力</div>
              )}
            </div>
          </div>
          {/* Key dates */}
          <div style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:"16px 20px"}}>
            <div style={{fontSize:11,fontWeight:700,color:T.muted,marginBottom:10}}>📅 20日高低點突破偵測</div>
            {keyDates.length===0?<div style={{color:T.muted}}>近期無明顯突破訊號</div>
            :keyDates.map((k,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:14,padding:"10px 0",borderBottom:i<keyDates.length-1?`1px solid ${T.border}30`:"none"}}>
                <span style={{fontSize:18}}>{k.type==="突破"?"🔓":"🔒"}</span>
                <div><div style={{fontWeight:700,color:k.type==="突破"?T.buy:T.sell}}>{k.type}</div><div style={{fontSize:10,color:T.muted}}>{k.desc}</div></div>
                <div style={{color:T.muted,fontSize:11}}>{k.date}</div>
                <div style={{marginLeft:"auto",fontWeight:800,fontSize:16}}>{fmt(k.price)}</div>
              </div>
            ))}
          </div>
        </div>)}

        {/* KEY DATES (standalone) */}
        {tab==="dates"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,color:T.muted,marginBottom:4}}>20日高低點突破／跌破偵測</div>
          {keyDates.length===0&&!loading&&<div style={{color:T.muted,padding:20}}>近期無明顯突破訊號</div>}
          {keyDates.map((k,i)=>(
            <div key={i} style={{background:T.card,borderRadius:12,border:`1px solid ${k.type==="突破"?T.buy+"44":T.sell+"44"}`,padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
              <span style={{fontSize:24}}>{k.type==="突破"?"🔓":"🔒"}</span>
              <div><div style={{fontWeight:800,fontSize:15,color:k.type==="突破"?T.buy:T.sell}}>{k.type}</div><div style={{color:T.muted,fontSize:11,marginTop:2}}>{k.desc}</div></div>
              <div style={{color:T.muted,fontSize:12}}>{k.date}</div>
              <div style={{marginLeft:"auto",fontWeight:800,fontSize:20}}>{fmt(k.price)}</div>
            </div>
          ))}
        </div>)}

      </main>
    </div>
  );
}
