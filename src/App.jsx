import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { STOCK_MAP, getStockName, getStockInfo } from "./stockList.js";
import { isNativeApp, schedulePriceAlert, shareStock } from "./nativeBridge.js";

const T = {
  bg:"#090e13",surface:"#0f1820",card:"#141f2c",border:"#1a2c3d",borderLit:"#2a4560",
  accent:"#38bdf8",accentDim:"#38bdf815",buy:"#22d3a0",sell:"#fb7185",
  yellow:"#fbbf24",purple:"#a78bfa",orange:"#f97316",text:"#e2eaf2",muted:"#5a7a96",dim:"#1e3045",
  etfColors:["#38bdf8","#22d3a0","#a78bfa","#fbbf24","#f97316","#f472b6","#34d399","#60a5fa"],
  ma:{ma5:"#facc15",ma20:"#38bdf8",ma60:"#f97316",ma120:"#a78bfa",ma240:"#f472b6"}
};

// ── Favourites ─────────────────────────────────────────────────
function useFavourites() {
  const [favs,setFavs]=useState(()=>{try{return JSON.parse(localStorage.getItem("stock_favs")||"[]");}catch{return[];}});
  const toggle=useCallback((code)=>{setFavs(prev=>{const next=prev.includes(code)?prev.filter(c=>c!==code):[...prev,code];localStorage.setItem("stock_favs",JSON.stringify(next));return next;});},[]); 
  const isFav=useCallback((code)=>favs.includes(code),[favs]);
  return{favs,toggle,isFav};
}

// ── API ────────────────────────────────────────────────────────
const API_ORIGIN=(import.meta.env.VITE_API_ORIGIN||"").replace(/\/$/,"");
const apiUrl=url=>`${API_ORIGIN}${url}`;
const apiFetch=url=>fetch(apiUrl(url)).then(r=>r.ok?r.json():Promise.reject(r.status));
const apiPost=(url,body)=>fetch(apiUrl(url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json());

async function fetchStockData(code,range){
  const [q,inst,etf,disp,news]=await Promise.allSettled([
    apiFetch(`/api/quote?code=${code}&range=${range}&interval=1d`),
    apiFetch(`/api/institutional?code=${code}`).then(d=>d.data||[]),
    apiFetch(`/api/etf-holdings?code=${code}`),
    apiFetch(`/api/disposition?code=${code}`),
    apiFetch(`/api/news?code=${code}&name=${encodeURIComponent(getStockName(code)||code)}`).then(d=>d.data||[]),
  ]);
  return{
    quote:      q.status==='fulfilled'?q.value:null,
    instData:   inst.status==='fulfilled'?inst.value:[],
    etfResult:  etf.status==='fulfilled'?etf.value:{data:[],source:'error'},
    disposition:disp.status==='fulfilled'?disp.value:{},
    news:       news.status==='fulfilled'?news.value:[],
  };
}
async function fetchAIPred(name,candles){
  const recent=candles.slice(-10).map(c=>`${c.date} C:${c.close}`).join("|");
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:600,
      messages:[{role:"user",content:`根據${name}近10日（${recent}），預測未來5交易日。只回傳JSON陣列不要其他文字：[{"date":"2026-07-08","close":0,"high":0,"low":0},{"date":"2026-07-09","close":0,"high":0,"low":0},{"date":"2026-07-10","close":0,"high":0,"low":0},{"date":"2026-07-11","close":0,"high":0,"low":0},{"date":"2026-07-14","close":0,"high":0,"low":0}]`}]})});
  const d=await r.json();
  const txt=(d.content||[]).map(b=>b.text||"").join("");
  const m=txt.match(/\[[\s\S]*\]/);
  return m?JSON.parse(m[0]):[];
}

