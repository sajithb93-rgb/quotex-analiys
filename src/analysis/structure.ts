export type Candle={time:number;open:number;high:number;low:number;close:number};
export type StructurePoint={index:number;time:number;price:number;kind:'HH'|'HL'|'LH'|'LL'};
export type BreakEvent={index:number;time:number;price:number;kind:'BOS'|'CHoCH';direction:'bullish'|'bearish'};
export type FVG={left:number;right:number;top:number;bottom:number;direction:'bullish'|'bearish'};
export type Analysis={points:StructurePoint[];breaks:BreakEvent[];fvgs:FVG[];bias:'bullish'|'bearish'|'neutral'};
const pivotHigh=(d:Candle[],i:number,r:number)=>{if(i<r||i>=d.length-r)return false;const p=d[i].high;for(let j=i-r;j<=i+r;j++)if(j!==i&&d[j].high>=p)return false;return true};
const pivotLow=(d:Candle[],i:number,r:number)=>{if(i<r||i>=d.length-r)return false;const p=d[i].low;for(let j=i-r;j<=i+r;j++)if(j!==i&&d[j].low<=p)return false;return true};
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
 return{points,breaks,fvgs,bias}
}
export function seedCandles(count=180,start=Date.now()-count*60000):Candle[]{let price=1.084;const out:Candle[]=[];for(let i=0;i<count;i++){const open=price,drift=Math.sin(i/17)*.00015+(Math.random()-.48)*.00055,close=Math.max(.5,open+drift),high=Math.max(open,close)+Math.random()*.00035,low=Math.min(open,close)-Math.random()*.00035;out.push({time:start+i*60000,open,high,low,close});price=close}return out}