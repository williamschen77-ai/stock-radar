import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { STOCK_MAP, searchStock, getStockName, getStockInfo } from "./stockList.js";

const T = {
  bg:"#090e13",surface:"#0f1820",card:"#141f2c",border:"#1a2c3d",borderLit:"#2a4560",
  accent:"#38bdf8",accentDim:"#38bdf815",buy:"#22d3a0",buyDim:"#22d3a012",
  sell:"#fb7185",sellDim:"#fb718512",yellow:"#fbbf24",purple:"#a78bfa",
  orange:"#f97316",text:"#e2eaf2",muted:"#5a7a96",dim:"#1e3045",
  etfColors:["#38bdf8","#22d3a0","#a78bfa","#fbbf24","#f97316","#f472b6","#34d399","#60a5fa"],
  ma:{ma5:"#facc15",ma20:"#38bdf8",ma60:"#f97316",ma120:"#a78bfa",ma240:"#f472b6"}
};

// ── Favourites (localStorage) ─────────────────────────────────
function useFavourites() {
  const [favs, setFavs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("stock_favs") || "[]"); }
    catch { return []; }
  });
  const toggle = useCallback((code) => {
    setFavs(prev => {
      const next = prev.includes(code) ? prev.filter(c=>c!==code) : [...prev, code];
      localStorage.setItem("stock_favs", JSON.stringify(next));
      return next;
    });
  }, []);
  const isFav = useCallback((code) => favs.includes(code), [favs]);
  return { favs, toggle, isFav };
}

// ── API helpers ────────────────────────────────────────────────
const apiFetch = (url) => fetch(url).then(r => { if(!r.ok) throw new Error(r.status); return r.json(); });
const apiPost  = (url, body) => fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).then(r => r.json());

// Fetch quote + candles + inst + etf + disposition + news ALL in parallel
async function fetchStockData(code, range) {
  const [quoteData, inst, etf, disp, newsData] = await Promise.allSettled([
    apiFetch(`/api/quote?symbol=${code}.TW&range=${range}&interval=1d`),
    apiFetch(`/api/institutional?code=${code}`).then(d=>d.data||[]),
    apiFetch(`/api/etf-holdings?code=${code}`),
    apiFetch(`/api/disposition?code=${code}`),
    apiFetch(`/api/news?code=${code}&name=${encodeURIComponent(getStockName(code)||code)}`).then(d=>d.data||[]),
  ]);
  return {
    quote:       quoteData.status==='fulfilled' ? quoteData.value : null,
    instData:    inst.status==='fulfilled'      ? inst.value      : [],
    etfResult:   etf.status==='fulfilled'       ? etf.value       : {data:[],source:'error'},
    disposition: disp.status==='fulfilled'      ? disp.value      : {},
    news:        newsData.status==='fulfilled'  ? newsData.value  : [],
  };
}

async function fetchAIPrediction(name, candles) {
  const recent = candles.slice(-10).map(c=>`${c.date} C:${c.close}`).join("|");
  const r = await fetch("https://api.anthropic.com/v1/messages",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,
      messages:[{role:"user",content:`根據${name}近10日（${recent}），預測未來5交易日收盤價格區間。只回傳JSON陣列，不要其他文字：[{"date":"2026-07-08","close":0,"high":0,"low":0},{"date":"2026-07-09","close":0,"high":0,"low":0},{"date":"2026-07-10","close":0,"high":0,"low":0},{"date":"2026-07-11","close":0,"high":0,"low":0},{"date":"2026-07-14","close":0,"high":0,"low":0}]`}]})});
  const d = await r.json();
  const txt = d.content?.map(b=>b.text||"").join("")||"[]";
  return JSON.parse(txt.replace(/```json|```/g,"").trim());
}

async function fetchAdvice(code,name,price,prev,candles,instData,etfData,disposition) {
  return apiPost('/api/advice',{code,name,price,prev,candles,instData,etfData,disposition});
}