// ── Utils ──────────────────────────────────────────────────────
function calcMA(candles,period){return candles.map((_,i)=>i<period-1?null:+(candles.slice(i-period+1,i+1).reduce((s,c)=>s+c.close,0)/period).toFixed(2));}
function findKeyDates(candles){const out=[];for(let i=20;i<candles.length;i++){const w=candles.slice(i-20,i);const mH=Math.max(...w.map(c=>c.high)),mL=Math.min(...w.map(c=>c.low));const c=candles[i];if(c.close>=mH*0.999)out.push({date:c.date,type:"突破",price:c.close,desc:"突破20日高點"});else if(c.close<=mL*1.001)out.push({date:c.date,type:"跌破",price:c.close,desc:"跌破20日低點"});}return out.slice(-6).reverse();}
const fmt=(n,d=2)=>(n==null||isNaN(n))?"—":Number(n).toLocaleString("zh-TW",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtVol=v=>!v?"—":v>=1e8?(v/1e8).toFixed(1)+"億":v>=1e4?(v/1e4).toFixed(0)+"萬":v.toLocaleString();
const pctColor=v=>v>0?T.buy:v<0?T.sell:T.muted;
const pctStr=v=>(v>0?"+":"")+Number(v).toFixed(2)+"%";
const sentCol=s=>s==="正面"?T.buy:s==="負面"?T.sell:T.yellow;
const ratingColor={"強力買進":"#22d3a0","買進":"#86efac","觀望":"#fbbf24","偏空":"#fb923c","賣出":"#fb7185"};

// ── Dynamic search (calls /api/search) ────────────────────────
function useSearch(){
  const [results,setResults]=useState([]);
  const timer=useRef(null);
  const search=useCallback((q)=>{
    if(timer.current)clearTimeout(timer.current);
    if(!q.trim()){setResults([]);return;}
    // instant local results from STOCK_MAP
    const local=Object.entries(STOCK_MAP).filter(([code,v])=>code.startsWith(q)||v.name.includes(q)||v.sector?.includes(q)).slice(0,5).map(([code,v])=>({code,...v}));
    setResults(local);
    // then fetch from API for full database
    timer.current=setTimeout(async()=>{
      try{
        const d=await apiFetch(`/api/search?q=${encodeURIComponent(q)}`);
        if(d?.data?.length){
          // merge: API results first, then local-only
          const apiCodes=new Set(d.data.map(r=>r.code));
          const merged=[...d.data,...local.filter(r=>!apiCodes.has(r.code))].slice(0,10);
          setResults(merged);
        }
      }catch(_){}
    },300);
  },[]);
  return{results,search,clear:()=>setResults([])};
}

// ── Charts ─────────────────────────────────────────────────────
function CandleChart({candles,predicted=[],maLines={},showMA={}}){
  const W=800,H=300,pad={l:58,r:12,t:14,b:26};
  const all=[...candles,...predicted];
  const prices=all.flatMap(c=>[c.high,c.low].filter(Boolean));
  const maVals=Object.entries(maLines).filter(([k])=>showMA[k]).flatMap(([,v])=>v).filter(v=>v!=null);
  const allP=[...prices,...maVals];if(!allP.length)return null;
  const minP=Math.min(...allP)*0.998,maxP=Math.max(...allP)*1.002;
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,n=all.length,bw=Math.max(2,Math.floor(cW/n)-1);
  const toX=i=>pad.l+(i/n)*cW+bw/2,toY=p=>pad.t+cH-((p-minP)/(maxP-minP))*cH;
  const maConf=[{k:"ma5",c:T.ma.ma5},{k:"ma20",c:T.ma.ma20},{k:"ma60",c:T.ma.ma60},{k:"ma120",c:T.ma.ma120},{k:"ma240",c:T.ma.ma240}];
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    {Array.from({length:5}).map((_,i)=>{const v=minP+(i/4)*(maxP-minP),y=toY(v);return<g key={i}><line x1={pad.l} x2={W-pad.r} y1={y} y2={y} stroke={T.border} strokeWidth="0.5"/><text x={pad.l-4} y={y+4} textAnchor="end" fill={T.muted} fontSize="9">{v.toFixed(1)}</text></g>;})}
    {maConf.map(({k,c})=>{if(!showMA[k]||!maLines[k])return null;const pts=maLines[k].map((v,i)=>v!=null?`${toX(i)},${toY(v)}`:null).filter(Boolean);return pts.length>1?<polyline key={k} points={pts.join(" ")} fill="none" stroke={c} strokeWidth="1.2" opacity="0.9" strokeLinejoin="round"/>:null;})}
    {candles.map((c,i)=>{const x=toX(i),u=c.close>=c.open,col=u?T.buy:T.sell,top=toY(Math.max(c.open,c.close)),bot=toY(Math.min(c.open,c.close));return<g key={i}><line x1={x} x2={x} y1={toY(c.high)} y2={toY(c.low)} stroke={col} strokeWidth="1" opacity="0.7"/><rect x={x-bw/2} y={top} width={bw} height={Math.max(1,bot-top)} fill={col} opacity="0.85"/></g>;})}
    {predicted.length>0&&(()=>{const si=candles.length,pts=predicted.map((c,i)=>`${toX(si+i)},${toY(c.close)}`).join(" ");return<g><rect x={toX(si)-bw} y={pad.t} width={W-pad.r-toX(si)+bw} height={cH} fill={T.yellow} opacity="0.04"/><polyline points={pts} fill="none" stroke={T.yellow} strokeWidth="1.8" strokeDasharray="5,3"/>{predicted.map((c,i)=><rect key={i} x={toX(si+i)-bw/2} y={toY(c.high)} width={bw} height={Math.max(1,toY(c.low)-toY(c.high))} fill={T.yellow} opacity="0.13"/>)}<text x={toX(si)+2} y={pad.t+9} fill={T.yellow} fontSize="8">▶ AI預測</text></g>;})()}
    {[0,Math.floor(n*0.25),Math.floor(n*0.5),Math.floor(n*0.75),n-1].map(i=>{const c=all[i];if(!c)return null;return<text key={i} x={toX(i)} y={H-3} textAnchor="middle" fill={T.muted} fontSize="8">{c.date?.slice(5)}</text>;})}
  </svg>);
}
function VolumeChart({candles}){
  const W=800,H=58,pad={l:58,r:12,t:4,b:12};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b,n=candles.length,maxV=Math.max(...candles.map(c=>c.vol),1);
  const bw=Math.max(2,Math.floor(cW/n)-1),toX=i=>pad.l+(i/n)*cW+bw/2;
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>{candles.map((c,i)=>{const bh=(c.vol/maxV)*cH;return<rect key={i} x={toX(i)-bw/2} y={pad.t+cH-bh} width={bw} height={bh} fill={c.close>=c.open?T.buy:T.sell} opacity="0.55"/>;})}</svg>);
}
function InstBarChart({data}){
  if(!data?.length)return<div style={{color:T.muted,padding:14,textAlign:"center",fontSize:11}}>暫無資料（市場休市或資料延遲）</div>;
  const W=800,H=130,pad={l:58,r:12,t:18,b:22};
  const cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
  const vals=data.flatMap(d=>[Math.abs(d.foreign),Math.abs(d.trust),Math.abs(d.dealer)]);
  const maxV=Math.max(...vals,1),n=data.length,bw=Math.max(3,Math.floor(cW/n/4));
  const toX=i=>pad.l+(i/n)*cW,zero=pad.t+cH/2,toY=v=>zero-(v/maxV)*(cH/2);
  const ser=[{key:"foreign",color:T.accent,label:"外資"},{key:"trust",color:T.yellow,label:"投信"},{key:"dealer",color:T.purple,label:"自營"}];
  return(<svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
    <line x1={pad.l} x2={W-pad.r} y1={zero} y2={zero} stroke={T.borderLit} strokeWidth="1"/>
    {data.map((d,i)=>ser.map((s,j)=>{const v=d[s.key],y=v>=0?toY(v):zero,h=Math.max(1,Math.abs(toY(v)-zero));return<rect key={`${i}-${j}`} x={toX(i)+j*(bw+1)} y={y} width={bw} height={h} fill={s.color} opacity="0.8"/>; }))}
    {data.map((d,i)=><text key={i} x={toX(i)+bw*1.5} y={H-3} textAnchor="middle" fill={T.muted} fontSize="7">{d.date?.slice(5)}</text>)}
    {ser.map((s,i)=><g key={i}><rect x={pad.l+i*48} y={3} width={7} height={7} fill={s.color} rx="1"/><text x={pad.l+i*48+10} y={11} fill={T.muted} fontSize="8">{s.label}</text></g>)}
  </svg>);
}
function ScoreGauge({score,rating,color}){
  const s=Math.max(0,Math.min(100,score||50));
  const r=50,cx=65,cy=65,sw=9,circ=2*Math.PI*r,arc=circ*0.75,filled=arc*(s/100),col=color||T.buy;
  return(<svg width={130} height={90} viewBox="0 0 130 90">
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.dim} strokeWidth={sw} strokeDasharray={`${arc} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round"/>
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={col} strokeWidth={sw} strokeDasharray={`${filled} ${circ}`} strokeDashoffset={-circ*0.125} strokeLinecap="round"/>
    <text x={cx} y={cy-4} textAnchor="middle" fill={col} fontSize="20" fontWeight="900">{s}</text>
    <text x={cx} y={cy+11} textAnchor="middle" fill={col} fontSize="8" fontWeight="700">{rating||'觀望'}</text>
  </svg>);
}
// ── Search Box (dynamic) ───────────────────────────────────────
function SearchBox({onSelect}){
  const [val,setVal]=useState(""),[open,setOpen]=useState(false);
  const {results,search,clear}=useSearch();
  const ref=useRef();
  useEffect(()=>{search(val);},[val]);
  useEffect(()=>{const h=e=>{if(ref.current&&!ref.current.contains(e.target)){setOpen(false);}};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[]);
  function pick(code){onSelect(code);setVal("");setOpen(false);clear();}
  function submit(){if(results.length>0)pick(results[0].code);else if(/^\d{4,6}[A-Z]?$/i.test(val.trim()))pick(val.trim().toUpperCase());}
  return(<div ref={ref} style={{position:"relative"}}>
    <div style={{display:"flex",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
      <input value={val} onChange={e=>{setVal(e.target.value);setOpen(true);}} onKeyDown={e=>e.key==="Enter"&&submit()} onFocus={()=>val&&setOpen(true)}
        placeholder="代號或中文名稱…" style={{background:"none",border:"none",outline:"none",color:T.text,fontSize:12,padding:"7px 11px",width:170}}/>
      <button onClick={submit} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"7px 13px",cursor:"pointer",fontSize:12}}>查詢</button>
    </div>
    {open&&results.length>0&&(<div style={{position:"absolute",top:"100%",right:0,width:240,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,zIndex:99,marginTop:3,overflow:"hidden",boxShadow:"0 8px 30px #00000070"}}>
      {results.map(r=>(<div key={r.code} onMouseDown={()=>pick(r.code)}
        style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${T.border}22`,display:"flex",justifyContent:"space-between",alignItems:"center"}}
        onMouseEnter={e=>e.currentTarget.style.background=T.accentDim} onMouseLeave={e=>e.currentTarget.style.background="none"}>
        <div><span style={{fontWeight:700,fontSize:12}}>{r.name}</span><span style={{color:T.muted,fontSize:10,marginLeft:5}}>{r.sector||r.industry_category}</span></div>
        <span style={{color:T.muted,fontSize:11}}>{r.code}</span>
      </div>))}
    </div>)}
  </div>);
}

