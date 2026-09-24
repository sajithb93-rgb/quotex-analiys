import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

EMAIL=os.getenv("QUOTEX_EMAIL","").strip()
PASSWORD=os.getenv("QUOTEX_PASSWORD","").strip()
HOST=os.getenv("QUOTEX_HOST","qxbroker.com").strip()
ORIGINS=[x.strip() for x in os.getenv("ALLOWED_ORIGINS","http://localhost:5173").split(",") if x.strip()]

app=FastAPI(title="Quotex Live Data Bridge")
app.add_middleware(CORSMiddleware,allow_origins=ORIGINS,allow_credentials=True,allow_methods=["*"],allow_headers=["*"])

def normalize_asset(symbol:str,mode:str)->str:
    asset=symbol.replace("/","").replace(" ","").upper()
    if mode=="OTC" and not asset.endswith("_OTC"):
        asset += "_OTC"
    return asset

def normalize_candles(raw:Any)->list[dict[str,Any]]:
    rows=[]
    source=raw.values() if isinstance(raw,dict) else raw if isinstance(raw,list) else []
    for c in source:
        if not isinstance(c,dict):
            continue
        t=c.get("time",c.get("from",c.get("timestamp")))
        o=c.get("open")
        h=c.get("high")
        l=c.get("low")
        close=c.get("close")
        if None in (t,o,h,l,close):
            continue
        try:
            rows.append({"time":int(float(t))*1000 if float(t)<10_000_000_000 else int(float(t)),"open":float(o),"high":float(h),"low":float(l),"close":float(close),"volume":float(c.get("volume",0) or 0)})
        except (TypeError,ValueError):
            pass
    return sorted({c["time"]:c for c in rows}.values(),key=lambda x:x["time"])[-300:]

async def make_client(asset:str):
    if not EMAIL or not PASSWORD:
        raise RuntimeError("QUOTEX_EMAIL and QUOTEX_PASSWORD are required on the bridge server")
    from pyquotex.stable_api import Quotex
    client=Quotex(email=EMAIL,password=PASSWORD,host=HOST,lang="en",asset_default=asset,period_default=60)
    ok,reason=await client.connect()
    if not ok:
        raise RuntimeError(f"Quotex connection failed: {reason}")
    return client

@app.get("/health")
async def health():
    return {"ok":True,"service":"quotex-live-data-bridge"}

@app.websocket("/ws")
async def websocket_feed(ws:WebSocket):
    await ws.accept()
    client=None
    asset=None
    try:
        request=await ws.receive_json()
        if request.get("type")!="subscribe":
            await ws.send_json({"type":"error","message":"First message must be subscribe"})
            await ws.close()
            return
        asset=normalize_asset(str(request.get("symbol","EUR/USD")),str(request.get("mode","REGULAR")).upper())
        timeframe=int(request.get("timeframe",60))
        if timeframe not in (5,10,15,30,60,120,300,600,900,1800,3600):
            timeframe=60

        client=await make_client(asset)
        history=await client.get_historical_candles(asset,amount_of_seconds=timeframe*180,period=timeframe,max_workers=2)
        await ws.send_json({"type":"snapshot","symbol":asset,"candles":normalize_candles(history)})

        await client.start_candles_one_stream(asset,timeframe)

        last_signature=None
        while True:
            raw=client.get_realtime_candles(asset,timeframe)
            candles=normalize_candles(raw)
            if candles:
                signature=(candles[-1]["time"],candles[-1]["close"],len(candles))
                if signature!=last_signature:
                    last_signature=signature
                    await ws.send_json({"type":"candles","symbol":asset,"candles":candles})
            await asyncio.sleep(0.25)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await ws.send_json({"type":"error","message":str(exc)})
        except Exception:
            pass
    finally:
        if client is not None:
            try:
                await client.close()
            except Exception:
                pass

if __name__=="__main__":
    import uvicorn
    uvicorn.run("quotex_bridge:app",host=os.getenv("BRIDGE_HOST","0.0.0.0"),port=int(os.getenv("BRIDGE_PORT","8000")),reload=False)