// ── Utils ──────────────────────────────────────────────────────
function calcMA(candles,period){return candles.map((_,i)=>i<period-1?null:+(candles.slice(i-period+1,i+1).reduce((s,c)=>s+c.close,0)/period).toFixed(2));}
function findKeyDates(candles){const out=[];for(let i=20;i<candles.length;i++){const w=candles.slice(i-20,i);const mH=Math.max(...w.map(c=>c.high)),mL=Math.min(...w.map(c=>c.low));const c=candles[i];if(c.close>=mH*0.999)out.push({date:c.date,type:"突破",price:c.close,desc:"突破20日高點"});else if(c.close<=mL*1.001)out.push({date:c.date,type:"跌破",price:c.close,desc:"跌破20日低點"});}return out.slice(-6).reverse();}
const fmt=(n,d=2)=>(n==null||isNaN(n))?"—":n.toLocaleString("zh-TW",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtVol=v=>!v?"—":v>=1e8?(v/1e8).toFixed(1)+"億":v>=1e4?(v/1e4).toFixed(0)+"萬":v.toLocaleString();
const pctColor=v=>v>0?T.buy:v<0?T.sell:T.muted;
const pctStr=v=>(v>0?"+":"")+v?.toFixed(2)+"%";
const sentCol=s=>s==="正面"?T.buy:s==="負面"?T.sell:T.yellow;
const ratingColorMap={"強力買進":"#22d3a0","買進":"#86efac","觀望":"#fbbf24","偏空":"#fb923c","賣出":"#fb7185"};

// ── Charts ─────────────────────────────────────────────────────
function CandleChart({candles,predicted=[],maLines={},showMA={}}){
  const W=800,H=300,pad={l:58,r:12,t:14,b:26};
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
    {Array.from({length:5}).map((_,i)=>{const v=minP+(i/4)*(maxP-minP),y=toY(v);return<g key={i}><line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={T.border} strokeWidth="0.5"/><text x={pad.l-4} y={y+4} textAnchor="end" fill={T.muted} fontSize="9">{v.toFixed(1)}</text></g>;})}
    {maConf.map(({k,c})=>{if(!showMA[k]||!maLines[k])return null;const pts=maLines[k].map((v,i)=>v!=null?`${toX(i)},${toY(v)}`:null).filter(Boolean);return pts.length>1?<polyline key={k} points={pts.join(" ")} fill="none" stroke={c} strokeWidth="1.2" opacity="0.9" strokeLinejoin="round"/>:null;})}
    {candles.map((c,i)=>{const x=toX(i),u=c.close>=c.open,col=u?T.buy:T.sell,top=toY(Math.max(c.open,c.close)),bot=toY(Math.min(c.open,c.close));return<g key={i}><line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={col} strokeWidth="1" opacity="0.7"/><rect x={x-bw/2} y={top} width={bw} height={Math.max(1,bot-top)} fill={col} opacity="0.85"/></g>;})}
    {predicted.length>0&&(()=>{const si=candles.length,pts=predicted.map((c,i)=>`${toX(si+i)},${toY(c.close)}`).join(" ");return<g><rect x={toX(si)-bw} y={pad.t} width={W-pad.r-toX(si)+bw} height={cH} fill={T.yellow} opacity="0.04"/><polyline points={pts} fill="none" stroke={T.yellow} strokeWidth="1.8" strokeDasharray="5,3"/>{predicted.map((c,i)=><rect key={i} x={toX(si+i)-bw/2} y={toY(c.high)} width={bw} height={Math.max(1,toY(c.low)-toY(c.high))} fill={T.yellow} opacity="0.14"/>)}<text x={toX(si)+2} y={pad.t+9} fill={T.yellow} fontSize="8">▶ AI預測</text></g>;})()}
    {[0,Math.floor(n*0.25),Math.floor(n*0.5),Math.floor(n*0.75),n-1].map(i=>{const c=all[i];if(!c)return null;return<text key={i} x={toX(i)} y={H-3} textAnchor="middle" fill={T.muted} fontSize="8">{c.date?.slice(5)}</text>;})}
  </svg>);
}
function VolumeChart({candles}){
  const W=800,H=60,pad={l:58,r:12,t:4,b:14};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,n=candles.length,maxV=Math.max(...candles.map(c=>c.vol),1);
  const bw=Math.max(2,Math.floor(cW/n)-1),toX=i=>pad.l+(i/n)*cW+bw/2;
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>{candles.map((c,i)=>{const bh=(c.vol/maxV)*cH;return<rect key={i} x={toX(i)-bw/2} y={pad.t+cH-bh} width={bw} height={bh} fill={c.close>=c.open?T.buy:T.sell} opacity="0.55"/>;})}</svg>);
}
function InstBarChart({data}){
  if(!data?.length)return<div style={{color:T.muted,padding:16,textAlign:"center",fontSize:12}}>暫無資料</div>;
  const W=800,H=130,pad={l:58,r:12,t:18,b:22};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,vals=data.flatMap(d=>[Math.abs(d.foreign),Math.abs(d.trust),Math.abs(d.dealer)]),maxV=Math.max(...vals,1),n=data.length,bw=Math.max(3,Math.floor(cW/n/4));
  const toX=i=>pad.l+(i/n)*cW,zero=pad.t+cH/2,toY=v=>zero-(v/maxV)*(cH/2);
  const ser=[{key:"foreign",color:T.accent,label:"外資"},{key:"trust",color:T.yellow,label:"投信"},{key:"dealer",color:T.purple,label:"自營"}];
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <line x1={pad.l} x2={W-pad.r} y1={zero} y2={zero} stroke={T.borderLit} strokeWidth="1"/>
    {data.map((d,i)=>ser.map((s,j)=>{const v=d[s.key],y=v>=0?toY(v):zero,h=Math.max(1,Math.abs(toY(v)-zero));return<rect key={`${i}-${j}`} x={toX(i)+j*(bw+1)} y={y} width={bw} height={h} fill={s.color} opacity="0.8"/>; }))}
    {data.map((d,i)=><text key={i} x={toX(i)+bw*1.5} y={H-3} textAnchor="middle" fill={T.muted} fontSize="7">{d.date?.slice(5)}</text>)}
    {ser.map((s,i)=><g key={i}><rect x={pad.l+i*48} y={3} width={7} height={7} fill={s.color} rx="1"/><text x={pad.l+i*48+10} y={11} fill={T.muted} fontSize="8">{s.label}</text></g>)}
  </svg>);
}
function Spark({data,color,w=140,h=26}){
  if(!data?.length)return null;
  const vals=data.map(d=>d.weight??d),min=Math.min(...vals),max=Math.max(...vals),range=max-min||0.1;
  const pts=vals.map((v,i)=>`${(i/(vals.length-1))*w},${h-((v-min)/range)*h}`).join(" ");
  return(<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:"block"}}><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" opacity="0.9"/></svg>);
}
function ScoreGauge({score,rating,color}){
  const r=50,cx=65,cy=65,sw=9,circ=2*Math.PI*r,arc=circ*0.75,filled=arc*(score/100),col=color||T.buy;
  return(<svg width={130} height={90} viewBox="0 0 130 90">
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.dim} strokeWidth={sw} strokeDasharray={`${arc} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round"/>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={sw} strokeDasharray={`${filled} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round"/>
    <text x={cx} y={cy-4} textAnchor="middle" fill={col} fontSize="20" fontWeight="900">{score}</text>
    <text x={cx} y={cy+11} textAnchor="middle" fill={col} fontSize="8" fontWeight="700">{rating}</text>
  </svg>);
}
function ConsensusMeter({etfData}){
  if(!etfData?.length)return null;
  const buyers=etfData.filter(e=>e.delta>0.05).length,sellers=etfData.filter(e=>e.delta<-0.05).length;
  const score=Math.round((buyers/etfData.length)*100),col=score>=60?T.buy:score<=40?T.sell:T.yellow;
  return(<div style={{minWidth:160,background:T.card,borderRadius:8,padding:"8px 12px",border:`1px solid ${T.border}`}}>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:4}}>
      <span style={{color:T.muted}}>ETF共識</span><span style={{color:col,fontWeight:700}}>{score>=60?"偏多":score<=40?"偏空":"分歧"}</span>
    </div>
    <div style={{height:4,background:T.dim,borderRadius:2,overflow:"hidden",marginBottom:4}}>
      <div style={{width:`${score}%`,height:"100%",background:col,borderRadius:2}}/>
    </div>
    <div style={{fontSize:9,color:T.muted}}>▲{buyers} ▼{sellers} 持{etfData.length-buyers-sellers}</div>
  </div>);
}