// ── Fund Flow ranking (market-wide 投信 accumulation leaderboard) ──
const FLOW_WINDOWS=[{label:"5日",days:5},{label:"10日",days:10},{label:"20日",days:20}];
function FlowBar({value,max,color}){
  const pct=max>0?Math.max(2,Math.min(100,(value/max)*100)):0;
  return(<div style={{flex:1,height:6,background:T.dim,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3}}/></div>);
}
function EtfFlowGroup({title,color,items,metricLabel,metricKey}){
  if(!items?.length)return null;
  return(<div>
    <div style={{fontSize:11,fontWeight:700,color,marginBottom:6}}>{title}</div>
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      {items.map(it=>(<div key={it.code} onClick={()=>it.onClick(it.code)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 11px",cursor:"pointer",fontSize:11}}>
        <span><b>{it.name}</b> <span style={{color:T.muted,fontSize:10}}>{it.code}</span></span>
        <span style={{color:T.muted,fontSize:10}}>{metricLabel}<b style={{color,marginLeft:3}}>{it[metricKey]}</b>{it.amountYi!=null?` · ${it.amountYi}億`:""}</span>
      </div>))}
    </div>
  </div>);
}
function EtfFlowSection({days,onSelectStock}){
  const [flow,setFlow]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    setLoading(true);
    apiFetch(`/api/etf-flow?days=${days}`).then(setFlow).catch(()=>setFlow(null)).finally(()=>setLoading(false));
  },[days]);

  if(loading)return null;
  if(!flow)return null;

  return(<div style={{marginTop:8,paddingTop:14,borderTop:`1px solid ${T.border}`,display:"flex",flexDirection:"column",gap:10}}>
    <div style={{fontSize:14,fontWeight:800}}>真實ETF逐檔持股變化 <span style={{fontSize:9,color:T.muted,fontWeight:400}}>（追蹤{flow.trackedEtfCount||15}檔主要ETF的每日真實持股，非彙總估算）</span></div>
    {!flow.ok&&flow.reason==="kv_not_configured"&&<div style={{fontSize:10,color:T.muted}}>ⓘ 尚未啟用逐檔ETF歷史追蹤。</div>}
    {!flow.ok&&flow.reason==="collecting"&&<div style={{fontSize:10,color:T.muted}}>ⓘ {flow.message}</div>}
    {flow.ok&&(<>
      <EtfFlowGroup title="共識買進（≥3檔ETF同時加碼）" color={T.buy} metricLabel="" metricKey="etfCount"
        items={(flow.consensusBuy||[]).map(x=>({...x,onClick:onSelectStock}))}/>
      <EtfFlowGroup title="集中加碼（估計金額≥3億）" color={T.yellow} metricLabel="" metricKey="etfCount"
        items={(flow.concentrated||[]).map(x=>({...x,onClick:onSelectStock}))}/>
      <EtfFlowGroup title="共識賣（≥3檔ETF同時減碼）" color={T.sell} metricLabel="" metricKey="etfCount"
        items={(flow.consensusSell||[]).map(x=>({...x,onClick:onSelectStock}))}/>
      {!flow.consensusBuy?.length&&!flow.concentrated?.length&&!flow.consensusSell?.length&&
        <div style={{fontSize:10,color:T.muted}}>此窗口內尚無達到門檻的個股。</div>}
    </>)}
  </div>);
}
function EtfTargetRanking({days,onSelectStock}){
  const [payload,setPayload]=useState(null);
  const [selected,setSelected]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    setLoading(true);setSelected(null);
    apiFetch(`/api/etf-flow?days=${days}`).then(data=>{
      setPayload(data);
      if(data?.ranking?.length)setSelected(data.ranking[0].code);
    }).catch(()=>setPayload(null)).finally(()=>setLoading(false));
  },[days]);

  const formatNtd=value=>value==null?"—":Math.abs(value)>=1e8?`${(value/1e8).toFixed(1)}億`:`${Math.round(value/1e4).toLocaleString()}萬`;
  const targets=payload?.ranking||[];
  const target=targets.find(item=>item.code===selected)||targets[0];
  const maxBuy=Math.max(1,...targets.map(item=>item.buyNtd||0));

  return(<div style={{display:"flex",flexDirection:"column",gap:10}}>
    <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
      <div><div style={{fontSize:16,fontWeight:900}}>主動ETF 加碼標的</div><div style={{fontSize:10,color:T.muted,marginTop:3}}>以逐檔主動ETF每日持股快照計算，非投信總買賣超。</div></div>
      {payload?.ok&&<span style={{fontSize:10,color:T.muted}}>追蹤 {payload.coveredEtfCount}/{payload.trackedEtfCount} 檔 · {payload.daysCollected} 個揭露日</span>}
    </div>
    {loading&&<div style={{padding:20,textAlign:"center",fontSize:11,color:T.muted}}>正在整理主動ETF持股變化…</div>}
    {!loading&&!payload&&<div style={{padding:20,textAlign:"center",fontSize:11,color:T.muted}}>ETF流向暫時無法載入。</div>}
    {!loading&&payload&&!payload.ok&&<div style={{background:T.card,border:`1px solid ${T.border}`,padding:"12px",borderRadius:9,fontSize:11,color:T.muted}}>{payload.message||"主動ETF歷史資料尚未準備完成。"}</div>}
    {!loading&&payload?.ok&&<>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(280px,0.9fr)",gap:10,alignItems:"start"}}>
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {targets.slice(0,12).map((item,index)=>(<button key={item.code} onClick={()=>setSelected(item.code)} style={{textAlign:"left",cursor:"pointer",background:selected===item.code?T.accentDim:T.card,border:`1px solid ${selected===item.code?T.accent+"90":T.border}`,borderRadius:9,padding:"9px 10px",color:T.text}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"baseline"}}><span style={{fontWeight:800,fontSize:12}}>{index+1}. {item.name} <span style={{fontWeight:400,color:T.muted}}>{item.code}</span></span><span style={{fontWeight:800,color:T.buy}}>{formatNtd(item.buyNtd)}</span></div>
            <div style={{display:"flex",alignItems:"center",gap:7,marginTop:6,fontSize:10,color:T.muted}}><span>{item.etfCount} 檔加碼</span><FlowBar value={item.buyNtd||0} max={maxBuy} color={T.buy}/></div>
          </button>))}
        </div>
        {target&&<div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"start"}}><div><div style={{fontWeight:900,fontSize:17}}>{target.name}</div><div style={{fontSize:10,color:T.muted,marginTop:2}}>{target.code} · {target.etfCount} 檔主動ETF加碼</div></div><button onClick={()=>onSelectStock(target.code)} style={{background:T.accentDim,border:`1px solid ${T.accent}70`,color:T.accent,borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:10}}>看個股</button></div>
          <div style={{margin:"10px 0",display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}><div style={{background:T.surface,padding:"7px",borderRadius:7}}><div style={{fontSize:9,color:T.muted}}>絕對加碼</div><div style={{fontWeight:900,color:T.buy,marginTop:2}}>{formatNtd(target.buyNtd)}</div></div><div style={{background:T.surface,padding:"7px",borderRadius:7}}><div style={{fontSize:9,color:T.muted}}>淨變動</div><div style={{fontWeight:900,marginTop:2,color:(target.netNtd||0)>=0?T.buy:T.sell}}>{formatNtd(target.netNtd)}</div></div></div>
          <div style={{fontSize:10,color:T.muted,marginBottom:6}}>加碼 ETF 明細</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>{target.buyers.map(buyer=>(<div key={buyer.etfCode} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",fontSize:11}}><div><b>{buyer.etfName}</b><span style={{color:T.muted,marginLeft:4}}>{buyer.etfCode}</span><div style={{fontSize:9,color:T.muted,marginTop:2}}>權重 {buyer.startWeight.toFixed(2)}% → {buyer.endWeight.toFixed(2)}% ({buyer.weightDelta>0?"+":""}{buyer.weightDelta.toFixed(2)}%)</div></div><div style={{color:T.buy,fontWeight:800,textAlign:"right"}}>{formatNtd(buyer.buyNtd)}</div></div>))}</div>
        </div>}
      </div>
      {!targets.length&&<div style={{padding:18,textAlign:"center",fontSize:11,color:T.muted}}>已有快照，但本期間沒有可列出的主動ETF加碼標的。</div>}
    </>}
  </div>);
}

