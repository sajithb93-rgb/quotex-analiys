import type {Candle} from '../analysis/structure';

export type QuotexFeedStatus='connecting'|'live'|'error'|'offline';

type FeedHandlers={
  onCandles:(candles:Candle[])=>void;
  onStatus:(status:QuotexFeedStatus,message?:string)=>void;
};

export function connectQuotexFeed(symbol:string,mode:'REGULAR'|'OTC',handlers:FeedHandlers){
  const raw=import.meta.env.VITE_QUOTEX_WS_URL as string|undefined;
  if(!raw){
    handlers.onStatus('offline','VITE_QUOTEX_WS_URL is not configured');
    return ()=>{};
  }

  const ws=new WebSocket(raw);
  handlers.onStatus('connecting');

  ws.onopen=()=>{
    handlers.onStatus('live');
    ws.send(JSON.stringify({
      type:'subscribe',
      symbol,
      mode,
      timeframe:60,
      history:180
    }));
  };

  ws.onmessage=(event)=>{
    try{
      const msg=JSON.parse(event.data);
      if(msg.type==='snapshot'||msg.type==='candles'){
        const candles=Array.isArray(msg.candles)?msg.candles:[];
        handlers.onCandles(candles.map((c:any)=>({
          time:Number(c.time),
          open:Number(c.open),
          high:Number(c.high),
          low:Number(c.low),
          close:Number(c.close),
          volume:c.volume==null?undefined:Number(c.volume)
        })).filter((c:Candle)=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)));
      }
      if(msg.type==='error') handlers.onStatus('error',String(msg.message||'Feed error'));
    }catch{
      handlers.onStatus('error','Invalid feed message');
    }
  };

  ws.onerror=()=>handlers.onStatus('error','Quotex bridge connection failed');
  ws.onclose=()=>handlers.onStatus('offline','Quotex bridge disconnected');

  return ()=>{
    try{ws.send(JSON.stringify({type:'unsubscribe'}));}catch{}
    ws.close();
  };
}