// ── Search box ─────────────────────────────────────────────────
function SearchBox({onSelect}){
  const [val,setVal]=useState(""),[ results,setResults]=useState([]),[open,setOpen]=useState(false);
  const ref=useRef();
  useEffect(()=>{
    if(!val.trim()){setResults([]);setOpen(false);return;}
    const r=searchStock(val);
    // also allow bare numeric codes not in our map
    if(!r.length&&/^\d{4,6}$/.test(val.trim()))r.push({code:val.trim(),name:val.trim(),sector:"自訂"});
    setResults(r);setOpen(r.length>0);
  },[val]);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  function pick(code){onSelect(code);setVal("");setOpen(false);}
  function submit(){const r=searchStock(val);if(r.length>0)pick(r[0].code);else if(/^\d{4,6}$/.test(val.trim()))pick(val.trim());}
  return(<div ref={ref} style={{position:"relative"}}>
    <div style={{display:"flex",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} onFocus={()=>val&&open&&setOpen(true)}
        placeholder="代號或中文名稱…" style={{background:"none",border:"none",outline:"none",color:T.text,fontSize:12,padding:"7px 11px",width:160}}/>
      <button onClick={submit} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"7px 13px",cursor:"pointer",fontSize:12}}>查詢</button>
    </div>
    {open&&results.length>0&&(<div style={{position:"absolute",top:"100%",right:0,width:230,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,zIndex:99,marginTop:3,overflow:"hidden",boxShadow:"0 8px 30px #00000070"}}>
      {results.map(r=>(<div key={r.code} onMouseDown={()=>pick(r.code)}
        style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}22`,display:"flex",justifyContent:"space-between",alignItems:"center"}}
        onMouseEnter={e=>e.currentTarget.style.background=T.accentDim} onMouseLeave={e=>e.currentTarget.style.background="none"}>
        <div><span style={{fontWeight:700,fontSize:12}}>{r.name}</span><span style={{color:T.muted,fontSize:10,marginLeft:5}}>{r.sector}</span></div>
        <span style={{color:T.muted,fontSize:11}}>{r.code}</span>
      </div>))}
    </div>)}
  </div>);
}

// ── Favourites sidebar ─────────────────────────────────────────
function FavBar({favs,current,onSelect,onRemove}){
  if(!favs.length)return null;
  return(<div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"6px 16px",display:"flex",gap:6,alignItems:"center",overflowX:"auto"}}>
    <span style={{fontSize:10,color:T.muted,flexShrink:0}}>⭐ 最愛</span>
    {favs.map(code=>{
      const name=getStockName(code)||code;
      const active=code===current;
      return(<div key={code} style={{display:"flex",alignItems:"center",gap:0,background:active?T.accentDim:T.card,border:`1px solid ${active?T.accent+"80":T.border}`,borderRadius:6,overflow:"hidden",flexShrink:0}}>
        <button onClick={()=>onSelect(code)} style={{background:"none",border:"none",color:active?T.accent:T.text,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:active?700:400}}>{name}</button>
        <button onClick={()=>onRemove(code)} style={{background:"none",border:"none",color:T.muted,padding:"4px 6px 4px 0",cursor:"pointer",fontSize:12,lineHeight:1}}>×</button>
      </div>);
    })}
  </div>);
}

const POPULAR=["2330","2454","2317","2382","0050","00878"];
const TABS=[{id:"kline",label:"K線圖"},{id:"advice",label:"買進建議"},{id:"news",label:"個股新聞"},{id:"etf",label:"ETF持倉"},{id:"inst",label:"三大法人"},{id:"lock",label:"關出關"}];
const MA_OPT=[{key:"ma5",label:"MA5",color:T.ma.ma5},{key:"ma20",label:"MA20",color:T.ma.ma20},{key:"ma60",label:"季線",color:T.ma.ma60},{key:"ma120",label:"半年",color:T.ma.ma120},{key:"ma240",label:"年線",color:T.ma.ma240}];
const RANGE_OPT=[{label:"1月",range:"1mo"},{label:"3月",range:"3mo"},{label:"6月",range:"6mo"},{label:"1年",range:"1y"},{label:"2年",range:"2y"}];

export default function App(){
  const [stockCode,setStockCode]=useState("2330");
  const [tab,setTab]=useState("kline");
  const [range,setRange]=useState("6mo");
  const [showMA,setShowMA]=useState({ma5:true,ma20:true,ma60:true,ma120:false,ma240:false});
  const { favs, toggle: toggleFav, isFav } = useFavourites();

  const [candles,setCandles]=useState([]);
  const [quote,setQuote]=useState(null);
  const [instData,setInstData]=useState([]);
  const [etfData,setEtfData]=useState([]);
  const [etfSource,setEtfSource]=useState("");
  const [disposition,setDisposition]=useState({});
  const [news,setNews]=useState([]);
  const [advice,setAdvice]=useState(null);
  const [predicted,setPredicted]=useState([]);

  const [loading,setLoading]=useState(false);
  const [adviceLoading,setAdviceLoading]=useState(false);
  const [predLoading,setPredLoading]=useState(false);
  const [error,setError]=useState("");

  const localName=getStockName(stockCode);
  const displayName=localName||quote?.name||stockCode;

  // Load all data in parallel
  useEffect(()=>{
    setLoading(true);setError("");
    setCandles([]);setQuote(null);setInstData([]);setEtfData([]);
    setDisposition({});setNews([]);setAdvice(null);setPredicted([]);

    fetchStockData(stockCode,range).then(({quote:q,instData:inst,etfResult,disposition:disp,news:n})=>{
      if(q){setCandles(q.candles||[]);setQuote(q.quote||null);}
      else setError("無法載入資料，請確認股票代號（如 2330、2454）");
      setInstData(inst);
      setEtfData(etfResult?.data||[]);
      setEtfSource(etfResult?.source||"");
      setDisposition(disp||{});
      setNews(n);
    }).catch(()=>setError("網路錯誤，請稍後再試")).finally(()=>setLoading(false));
  },[stockCode,range]);

  // AI prediction runs after candles load (non-blocking)
  useEffect(()=>{
    if(!candles.length||!quote)return;
    setPredLoading(true);
    fetchAIPrediction(displayName,candles)
      .then(setPredicted).catch(()=>setPredicted([])).finally(()=>setPredLoading(false));
  },[candles.length,quote?.price]);

  function loadAdvice(){
    if(advice||adviceLoading||!quote)return;
    const name=displayName;
    setAdviceLoading(true);
    fetchAdvice(stockCode,name,quote.price,quote.prev,candles,instData,etfData,disposition)
      .then(setAdvice).catch(()=>setAdvice(null)).finally(()=>setAdviceLoading(false));
  }

  const maLines=useMemo(()=>({ma5:calcMA(candles,5),ma20:calcMA(candles,20),ma60:calcMA(candles,60),ma120:calcMA(candles,120),ma240:calcMA(candles,240)}),[candles]);
  const keyDates=useMemo(()=>findKeyDates(candles),[candles]);
  const chg=quote?+(quote.price-quote.prev).toFixed(2):0;
  const chgPct=quote?+((chg/quote.prev)*100).toFixed(2):0;
  const latestMA={};MA_OPT.forEach(m=>{const a=maLines[m.key];if(a)latestMA[m.key]=a.slice().reverse().find(v=>v!=null);});

  function selectStock(code){setStockCode(code.toUpperCase());setTab("kline");setAdvice(null);}

  const card=(ch,sx={})=><div style={{background:T.card,borderRadius:12,border:`1px solid ${T.border}`,padding:"12px 14px",...sx}}>{ch}</div>;

  return(
    <div style={{background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'SF Pro Text','PingFang TC',system-ui,sans-serif",fontSize:13}}>

      {/* ── Header ── */}
      <header style={{borderBottom:`1px solid ${T.border}`,padding:"0 14px",display:"flex",alignItems:"center",gap:10,height:50,position:"sticky",top:0,background:T.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:26,height:26,borderRadius:7,background:T.accentDim,border:`1px solid ${T.accent}40`,display:"grid",placeItems:"center",fontSize:12,fontWeight:900,color:T.accent}}>個</div>
          <span style={{fontWeight:800,fontSize:15}}>個股透視</span>
          <span style={{color:T.muted,fontSize:10,paddingLeft:8,borderLeft:`1px solid ${T.border}`}}>台股籌碼分析</span>
        </div>
        <div style={{display:"flex",gap:4,marginLeft:6,flexWrap:"wrap"}}>
          {POPULAR.map(c=>(<button key={c} onClick={()=>selectStock(c)}
            style={{background:c===stockCode?T.accentDim:"none",border:`1px solid ${c===stockCode?T.accent+"80":T.border}`,color:c===stockCode?T.accent:T.muted,borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:c===stockCode?700:400}}>
            {getStockName(c)||c}</button>))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          {/* Star / favourite button */}
          {quote&&<button onClick={()=>toggleFav(stockCode)}
            style={{background:isFav(stockCode)?T.yellow+"22":"none",border:`1px solid ${isFav(stockCode)?T.yellow+"80":T.border}`,color:isFav(stockCode)?T.yellow:T.muted,borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:13}}>
            {isFav(stockCode)?"★":"☆"}</button>}
          <SearchBox onSelect={selectStock}/>
        </div>
      </header>

      {/* ── Favourites bar ── */}
      <FavBar favs={favs} current={stockCode} onSelect={selectStock} onRemove={toggleFav}/>

      {/* ── Disposition alert ── */}
      {(disposition.isDisposed||disposition.nearLock)&&(
        <div style={{background:disposition.isDisposed?"#7f1d1d":"#451a03",borderBottom:`1px solid ${disposition.isDisposed?T.sell:T.orange}`,padding:"7px 16px",display:"flex",alignItems:"center",gap:10}}>
          <span>{disposition.isDisposed?"🔒":"⚠️"}</span>
          {disposition.isDisposed&&<span style={{color:T.sell,fontWeight:700,fontSize:12}}>【處置股】{displayName} 目前受到主管機關處置{disposition.unlockDate?`，預計 ${disposition.unlockDate} 出關`:""}</span>}
          {disposition.nearLock&&!disposition.isDisposed&&<span style={{color:T.orange,fontWeight:700,fontSize:12}}>【融券回補】最後買進日：{disposition.lockDate}，回補截止：{disposition.unlockDate}</span>}
        </div>
      )}

      {/* ── Quote bar ── */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"10px 14px",display:"flex",alignItems:"center",gap:18,minHeight:58,flexWrap:"wrap"}}>
        {loading?<div style={{color:T.muted,fontSize:12}}>⏳ 載入中…</div>
        :error?<div style={{color:T.sell,fontWeight:600,fontSize:12}}>{error}</div>
        :quote?<>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:20,fontWeight:900}}>{displayName}</span>
              <span style={{color:T.muted,fontSize:11}}>{stockCode}</span>
              {getStockInfo(stockCode)&&<span style={{background:T.accentDim,color:T.accent,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:20}}>{getStockInfo(stockCode).sector}</span>}
              {disposition.isDisposed&&<span style={{background:"#7f1d1d",color:T.sell,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:20}}>🔒處置</span>}
              {disposition.nearLock&&!disposition.isDisposed&&<span style={{background:"#451a03",color:T.orange,fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:20}}>⚠融券</span>}
            </div>
            <div style={{fontSize:9,color:T.muted,marginTop:2}}>延遲報價 · Yahoo Finance</div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:7}}>
            <span style={{fontSize:28,fontWeight:900}}>{fmt(quote.price)}</span>
            <span style={{color:pctColor(chg),fontWeight:700,fontSize:13}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)} ({pctStr(chgPct)})</span>
          </div>
          <div style={{display:"flex",gap:12}}>
            {[["開",quote.open],["高",quote.high],["低",quote.low],["收",quote.prev]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:9,color:T.muted}}>{l}</div><div style={{fontWeight:600,fontSize:12}}>{fmt(v)}</div></div>
            ))}
            <div><div style={{fontSize:9,color:T.muted}}>量</div><div style={{fontWeight:600,fontSize:12}}>{fmtVol(quote.vol)}</div></div>
          </div>
          <div style={{display:"flex",gap:8,marginLeft:"auto",flexWrap:"wrap",alignItems:"center"}}>
            {MA_OPT.map(m=>latestMA[m.key]?<div key={m.key} style={{textAlign:"center"}}><div style={{fontSize:8,color:m.color,fontWeight:700}}>{m.label}</div><div style={{fontSize:11,fontWeight:600}}>{fmt(latestMA[m.key])}</div></div>:null)}
            {etfData.length>0&&<ConsensusMeter etfData={etfData}/>}
          </div>
        </>:null}
      </div>

      {/* ── Tabs ── */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"0 14px",display:"flex",overflowX:"auto"}}>
        {TABS.map(t=>(<button key={t.id} onClick={()=>{setTab(t.id);if(t.id==="advice")setTimeout(loadAdvice,100);}}
          style={{background:"none",border:"none",cursor:"pointer",padding:"9px 13px",fontSize:11,fontWeight:tab===t.id?700:400,color:tab===t.id?T.accent:T.muted,borderBottom:`2px solid ${tab===t.id?T.accent:"transparent"}`,whiteSpace:"nowrap"}}>
          {t.label}
          {t.id==="etf"&&etfData.length>0&&<span style={{marginLeft:3,fontSize:9,background:T.accentDim,color:T.accent,padding:"1px 4px",borderRadius:8}}>{etfData.length}</span>}
          {t.id==="news"&&news.length>0&&<span style={{marginLeft:3,fontSize:9,background:T.accentDim,color:T.accent,padding:"1px 4px",borderRadius:8}}>{news.length}</span>}
          {t.id==="lock"&&(disposition.isDisposed||disposition.nearLock)&&<span style={{marginLeft:3,width:5,height:5,borderRadius:"50%",background:T.sell,display:"inline-block"}}/>}
        </button>))}
      </div>

      <main style={{padding:"12px 14px"}}>

        {/* K-LINE */}
        {tab==="kline"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
            {RANGE_OPT.map(r=>(<button key={r.range} onClick={()=>setRange(r.range)}
              style={{background:range===r.range?T.accentDim:T.card,border:`1px solid ${range===r.range?T.accent+"80":T.border}`,color:range===r.range?T.accent:T.muted,borderRadius:5,padding:"4px 9px",cursor:"pointer",fontSize:10,fontWeight:range===r.range?700:400}}>{r.label}</button>))}
            <div style={{width:1,height:14,background:T.border}}/>
            {MA_OPT.map(m=>(<button key={m.key} onClick={()=>setShowMA(s=>({...s,[m.key]:!s[m.key]}))}
              style={{background:showMA[m.key]?m.color+"18":T.card,border:`1px solid ${showMA[m.key]?m.color+"80":T.border}`,color:showMA[m.key]?m.color:T.muted,borderRadius:5,padding:"4px 8px",cursor:"pointer",fontSize:10,fontWeight:showMA[m.key]?700:400}}>{m.label}</button>))}
            {predLoading&&<span style={{color:T.yellow,fontSize:10}}>⏳ AI預測中…</span>}
          </div>
          {card(loading?<div style={{height:300,display:"grid",placeItems:"center",color:T.muted}}>⏳ 載入K線…</div>:candles.length>0?<CandleChart candles={candles} predicted={predicted} maLines={maLines} showMA={showMA}/>:<div style={{height:300,display:"grid",placeItems:"center",color:T.muted}}>無資料</div>,{padding:"8px 4px"})}
          {candles.length>0&&card(<VolumeChart candles={candles}/>,{padding:"6px 4px 2px"})}
          {predicted.length>0&&(<div style={{background:T.card,borderRadius:10,border:`1px solid ${T.yellow}33`,padding:"10px 12px"}}>
            <div style={{color:T.yellow,fontWeight:700,fontSize:10,marginBottom:6}}>🤖 AI 預測未來5交易日（僅供參考）</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5}}>
              {predicted.map((p,i)=>{const ref=candles[candles.length-1]?.close,diff=ref?+(p.close-ref).toFixed(2):0;return(
                <div key={i} style={{background:T.surface,borderRadius:7,padding:"7px 9px",border:`1px solid ${T.border}`}}>
                  <div style={{fontSize:8,color:T.muted,marginBottom:2}}>{p.date?.slice(5)||`+${i+1}日`}</div>
                  <div style={{fontWeight:800,fontSize:13}}>{fmt(p.close)}</div>
                  <div style={{fontSize:9,color:pctColor(diff)}}>{diff>=0?"+":""}{diff}</div>
                </div>);})}
            </div>
          </div>)}
        </div>)}

        {/* ADVICE */}
        {tab==="advice"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          {adviceLoading&&card(<div style={{padding:24,textAlign:"center",color:T.muted}}>⏳ AI 綜合分析中…</div>)}
          {!advice&&!adviceLoading&&card(<div style={{padding:16,textAlign:"center"}}>
            <div style={{color:T.muted,marginBottom:10,fontSize:12}}>AI 將綜合技術面、籌碼面、三大法人給出買進評分與建議</div>
            <button onClick={loadAdvice} disabled={!quote} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"9px 22px",borderRadius:7,cursor:"pointer",fontSize:12}}>🤖 開始 AI 分析</button>
          </div>)}
          {advice&&<>
            <div style={{background:T.card,borderRadius:12,border:`1px solid ${ratingColorMap[advice.rating]||T.border}55`,padding:"16px",display:"flex",gap:20,alignItems:"center"}}>
              <ScoreGauge score={advice.score} rating={advice.rating} color={ratingColorMap[advice.rating]}/>
              <div style={{flex:1}}>
                <div style={{fontSize:20,fontWeight:900,color:ratingColorMap[advice.rating]||T.text,marginBottom:8}}>{advice.rating}</div>
                <div style={{display:"flex",gap:10,marginBottom:8}}>
                  {[["目標價",advice.targetPrice,T.buy],["停損價",advice.stopLoss,T.sell],["現價",quote?.price,T.accent]].map(([l,v,c])=>(
                    <div key={l} style={{background:c+"18",borderRadius:7,padding:"6px 10px"}}><div style={{fontSize:9,color:T.muted,marginBottom:1}}>{l}</div><div style={{fontWeight:800,fontSize:14,color:c}}>{fmt(v)}</div></div>
                  ))}
                </div>
                {advice.keyPoints?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5}}>{advice.keyPoints.map((p,i)=><span key={i} style={{fontSize:10,background:T.dim,borderRadius:20,padding:"3px 9px",color:T.text}}>{p}</span>)}</div>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[["📈 技術面",advice.technical,T.accent],["🏦 籌碼面",advice.chip,T.buy],["⚠️ 風險",advice.risk,T.sell]].map(([title,content,col])=>(
                card(<><div style={{color:col,fontSize:10,fontWeight:700,marginBottom:6}}>{title}</div><p style={{margin:0,lineHeight:1.7,color:T.text,fontSize:11}}>{content}</p></>)
              ))}
            </div>
            {card(<><div style={{color:T.yellow,fontSize:10,fontWeight:700,marginBottom:6}}>💡 操作策略</div><p style={{margin:0,lineHeight:1.8,fontSize:12}}>{advice.strategy}</p></>)}
            <div style={{fontSize:9,color:T.muted,textAlign:"center"}}>⚠ 本分析僅供參考，不構成投資建議</div>
            <button onClick={()=>{setAdvice(null);setTimeout(loadAdvice,100);}} style={{background:T.card,border:`1px solid ${T.border}`,color:T.muted,borderRadius:7,padding:"6px 14px",cursor:"pointer",fontSize:11,alignSelf:"center"}}>🔄 重新分析</button>
          </>}
        </div>)}

        {/* NEWS */}
        {tab==="news"&&(<div style={{display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:10,color:T.muted,marginBottom:2}}>個股相關新聞（AI生成，僅供參考）</div>
          {news.length===0&&card(<div style={{padding:16,textAlign:"center",color:T.muted,fontSize:12}}>暫無新聞</div>)}
          {news.map((n,i)=>(<div key={i} style={{background:T.card,borderRadius:9,border:`1px solid ${T.border}`,padding:"10px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:4}}>
              <div style={{fontWeight:700,fontSize:12,lineHeight:1.4,flex:1}}>{n.title}</div>
              <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,flexShrink:0,background:sentCol(n.sentiment)+"22",color:sentCol(n.sentiment)}}>{n.sentiment}</span>
            </div>
            {n.summary&&<div style={{color:T.muted,fontSize:10,lineHeight:1.5,marginBottom:3}}>{n.summary}</div>}
            <div style={{fontSize:9,color:T.dim}}>{n.date}{n.source?` · ${n.source}`:""}</div>
          </div>))}
        </div>)}

        {/* ETF HOLDINGS */}
        {tab==="etf"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
            <span style={{fontSize:11,color:T.muted}}>目前有 <b style={{color:T.accent}}>{etfData.length} 檔</b> ETF持有 {displayName}</span>
            {etfSource==="finmind"&&<span style={{fontSize:9,background:T.buy+"18",color:T.buy,padding:"2px 7px",borderRadius:20}}>✓ 真實資料</span>}
            {etfSource==="finmind_empty"&&<span style={{fontSize:9,background:T.yellow+"18",color:T.yellow,padding:"2px 7px",borderRadius:20}}>此期間無ETF持倉記錄</span>}
            {etfSource==="no_token"&&<span style={{fontSize:9,background:T.sell+"18",color:T.sell,padding:"2px 7px",borderRadius:20}}>⚠ 未設定FINMIND_TOKEN</span>}
          </div>
          {etfData.length===0&&card(<div style={{padding:16,textAlign:"center",color:T.muted,fontSize:12}}>查無ETF持倉資料</div>)}
          {etfData.map((etf,i)=>(
            <div key={etf.code||i} style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,padding:"10px 14px",display:"grid",gridTemplateColumns:"175px 80px 80px 1fr 100px",alignItems:"center",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:7}}>
                <div style={{width:3,height:26,background:T.etfColors[i%T.etfColors.length],borderRadius:2}}/>
                <div><div style={{fontWeight:700,fontSize:11}}>{etf.name}</div><div style={{color:T.muted,fontSize:9}}>{etf.code}{etf.mgr?` · ${etf.mgr}`:""}</div></div>
              </div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:1}}>持倉比重</div><div style={{fontWeight:800,fontSize:15,color:T.etfColors[i%T.etfColors.length]}}>{etf.currentWeight?.toFixed(2)}%</div></div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:1}}>月變化</div><div style={{fontWeight:700,fontSize:13,color:etf.delta>0.05?T.buy:etf.delta<-0.05?T.sell:T.muted}}>{etf.delta>0?"+":""}{etf.delta?.toFixed(2)}%</div></div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:3}}>比重趨勢</div><Spark data={etf.weightHistory} color={T.etfColors[i%T.etfColors.length]} w={130} h={24}/></div>
              <div style={{fontSize:9,color:T.muted,lineHeight:1.9}}>{etf.weightHistory?.slice(-4).map((h,j)=><div key={j}>{h.date?.slice(5)} <span style={{color:T.text}}>{h.weight?.toFixed(2)}%</span></div>)}</div>
            </div>
          ))}
        </div>)}

        {/* INSTITUTIONAL */}
        {tab==="inst"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          {card(<><div style={{fontSize:10,color:T.muted,marginBottom:5}}>三大法人買賣超（張）· 台灣證交所</div><InstBarChart data={instData}/></>)}
          <div style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                {["日期","外資","投信","自營","合計"].map((h,i)=>(<th key={i} style={{padding:"8px 12px",textAlign:i===0?"left":"right",color:T.muted,fontWeight:600,fontSize:10}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {instData.length===0?<tr><td colSpan={5} style={{padding:16,textAlign:"center",color:T.muted}}>暫無資料</td></tr>
                :[...instData].reverse().map((d,i)=>(<tr key={i} style={{borderBottom:`1px solid ${T.border}20`,background:i%2===0?"transparent":T.surface+"60"}}>
                  <td style={{padding:"7px 12px",color:T.muted}}>{d.date}</td>
                  {[d.foreign,d.trust,d.dealer,d.total].map((v,j)=>(<td key={j} style={{padding:"7px 12px",textAlign:"right",fontWeight:j===3?700:400,color:v>0?T.buy:v<0?T.sell:T.muted}}>{v>0?"+":""}{v?.toLocaleString()}</td>))}
                </tr>))}
              </tbody>
            </table>
          </div>
          {instData.length>0&&(()=>{const tF=instData.reduce((s,d)=>s+d.foreign,0),tT=instData.reduce((s,d)=>s+d.trust,0),tD=instData.reduce((s,d)=>s+d.dealer,0);return(
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[["外資",tF,T.accent],["投信",tT,T.yellow],["自營",tD,T.purple]].map(([l,v,c])=>(
                card(<><div style={{fontSize:10,color:T.muted,marginBottom:4}}>{l} 近期累計</div><div style={{fontSize:20,fontWeight:800,color:v>0?T.buy:v<0?T.sell:T.muted}}>{v>0?"+":""}{v?.toLocaleString()}</div><div style={{fontSize:9,color:T.muted}}>張</div></>,{border:`1px solid ${v>0?c+"40":T.border}`})
              ))}
            </div>);
          })()}
        </div>)}

        {/* LOCK/UNLOCK */}
        {tab==="lock"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {card(<>
              <div style={{fontSize:10,fontWeight:700,color:disposition.isDisposed?T.sell:T.muted,marginBottom:8}}>🔒 處置股狀態</div>
              {disposition.isDisposed?<>
                <div style={{fontWeight:800,fontSize:15,color:T.sell,marginBottom:6}}>目前處置中</div>
                {disposition.dispositionInfo&&<><div style={{fontSize:10,color:T.muted}}>期間：{disposition.dispositionInfo.startDate} ～ {disposition.dispositionInfo.endDate}</div><div style={{fontSize:10,color:T.muted,marginTop:3}}>原因：{disposition.dispositionInfo.reason}</div></>}
                {disposition.nearUnlock&&<div style={{marginTop:8,background:T.buy+"18",borderRadius:6,padding:"6px 10px",color:T.buy,fontWeight:700,fontSize:11}}>🔓 即將於 {disposition.unlockDate} 出關</div>}
              </>:<div style={{color:T.buy,fontWeight:700,fontSize:14}}>✓ 正常，未受處置</div>}
            </>)}
            {card(<>
              <div style={{fontSize:10,fontWeight:700,color:disposition.nearLock?T.orange:T.muted,marginBottom:8}}>⚠️ 融券回補</div>
              {disposition.nearLock?<>
                <div style={{fontWeight:800,fontSize:15,color:T.orange,marginBottom:6}}>即將融券回補</div>
                <div style={{fontSize:10,color:T.muted}}>最後融券買進日：<span style={{color:T.sell,fontWeight:700}}>{disposition.lockDate}</span></div>
                <div style={{fontSize:10,color:T.muted,marginTop:3}}>回補截止日：<span style={{color:T.orange,fontWeight:700}}>{disposition.unlockDate}</span></div>
              </>:<div style={{color:T.buy,fontWeight:700,fontSize:14}}>✓ 無融券回補壓力</div>}
            </>)}
          </div>
          {card(<>
            <div style={{fontSize:10,fontWeight:700,color:T.muted,marginBottom:8}}>📅 近期20日高低點突破</div>
            {keyDates.length===0?<div style={{color:T.muted,fontSize:11}}>近期無明顯訊號</div>
            :keyDates.map((k,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:i<keyDates.length-1?`1px solid ${T.border}22`:"none"}}>
              <span style={{fontSize:16}}>{k.type==="突破"?"🔓":"🔒"}</span>
              <div><div style={{fontWeight:700,fontSize:12,color:k.type==="突破"?T.buy:T.sell}}>{k.type}</div><div style={{fontSize:9,color:T.muted}}>{k.desc}</div></div>
              <div style={{color:T.muted,fontSize:10}}>{k.date}</div>
              <div style={{marginLeft:"auto",fontWeight:800,fontSize:14}}>{fmt(k.price)}</div>
            </div>))}
          </>)}
        </div>)}

      </main>
    </div>
  );
}
