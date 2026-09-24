import type {Candle} from '../analysis/structure';

export type QuotexFeedStatus='connecting'|'live'|'error'|'offline';

type FeedHandlers={
  onCandles:(candles:Candle[])=>void;
  onStatus:(status:QuotexFeedStatus,message?:string)=>void;
};

const DEFAULT_QUOTEX_WS_URL='wss://quotex-analiys.onrender.com/ws';

export function connectQuotexFeed(symbol:string,mode:'REGULAR'|'OTC',handlers:FeedHandlers){
  const env=(import.meta as ImportMeta & {env?:Record<string,string|undefined>}).env;
  const raw=(env?.VITE_QUOTEX_WS_URL||DEFAULT_QUOTEX_WS_URL).trim();

  if(!raw){
    handlers.onStatus('offline','Quotex WebSocket URL is not configured');
    return ()=>{};
  }

  let stopped=false;
  let ws:WebSocket|undefined;
  let retryTimer:number|undefined;
  let retry=1000;
  let receivedCandles=false;

  const open=()=>{
    if(stopped)return;
    handlers.onStatus('connecting',receivedCandles?'Reconnecting to Quotex feed…':'Connecting to Quotex feed…');

    try{
      ws=new WebSocket(raw);
    }catch{
      handlers.onStatus('error','Invalid Quotex WebSocket URL');
      return;
    }

    ws.onopen=()=>{
      retry=1000;
      try{
        ws?.send(JSON.stringify({type:'subscribe',symbol,mode,timeframe:60,history:180}));
      }catch{
        handlers.onStatus('error','Could not send Quotex subscription');
      }
    };

    ws.onmessage=(event)=>{
      try{
        const msg=JSON.parse(String(event.data));

        if(msg.type==='snapshot'||msg.type==='candles'){
          const rows=Array.isArray(msg.candles)?msg.candles:[];
          const candles=rows.map((c:any)=>({
            time:Number(c.time),
            open:Number(c.open),
            high:Number(c.high),
            low:Number(c.low),
            close:Number(c.close),
            volume:c.volume==null?undefined:Number(c.volume)
          })).filter((c:Candle)=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite));

          if(candles.length){
            receivedCandles=true;
            handlers.onCandles(candles);
            handlers.onStatus('live','Actual Quotex prices');
          }
        }

        if(msg.type==='error'){
          handlers.onStatus('error',String(msg.message||'Quotex bridge error'));
        }
      }catch{
        handlers.onStatus('error','Invalid feed message from Quotex bridge');
      }
    };

    ws.onerror=()=>handlers.onStatus('error','Quotex bridge connection failed');

    ws.onclose=()=>{
      if(stopped)return;
      handlers.onStatus('offline','Quotex bridge disconnected — reconnecting…');
      retryTimer=window.setTimeout(open,retry);
      retry=Math.min(retry*2,15000);
    };
  };

  open();

  return ()=>{
    stopped=true;
    if(retryTimer)window.clearTimeout(retryTimer);
    try{ws?.send(JSON.stringify({type:'unsubscribe'}));}catch{}
    try{ws?.close();}catch{}
  };
}