function ActiveEtfUniverse({onSelectStock}){
  const [etfs,setEtfs]=useState([]);const [status,setStatus]=useState(null);const [loading,setLoading]=useState(true);
  useEffect(()=>{
    Promise.allSettled([apiFetch('/api/etf-flow?view=universe'),apiFetch('/api/etf-flow?view=status')]).then(([list,tracking])=>{
      if(list.status==='fulfilled')setEtfs(list.value.data||[]);
      if(tracking.status==='fulfilled')setStatus(tracking.value);
    }).finally(()=>setLoading(false));
  },[]);
  const statusColor=status?.kvConnected?(status.maxSnapshots>=2?T.buy:T.yellow):T.sell;
  const statusText=!status?"讀取追蹤狀態…":!status.kvConnected?"KV 尚未連接":status.maxSnapshots<2?`資料累積中：${status.maxSnapshots} 個揭露日`:`快照運作中：${status.maxSnapshots} 個揭露日`;
  return(<div style={{padding:"14px",maxWidth:1080,margin:"0 auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",marginBottom:12,flexWrap:"wrap"}}><div><div style={{fontSize:20,fontWeight:900}}>台灣主動ETF研究台</div><div style={{fontSize:11,color:T.muted,marginTop:4}}>即時主動ETF持股宇宙；持股變化與共識訊號由每日盤後快照累積。</div></div><div style={{background:statusColor+"18",border:`1px solid ${statusColor}55`,borderRadius:8,padding:"7px 10px",fontSize:10,color:statusColor}}><b>{statusText}</b>{status?.latestSnapshot&&<div style={{fontWeight:400,marginTop:2}}>最新快照 {status.latestSnapshot} · {status.coveredEtfCount}/{status.trackedEtfCount} 檔</div>}</div></div>
    {loading?<div style={{padding:28,textAlign:"center",color:T.muted}}>載入主動ETF資料…</div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:9}}>{etfs.map(etf=>(<div key={etf.code} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"11px"}}><div style={{display:"flex",justifyContent:"space-between",gap:6}}><b>{etf.name}</b><span style={{fontSize:10,color:T.accent}}>{etf.code}</span></div><div style={{fontSize:9,color:T.muted,margin:"4px 0 8px"}}>資料日 {etf.asOf||"—"} · {etf.holdingsCount} 檔持股</div>{etf.topHoldings.map(holding=>(<button key={holding.code} onClick={()=>onSelectStock(holding.code)} style={{display:"flex",width:"100%",justifyContent:"space-between",background:"none",border:"none",color:T.text,padding:"3px 0",cursor:"pointer",fontSize:10}}><span>{holding.name} <span style={{color:T.muted}}>{holding.code}</span></span><span style={{color:T.buy}}>{holding.weight.toFixed(2)}%</span></button>))}</div>))}</div>}
  </div>);
}

