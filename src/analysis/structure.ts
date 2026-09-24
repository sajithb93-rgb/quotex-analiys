export type Candle={time:number;open:number;high:number;low:number;close:number;volume?:number};
export type StructurePoint={index:number;time:number;price:number;kind:'HH'|'HL'|'LH'|'LL'};
export type BreakEvent={index:number;time:number;price:number;kind:'BOS'|'CHoCH';direction:'bullish'|'bearish'};
export type FVG={left:number;right:number;top:number;bottom:number;direction:'bullish'|'bearish'};
export type PressureSnapshot={buy:number;sell:number;delta:number;dominant:'BUYERS'|'SELLERS'|'BALANCED';candleBuy:number;candleSell:number;volume:number;confidence:'LOW'|'MEDIUM'|'HIGH'};
export type Analysis={points:StructurePoint[];breaks:BreakEvent[];fvgs:FVG[];bias:'bullish'|'bearish'|'neutral';pressure:PressureSnapshot;pressureHistory:{index:number;buy:number;sell:number;delta:number}[]};

const pivotHigh=(d:Candle[],i:number,r:number)=>{if(i<r||i>=d.length-r)return false;const p=d[i].high;for(let j=i-r;j<=i+r;j++)if(j!==i&&d[j].high>=p)return false;return true};
const pivotLow=(d:Candle[],i:number,r:number)=>{if(i<r||i>=d.length-r)return false;const p=d[i].low;for(let j=i-r;j<=i+r;j++)if(j!==i&&d[j].low<=p)return false;return true};

function candlePressure(c:Candle):{buy:number;sell:number}{
 const range=Math.max(c.high-c.low,1e-12);
 const closePos=(c.close-c.low)/range;
 const body=Math.abs(c.close-c.open)/range;
 const upper=(c.high-Math.max(c.open,c.close))/range;
 const lower=(Math.min(c.open,c.close)-c.low)/range;
 const bullishClose=closePos;
 const bearishClose=1-closePos;
 const buyScore=Math.max(0,Math.min(1,bullishClose*.7+Math.max(0,lower-upper)*.3+Math.max(0,c.close-c.open)/range*.2));
 const sellScore=Math.max(0,Math.min(1,bearishClose*.7+Math.max(0,upper-lower)*.3+Math.max(0,c.open-c.close)/range*.2));
 const total=buyScore+sellScore||1;
 return {buy:buyScore/total,sell:sellScore/total};
}
function volumeWeight(data:Candle[],lookback=20){
 const recent=data.slice(-lookback);
 const vols=recent.map(c=>c.volume??1);
 const avg=vols.reduce((a,b)=>a+b,0)/Math.max(1,vols.length);
 return avg>0?(data[data.length-1]?.volume??avg)/avg:1;
}
function calcPressure(data:Candle[]):{snap:PressureSnapshot;history:{index:number;buy:number;sell:number;delta:number}[]}{
 const start=Math.max(0,data.length-80);const history=[];let cumulative=0;
 for(let i=start;i<data.length;i++){
  const c=data[i],p=candlePressure(c),vw=Math.max(.5,Math.min(2,volumeWeight(data.slice(0,i+1))));
  const buy=p.buy*vw,sell=p.sell*vw,delta=buy-sell;cumulative+=delta;
  history.push({index:i,buy:buy*100,sell:sell*100,delta:delta*100});
 }
 const last=history[history.length-1]||{buy:50,sell:50,delta:0,index:0};
 const rawBuy=Math.max(0,last.buy),rawSell=Math.max(0,last.sell),total=rawBuy+rawSell||1;
 const buy=rawBuy/total*100,sell=rawSell/total*100;
 const dominant=buy-sell>6?'BUYERS':sell-buy>6?'SELLERS':'BALANCED';
 const range=Math.max(1e-12,(data[data.length-1]?.high??1)-(data[data.length-1]?.low??1));
 const body=Math.abs((data[data.length-1]?.close??1)-(data[data.length-1]?.open??1))/range;
 return {snap:{buy,sell,delta:buy-sell,dominant,candleBuy:buy,candleSell:sell,volume:data[data.length-1]?.volume??0,confidence:body>.55?'HIGH':body>.2?'MEDIUM':'LOW'},history};
}

export function analyzeStructure(data:Candle[],radius=3):Analysis{
 const points:StructurePoint[]=[];let lastHigh:StructurePoint|undefined;let lastLow:StructurePoint|undefined;
 for(let i=radius;i<data.length-radius;i++){
  if(pivotHigh(data,i,radius)){const kind=!lastHigh?'HH':data[i].high>lastHigh.price?'HH':'LH';const p={index:i,time:data[i].time,price:data[i].high,kind} as StructurePoint;points.push(p);lastHigh=p}
  if(pivotLow(data,i,radius)){const kind=!lastLow?'HL':data[i].low>lastLow.price?'HL':'LL';const p={index:i,time:data[i].time,price:data[i].low,kind} as StructurePoint;points.push(p);lastLow=p}
 }
 points.sort((a,b)=>a.index-b.index);const breaks:BreakEvent[]=[];let bias:Analysis['bias']='neutral';let lastSwingHigh=-Infinity;let lastSwingLow=Infinity;
 for(let i=0;i<points.length;i++){const p=points[i];if(p.kind==='HH'||p.kind==='LH')lastSwingHigh=Math.max(lastSwingHigh,p.price);else lastSwingLow=Math.min(lastSwingLow,p.price);const c=data[p.index];
  if(c.close>lastSwingHigh&&lastSwingHigh!==-Infinity){breaks.push({index:p.index,time:c.time,price:c.close,kind:bias==='bearish'?'CHoCH':'BOS',direction:'bullish'});bias='bullish'}
  else if(c.close<lastSwingLow&&lastSwingLow!==Infinity){breaks.push({index:p.index,time:c.time,price:c.close,kind:bias==='bullish'?'CHoCH':'BOS',direction:'bearish'});bias='bearish'}
 }
 const fvgs:FVG[]=[];for(let i=2;i<data.length;i++){const a=data[i-2],c=data[i];if(c.low>a.high)fvgs.push({left:i-2,right:i,top:c.low,bottom:a.high,direction:'bullish'});if(c.high<a.low)fvgs.push({left:i-2,right:i,top:a.low,bottom:c.high,direction:'bearish'})}
 const {snap:pressure,history:pressureHistory}=calcPressure(data);
 return{points,breaks,fvgs,bias,pressure,pressureHistory}
}
export function seedCandles(count=180,start=Date.now()-count*60000):Candle[]{let price=1.084;const out:Candle[]=[];for(let i=0;i<count;i++){const open=price,drift=Math.sin(i/17)*.00015+(Math.random()-.48)*.00055,close=Math.max(.5,open+drift),high=Math.max(open,close)+Math.random()*.00035,low=Math.min(open,close)-Math.random()*.00035;out.push({time:start+i*60000,open,high,low,close,volume:500+Math.random()*500});price=close}return out}