function FundFlowPage({onSelectStock}){
  const [days,setDays]=useState(5);
  const [data,setData]=useState([]);
  const [asOf,setAsOf]=useState(null);
  const [note,setNote]=useState("");
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  useEffect(()=>{
    setLoading(true);setErr("");
    apiFetch(`/api/fund-flow?days=${days}&limit=20`)
      .then(d=>{setData(d.data||[]);setAsOf(d.asOf||null);setNote(d.note||"");if(!d.data?.length)setErr("暫無資料");})
      .catch(()=>setErr("載入失敗，請稍後再試"))
      .finally(()=>setLoading(false));
  },[days]);

  const maxAmount=Math.max(1,...data.map(d=>d.amountYi||0));
  const maxLots=Math.max(1,...data.map(d=>d.netLots||0));

  return(<div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:10,maxWidth:820,margin:"0 auto"}}>
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:3,flexWrap:"wrap"}}>
        <div style={{fontSize:18,fontWeight:900}}>近期資金流排行</div>
        <a href="https://etfedge.xyz/" target="_blank" rel="noopener noreferrer"
          style={{fontSize:10,color:T.accent,textDecoration:"none",border:`1px solid ${T.accent}40`,borderRadius:20,padding:"2px 9px",background:T.accentDim}}>
          參考站點：ETF Edge ↗
        </a>
      </div>
      <div style={{fontSize:11,color:T.muted,lineHeight:1.6}}>看近期哪些個股被投信（含ETF發行商）集中買超，切換天數可看短線到較長一點的追蹤結果。</div>
    </div>
    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
      {FLOW_WINDOWS.map(w=>(<button key={w.days} onClick={()=>setDays(w.days)}
        style={{background:days===w.days?T.accentDim:T.card,border:`1px solid ${days===w.days?T.accent+"80":T.border}`,color:days===w.days?T.accent:T.muted,borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:12,fontWeight:days===w.days?700:400}}>{w.label}</button>))}
      {asOf&&<span style={{marginLeft:"auto",fontSize:10,color:T.muted}}>as of {asOf}</span>}
    </div>
    <EtfTargetRanking days={days} onSelectStock={onSelectStock}/>
    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:4}}><div style={{height:1,background:T.border,flex:1}}/><span style={{fontSize:10,color:T.muted}}>投信整體動能（輔助參考）</span><div style={{height:1,background:T.border,flex:1}}/></div>
    {note&&<div style={{fontSize:9,color:T.muted,background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 10px"}}>ⓘ {note}</div>}
    {loading&&<div style={{padding:30,textAlign:"center",color:T.muted}}>⏳ 載入中…</div>}
    {!loading&&err&&<div style={{padding:30,textAlign:"center",color:T.muted}}>{err}</div>}
    {!loading&&!err&&data.map((d,i)=>(
      <div key={d.code} onClick={()=>onSelectStock(d.code)}
        style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,padding:"12px 16px",cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8}}>
          <div style={{fontSize:14,fontWeight:800}}>{i+1}. {getStockName(d.code)||d.name} <span style={{color:T.muted,fontSize:11,fontWeight:400}}>{d.code}</span></div>
          <div style={{fontSize:16,fontWeight:900,color:T.yellow}}>{d.amountYi!=null?`${d.amountYi}億`:"—"}</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10}}><span style={{width:52,color:T.muted}}>買超張數</span><FlowBar value={d.netLots} max={maxLots} color={T.accent}/><span style={{width:64,textAlign:"right"}}>{d.netLots?.toLocaleString()}張</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10}}><span style={{width:52,color:T.muted}}>買超天數</span><FlowBar value={d.buyDays} max={d.windowDays||days} color={T.buy}/><span style={{width:64,textAlign:"right"}}>{d.buyDays}/{d.windowDays||days}日</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10}}><span style={{width:52,color:T.muted}}>連續買超</span><FlowBar value={d.streak} max={d.windowDays||days} color={T.purple}/><span style={{width:64,textAlign:"right"}}>{d.streak}日</span></div>
        </div>
      </div>
    ))}
    <EtfFlowSection days={days} onSelectStock={onSelectStock}/>
  </div>);
}

// ── Visitor counter ────────────────────────────────────────────
function VisitorCount(){
  const [data,setData]=useState(null);
  useEffect(()=>{apiFetch('/api/visitors').then(setData).catch(()=>{});},[]);
  if(!data||data.today==null||data.total==null)return null;
  return(<div style={{display:"flex",gap:12,alignItems:"center",fontSize:10,color:T.muted}}>
    <span>👁 今日 <b style={{color:T.text}}>{data.today}</b></span>
    <span>🌐 累計 <b style={{color:T.text}}>{data.total?.toLocaleString()}</b></span>
  </div>);
}

function NativeAppActions({name,code,quote}){
  const [message,setMessage]=useState("");
  if(!isNativeApp()||!quote)return null;
  const nextClose=new Date();nextClose.setDate(nextClose.getDate()+1);nextClose.setHours(13,40,0,0);
  return(<div style={{display:"flex",gap:5,alignItems:"center"}}>
    <button onClick={()=>shareStock({name,code,price:quote.price,url:""}).catch(()=>setMessage("分享未完成"))} style={{background:T.card,border:`1px solid ${T.border}`,color:T.accent,borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:10}}>分享</button>
    <button onClick={()=>schedulePriceAlert({name,code,body:`明日盤後查看 ${name} 最新報價與 ETF 持股變化`,at:nextClose}).then(ok=>setMessage(ok?"已設定明日提醒":"提醒功能尚未啟用")).catch(()=>setMessage("提醒設定失敗"))} style={{background:T.card,border:`1px solid ${T.border}`,color:T.buy,borderRadius:6,padding:"4px 7px",cursor:"pointer",fontSize:10}}>提醒</button>
    {message&&<span style={{fontSize:9,color:T.muted}}>{message}</span>}
  </div>);
}

// ── Favourites bar ─────────────────────────────────────────────
function FavBar({favs,current,onSelect,onRemove}){
  if(!favs.length)return null;
  return(<div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"5px 14px",display:"flex",gap:5,alignItems:"center",overflowX:"auto"}}>
    <span style={{fontSize:9,color:T.muted,flexShrink:0}}>⭐</span>
    {favs.map(code=>{const name=getStockName(code)||code,active=code===current;
      return(<div key={code} style={{display:"flex",alignItems:"center",background:active?T.accentDim:T.card,border:`1px solid ${active?T.accent+"80":T.border}`,borderRadius:5,overflow:"hidden",flexShrink:0}}>
        <button onClick={()=>onSelect(code)} style={{background:"none",border:"none",color:active?T.accent:T.text,padding:"3px 9px",cursor:"pointer",fontSize:10,fontWeight:active?700:400}}>{name}</button>
        <button onClick={()=>onRemove(code)} style={{background:"none",border:"none",color:T.muted,padding:"3px 5px 3px 0",cursor:"pointer",fontSize:11}}>×</button>
      </div>);
    })}
  </div>);
}

const POPULAR=["2330","2454","2317","2382","0050","00878"];
const TABS=[{id:"kline",label:"K線圖"},{id:"advice",label:"買進建議"},{id:"news",label:"個股新聞"},{id:"etf",label:"ETF持倉"},{id:"inst",label:"三大法人"},{id:"lock",label:"關出關"}];
const MA_OPT=[{key:"ma5",label:"MA5",color:T.ma.ma5},{key:"ma20",label:"MA20",color:T.ma.ma20},{key:"ma60",label:"季線",color:T.ma.ma60},{key:"ma120",label:"半年",color:T.ma.ma120},{key:"ma240",label:"年線",color:T.ma.ma240}];
const RANGE_OPT=[{label:"1月",range:"1mo"},{label:"3月",range:"3mo"},{label:"6月",range:"6mo"},{label:"1年",range:"1y"},{label:"2年",range:"2y"}];

export default function App(){
  const [view,setView]=useState("stock");
  const [stockCode,setStockCode]=useState("2330");
  const [tab,setTab]=useState("kline");
  const [range,setRange]=useState("6mo");
  const [showMA,setShowMA]=useState({ma5:true,ma20:true,ma60:true,ma120:false,ma240:false});
  const {favs,toggle:toggleFav,isFav}=useFavourites();

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

  useEffect(()=>{
    setLoading(true);setError("");
    setCandles([]);setQuote(null);setInstData([]);setEtfData([]);
    setDisposition({});setNews([]);setAdvice(null);setPredicted([]);
    fetchStockData(stockCode,range).then(({quote:q,instData:inst,etfResult,disposition:disp,news:n})=>{
      if(q?.quote){setCandles(q.candles||[]);setQuote(q.quote);}
      else if(q?.candles){setCandles(q.candles||[]);setQuote(null);setError("報價載入中…");}
      else setError("無法載入資料，請確認股票代號（如 2330、2454、00878）");
      setInstData(inst||[]);
      setEtfData(etfResult?.data||[]);setEtfSource(etfResult?.source||"");
      setDisposition(disp||{});setNews(n||[]);
    }).catch(()=>setError("網路錯誤，請稍後再試")).finally(()=>setLoading(false));
  },[stockCode,range]);

  useEffect(()=>{
    if(!candles.length||!quote)return;
    setPredLoading(true);
    fetchAIPred(displayName,candles).then(setPredicted).catch(()=>setPredicted([])).finally(()=>setPredLoading(false));
  },[candles.length,quote?.price]);

  function loadAdvice(){
    if(advice||adviceLoading||!quote)return;
    setAdviceLoading(true);
    apiPost('/api/advice',{code:stockCode,name:displayName,price:quote.price,prev:quote.prev,candles,instData,etfData,disposition})
      .then(d=>{if(d&&d.score!==undefined)setAdvice(d);else setAdvice(null);})
      .catch(()=>setAdvice(null)).finally(()=>setAdviceLoading(false));
  }

  const maLines=useMemo(()=>({ma5:calcMA(candles,5),ma20:calcMA(candles,20),ma60:calcMA(candles,60),ma120:calcMA(candles,120),ma240:calcMA(candles,240)}),[candles]);
  const keyDates=useMemo(()=>findKeyDates(candles),[candles]);
  const chg=quote?+(quote.price-quote.prev).toFixed(2):0;
  const chgPct=quote?+((chg/quote.prev)*100).toFixed(2):0;
  const latestMA={};MA_OPT.forEach(m=>{const a=maLines[m.key];if(a)latestMA[m.key]=a.slice().reverse().find(v=>v!=null);});
  function selectStock(code){setStockCode(code.toUpperCase().trim());setTab("kline");setAdvice(null);setView("stock");}
  const C=(ch,sx={})=><div style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,padding:"11px 13px",...sx}}>{ch}</div>;

  return(
    <div style={{background:T.bg,minHeight:"100vh",color:T.text,fontFamily:"'SF Pro Text','PingFang TC',system-ui,sans-serif",fontSize:13}}>

      {/* Header */}
      <header style={{borderBottom:`1px solid ${T.border}`,padding:"0 14px",display:"flex",alignItems:"center",gap:10,height:50,position:"sticky",top:0,background:T.bg,zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:26,height:26,borderRadius:7,background:T.accentDim,border:`1px solid ${T.accent}40`,display:"grid",placeItems:"center",fontSize:12,fontWeight:900,color:T.accent}}>個</div>
          <span style={{fontWeight:800,fontSize:15}}>個股透視</span>
        </div>
        <div style={{display:"flex",gap:4,background:T.card,border:`1px solid ${T.border}`,borderRadius:7,padding:2}}>
          <button onClick={()=>setView("stock")} style={{background:view==="stock"?T.accentDim:"none",border:"none",color:view==="stock"?T.accent:T.muted,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:view==="stock"?700:400}}>個股</button>
          <button onClick={()=>setView("research")} style={{background:view==="research"?T.accentDim:"none",border:"none",color:view==="research"?T.accent:T.muted,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:view==="research"?700:400}}>主動ETF</button>
          <button onClick={()=>setView("flow")} style={{background:view==="flow"?T.accentDim:"none",border:"none",color:view==="flow"?T.accent:T.muted,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:11,fontWeight:view==="flow"?700:400}}>資金流排行</button>
        </div>
        {view==="stock"&&<div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {POPULAR.map(c=>(<button key={c} onClick={()=>selectStock(c)}
            style={{background:c===stockCode?T.accentDim:"none",border:`1px solid ${c===stockCode?T.accent+"80":T.border}`,color:c===stockCode?T.accent:T.muted,borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:10,fontWeight:c===stockCode?700:400}}>
            {getStockName(c)||c}</button>))}
        </div>}
        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
          <VisitorCount/>
          <NativeAppActions name={displayName} code={stockCode} quote={quote}/>
          {quote&&<button onClick={()=>toggleFav(stockCode)} title={isFav(stockCode)?"從最愛移除":"加入最愛"}
            style={{background:isFav(stockCode)?T.yellow+"22":"none",border:`1px solid ${isFav(stockCode)?T.yellow+"80":T.border}`,color:isFav(stockCode)?T.yellow:T.muted,borderRadius:6,padding:"5px 10px",cursor:"pointer",fontSize:14}}>
            {isFav(stockCode)?"★":"☆"}</button>}
          <SearchBox onSelect={selectStock}/>
        </div>
      </header>

      {view==="flow"&&<FundFlowPage onSelectStock={selectStock}/>}
      {view==="research"&&<ActiveEtfUniverse onSelectStock={selectStock}/>}

      {view==="stock"&&<>
      <FavBar favs={favs} current={stockCode} onSelect={selectStock} onRemove={toggleFav}/>

      {(disposition.isDisposed||disposition.nearLock)&&(
        <div style={{background:disposition.isDisposed?"#7f1d1d":"#451a03",borderBottom:`1px solid ${disposition.isDisposed?T.sell:T.orange}`,padding:"6px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span>{disposition.isDisposed?"🔒":"⚠️"}</span>
          {disposition.isDisposed&&<span style={{color:T.sell,fontWeight:700,fontSize:11}}>【處置股】{displayName} 目前受到主管機關處置{disposition.unlockDate?`，預計 ${disposition.unlockDate} 出關`:""}</span>}
          {disposition.nearLock&&!disposition.isDisposed&&<span style={{color:T.orange,fontWeight:700,fontSize:11}}>【融券回補】最後買進日：{disposition.lockDate}，回補截止：{disposition.unlockDate}</span>}
        </div>
      )}

      {/* Quote bar */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"10px 14px",display:"flex",alignItems:"center",gap:16,minHeight:56,flexWrap:"wrap"}}>
        {loading?<div style={{color:T.muted,fontSize:12}}>⏳ 載入中…</div>
        :error&&!quote?<div style={{color:T.sell,fontWeight:600,fontSize:12}}>{error}</div>
        :quote?<>
          <div>
            <div style={{display:"flex",alignItems:"baseline",gap:8}}>
              <span style={{fontSize:20,fontWeight:900}}>{displayName}</span>
              <span style={{color:T.muted,fontSize:11}}>{stockCode}</span>
              {getStockInfo(stockCode)&&<span style={{background:T.accentDim,color:T.accent,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:20}}>{getStockInfo(stockCode).sector}</span>}
              {disposition.isDisposed&&<span style={{background:"#7f1d1d",color:T.sell,fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:20}}>🔒處置</span>}
            </div>
            <div style={{fontSize:9,color:T.muted,marginTop:1}}>延遲報價 · Yahoo Finance</div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:7}}>
            <span style={{fontSize:28,fontWeight:900}}>{fmt(quote.price)}</span>
            <span style={{color:pctColor(chg),fontWeight:700,fontSize:12}}>{chg>=0?"▲":"▼"} {Math.abs(chg).toFixed(2)} ({pctStr(chgPct)})</span>
          </div>
          <div style={{display:"flex",gap:12}}>
            {[["開",quote.open],["高",quote.high],["低",quote.low],["昨",quote.prev]].map(([l,v])=>(
              <div key={l}><div style={{fontSize:9,color:T.muted}}>{l}</div><div style={{fontWeight:600,fontSize:12}}>{fmt(v)}</div></div>
            ))}
            <div><div style={{fontSize:9,color:T.muted}}>量</div><div style={{fontWeight:600,fontSize:12}}>{fmtVol(quote.vol)}</div></div>
          </div>
          <div style={{display:"flex",gap:8,marginLeft:"auto",flexWrap:"wrap",alignItems:"center"}}>
            {MA_OPT.map(m=>latestMA[m.key]?<div key={m.key} style={{textAlign:"center"}}><div style={{fontSize:8,color:m.color,fontWeight:700}}>{m.label}</div><div style={{fontSize:11,fontWeight:600}}>{fmt(latestMA[m.key])}</div></div>:null)}
          </div>
        </>:null}
      </div>

      {/* Tabs */}
      <div style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"0 14px",display:"flex",overflowX:"auto"}}>
        {TABS.map(t=>(<button key={t.id} onClick={()=>{setTab(t.id);if(t.id==="advice")setTimeout(loadAdvice,50);}}
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
          {C(loading?<div style={{height:300,display:"grid",placeItems:"center",color:T.muted}}>⏳ 載入K線…</div>:candles.length>0?<CandleChart candles={candles} predicted={predicted} maLines={maLines} showMA={showMA}/>:<div style={{height:300,display:"grid",placeItems:"center",color:T.muted}}>無資料</div>,{padding:"8px 4px"})}
          {candles.length>0&&C(<VolumeChart candles={candles}/>,{padding:"5px 4px"})}
          {predicted.length>0&&(<div style={{background:T.card,borderRadius:10,border:`1px solid ${T.yellow}33`,padding:"10px 12px"}}>
            <div style={{color:T.yellow,fontWeight:700,fontSize:10,marginBottom:6}}>🤖 AI 預測未來5交易日（僅供參考，非投資建議）</div>
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
          {adviceLoading&&C(<div style={{padding:24,textAlign:"center",color:T.muted}}>⏳ AI 綜合分析中（約10秒）…</div>)}
          {!advice&&!adviceLoading&&C(<div style={{padding:16,textAlign:"center"}}>
            <div style={{color:T.muted,marginBottom:10,fontSize:12}}>AI 將綜合技術面、籌碼面、三大法人動向，給出評分與操作建議</div>
            <button onClick={loadAdvice} disabled={!quote} style={{background:T.accent,border:"none",color:"#000",fontWeight:700,padding:"9px 22px",borderRadius:7,cursor:"pointer",fontSize:12,opacity:quote?1:0.5}}>🤖 開始 AI 分析</button>
          </div>)}
          {advice&&<>
            <div style={{background:T.card,borderRadius:12,border:`1px solid ${ratingColor[advice.rating]||T.border}55`,padding:"16px",display:"flex",gap:20,alignItems:"center"}}>
              <ScoreGauge score={advice.score} rating={advice.rating} color={ratingColor[advice.rating]}/>
              <div style={{flex:1}}>
                <div style={{fontSize:20,fontWeight:900,color:ratingColor[advice.rating]||T.text,marginBottom:8}}>{advice.rating}</div>
                <div style={{display:"flex",gap:10,marginBottom:8}}>
                  {[["目標價",advice.targetPrice,T.buy],["停損價",advice.stopLoss,T.sell],["現價",quote?.price,T.accent]].map(([l,v,c])=>(
                    <div key={l} style={{background:c+"18",borderRadius:7,padding:"6px 10px"}}>
                      <div style={{fontSize:9,color:T.muted,marginBottom:1}}>{l}</div>
                      <div style={{fontWeight:800,fontSize:14,color:c}}>{fmt(v,1)}</div>
                    </div>
                  ))}
                </div>
                {advice.keyPoints?.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:5}}>{advice.keyPoints.map((p,i)=><span key={i} style={{fontSize:10,background:T.dim,borderRadius:20,padding:"3px 9px",color:T.text}}>{p}</span>)}</div>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
              {[["📈 技術面",advice.technical,T.accent],["🏦 籌碼面",advice.chip,T.buy],["⚠️ 風險",advice.risk,T.sell]].map(([title,content,col])=>(
                C(<><div style={{color:col,fontSize:10,fontWeight:700,marginBottom:6}}>{title}</div><p style={{margin:0,lineHeight:1.7,color:T.text,fontSize:11}}>{content||'分析中'}</p></>)
              ))}
            </div>
            {C(<><div style={{color:T.yellow,fontSize:10,fontWeight:700,marginBottom:6}}>💡 操作策略</div><p style={{margin:0,lineHeight:1.8,fontSize:12}}>{advice.strategy||'請觀察後決定'}</p></>)}
            <div style={{fontSize:9,color:T.muted,textAlign:"center"}}>⚠ 本分析僅供參考，不構成投資建議，投資須自行評估風險</div>
            <button onClick={()=>{setAdvice(null);setTimeout(loadAdvice,100);}} style={{background:T.card,border:`1px solid ${T.border}`,color:T.muted,borderRadius:7,padding:"6px 14px",cursor:"pointer",fontSize:11,alignSelf:"center"}}>🔄 重新分析</button>
          </>}
        </div>)}

        {/* NEWS */}
        {tab==="news"&&(<div style={{display:"flex",flexDirection:"column",gap:7}}>
          <div style={{fontSize:10,color:T.muted,marginBottom:2}}>個股相關新聞（AI生成，僅供參考）</div>
          {news.length===0&&!loading&&C(<div style={{padding:16,textAlign:"center",color:T.muted,fontSize:12}}>新聞載入中…</div>)}
          {news.map((n,i)=>(<div key={i} style={{background:T.card,borderRadius:9,border:`1px solid ${T.border}`,padding:"10px 14px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:4}}>
              <div style={{fontWeight:700,fontSize:12,lineHeight:1.4,flex:1}}>{n.title}</div>
              <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,flexShrink:0,background:sentCol(n.sentiment)+"22",color:sentCol(n.sentiment)}}>{n.sentiment}</span>
            </div>
            {n.summary&&<div style={{color:T.muted,fontSize:10,lineHeight:1.5,marginBottom:3}}>{n.summary}</div>}
            <div style={{fontSize:9,color:T.dim}}>{n.date}{n.source?` · ${n.source}`:""}</div>
          </div>))}
        </div>)}

        {/* ETF */}
        {tab==="etf"&&(<div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:T.muted}}>目前有 <b style={{color:T.accent}}>{etfData.length} 檔</b> 追蹤中的ETF持有 {displayName}</span>
            {etfSource==="moneydj"&&<span style={{fontSize:9,background:T.buy+"18",color:T.buy,padding:"2px 7px",borderRadius:20}}>✓ 真實資料 · MoneyDJ</span>}
            {etfSource==="moneydj_empty"&&<span style={{fontSize:9,background:T.yellow+"18",color:T.yellow,padding:"2px 7px",borderRadius:20}}>目前追蹤的ETF清單中無人持有</span>}
            {etfSource==="error"&&<span style={{fontSize:9,background:T.sell+"18",color:T.sell,padding:"2px 7px",borderRadius:20}}>⚠ 資料來源暫時無法連線</span>}
          </div>
          <div style={{fontSize:9,color:T.muted}}>僅涵蓋 15 檔主要台股ETF（0050、0056、006208、00878等），非市場全部ETF；僅顯示最新一期持股快照，無歷史權重可查。</div>
          {etfData.length===0&&C(<div style={{padding:16,textAlign:"center",color:T.muted,fontSize:12}}>查無ETF持倉資料</div>)}
          {etfData.map((etf,i)=>(
            <div key={etf.code||i} style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,padding:"10px 14px",display:"grid",gridTemplateColumns:"1fr 100px 140px 110px",alignItems:"center",gap:12}}>
              <div style={{display:"flex",alignItems:"center",gap:7}}><div style={{width:3,height:24,background:T.etfColors[i%T.etfColors.length],borderRadius:2}}/>
                <div><div style={{fontWeight:700,fontSize:11}}>{etf.name}</div><div style={{color:T.muted,fontSize:9}}>{etf.code}</div></div>
              </div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:1}}>持倉比重</div><div style={{fontWeight:800,fontSize:14,color:T.etfColors[i%T.etfColors.length]}}>{Number(etf.currentWeight||0).toFixed(2)}%</div></div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:1}}>持有股數</div><div style={{fontWeight:600,fontSize:12}}>{etf.shares?Number(etf.shares).toLocaleString():"—"}</div></div>
              <div><div style={{fontSize:9,color:T.muted,marginBottom:1}}>資料日期</div><div style={{fontSize:11,color:T.muted}}>{etf.asOf||"—"}</div></div>
            </div>
          ))}
        </div>)}

        {/* INST */}
        {tab==="inst"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          {C(<><div style={{fontSize:10,color:T.muted,marginBottom:5}}>三大法人買賣超（張）· 台灣證交所</div><InstBarChart data={instData}/></>)}
          <div style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${T.border}`}}>
                {["日期","外資","投信","自營","合計"].map((h,i)=>(<th key={i} style={{padding:"8px 12px",textAlign:i===0?"left":"right",color:T.muted,fontWeight:600,fontSize:10}}>{h}</th>))}
              </tr></thead>
              <tbody>
                {instData.length===0?<tr><td colSpan={5} style={{padding:14,textAlign:"center",color:T.muted}}>暫無資料</td></tr>
                :[...instData].reverse().map((d,i)=>(<tr key={i} style={{borderBottom:`1px solid ${T.border}20`,background:i%2===0?"transparent":T.surface+"60"}}>
                  <td style={{padding:"7px 12px",color:T.muted,fontSize:11}}>{d.date}</td>
                  {[d.foreign,d.trust,d.dealer,d.total].map((v,j)=>(<td key={j} style={{padding:"7px 12px",textAlign:"right",fontWeight:j===3?700:400,color:v>0?T.buy:v<0?T.sell:T.muted,fontSize:11}}>{v>0?"+":""}{v?.toLocaleString()}</td>))}
                </tr>))}
              </tbody>
            </table>
          </div>
          {instData.length>0&&(()=>{const tF=instData.reduce((s,d)=>s+d.foreign,0),tT=instData.reduce((s,d)=>s+d.trust,0),tD=instData.reduce((s,d)=>s+d.dealer,0);return(
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[["外資",tF,T.accent],["投信",tT,T.yellow],["自營",tD,T.purple]].map(([l,v,c])=>(
                C(<><div style={{fontSize:10,color:T.muted,marginBottom:4}}>{l} 近期累計</div><div style={{fontSize:20,fontWeight:800,color:v>0?T.buy:v<0?T.sell:T.muted}}>{v>0?"+":""}{v?.toLocaleString()}</div><div style={{fontSize:9,color:T.muted}}>張</div></>,{border:`1px solid ${v>0?c+"40":T.border}`})
              ))}
            </div>);
          })()}
        </div>)}

        {/* LOCK */}
        {tab==="lock"&&(<div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {C(<><div style={{fontSize:10,fontWeight:700,color:disposition.isDisposed?T.sell:T.muted,marginBottom:8}}>🔒 處置股狀態</div>
              {disposition.isDisposed?<><div style={{fontWeight:800,fontSize:15,color:T.sell,marginBottom:6}}>目前處置中</div>
                {disposition.dispositionInfo&&<><div style={{fontSize:10,color:T.muted}}>期間：{disposition.dispositionInfo.startDate} ～ {disposition.dispositionInfo.endDate}</div><div style={{fontSize:10,color:T.muted,marginTop:3}}>原因：{disposition.dispositionInfo.reason}</div></>}
                {disposition.nearUnlock&&<div style={{marginTop:8,background:T.buy+"18",borderRadius:6,padding:"6px 10px",color:T.buy,fontWeight:700,fontSize:11}}>🔓 即將於 {disposition.unlockDate} 出關</div>}
              </>:<div style={{color:T.buy,fontWeight:700,fontSize:14}}>✓ 正常，未受處置</div>}
            </>)}
            {C(<><div style={{fontSize:10,fontWeight:700,color:disposition.nearLock?T.orange:T.muted,marginBottom:8}}>⚠️ 融券回補</div>
              {disposition.nearLock?<><div style={{fontWeight:800,fontSize:15,color:T.orange,marginBottom:6}}>即將融券回補</div>
                <div style={{fontSize:10,color:T.muted}}>最後融券買進日：<span style={{color:T.sell,fontWeight:700}}>{disposition.lockDate}</span></div>
                <div style={{fontSize:10,color:T.muted,marginTop:3}}>回補截止日：<span style={{color:T.orange,fontWeight:700}}>{disposition.unlockDate}</span></div>
              </>:<div style={{color:T.buy,fontWeight:700,fontSize:14}}>✓ 無融券回補壓力</div>}
            </>)}
          </div>
          {C(<><div style={{fontSize:10,fontWeight:700,color:T.muted,marginBottom:8}}>📅 近期20日高低點突破</div>
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
      </>}
    </div>
  );
}
