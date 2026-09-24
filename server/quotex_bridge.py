import asyncio
import logging
import os
import time
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("quotex_bridge")

EMAIL = os.getenv("QUOTEX_EMAIL", "").strip()
PASSWORD = os.getenv("QUOTEX_PASSWORD", "").strip()
SSID = os.getenv("QUOTEX_SSID", "").strip()
COOKIES = os.getenv("QUOTEX_COOKIES", "").strip()
USER_AGENT = os.getenv(
    "QUOTEX_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
).strip()
HOST = os.getenv("QUOTEX_HOST", "qxbroker.com").strip()
ORIGINS = [
    x.strip()
    for x in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if x.strip()
]

app = FastAPI(title="Quotex Live Data Bridge")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def normalize_asset(symbol: str, mode: str) -> str:
    asset = symbol.replace("/", "").replace(" ", "").upper()
    if mode == "OTC" and not asset.lower().endswith("_otc"):
        asset += "_otc"
    return asset


def normalize_candles(raw: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    source = raw.values() if isinstance(raw, dict) else raw if isinstance(raw, list) else []

    for c in source:
        try:
            if isinstance(c, dict):
                t = c.get("time", c.get("from", c.get("timestamp")))
                o = c.get("open")
                close = c.get("close")
                h = c.get("high", c.get("max"))
                l = c.get("low", c.get("min"))
                volume = c.get("volume", 0) or 0
            elif isinstance(c, (list, tuple)) and len(c) >= 5:
                # Some Quotex-compatible candle payloads use:
                # [time, open, close, high, low]
                t, o, close, h, l = c[:5]
                volume = c[5] if len(c) > 5 else 0
            else:
                continue

            if None in (t, o, h, l, close):
                continue

            ts = float(t)
            rows.append(
                {
                    "time": int(ts) * 1000 if ts < 10_000_000_000 else int(ts),
                    "open": float(o),
                    "high": float(h),
                    "low": float(l),
                    "close": float(close),
                    "volume": float(volume or 0),
                }
            )
        except (TypeError, ValueError, IndexError):
            continue

    return sorted(
        {c["time"]: c for c in rows}.values(),
        key=lambda x: x["time"],
    )[-300:]


async def make_client(asset: str):
    # A fresh SSID lets the bridge skip the HTTP sign-in page. This is useful
    # when Quotex/Cloudflare returns HTTP 403 to datacenter-hosted login
    # requests. Keep the SSID private and store it only as a Render secret.
    if not SSID and (not EMAIL or not PASSWORD):
        raise RuntimeError(
            "Configure either QUOTEX_SSID or both QUOTEX_EMAIL and QUOTEX_PASSWORD "
            "on the Render server"
        )

    from pyquotex.stable_api import Quotex

    logger.info(
        "Connecting to Quotex: host=%s asset=%s auth=%s",
        HOST,
        asset,
        "SSID" if SSID else "EMAIL_PASSWORD",
    )
    client = Quotex(
        email=EMAIL,
        password=PASSWORD,
        host=HOST,
        lang="en",
        user_agent=USER_AGENT,
        asset_default=asset,
        period_default=60,
    )

    if SSID:
        client.set_session(
            user_agent=USER_AGENT,
            cookies=COOKIES or None,
            ssid=SSID,
        )
        logger.info(
            "Using configured Quotex SSID session (cookies=%s)",
            bool(COOKIES),
        )

    try:
        ok, reason = await client.connect()
    except Exception as exc:
        response = getattr(getattr(getattr(client, "api", None), "browser", None), "response", None)
        status_code = getattr(response, "status_code", None)
        if status_code == 403:
            raise RuntimeError(
                "Quotex rejected the Render access page with HTTP 403. "
                "Use a fresh QUOTEX_SSID session or run the bridge from a network "
                "where Quotex accepts the connection."
            ) from exc
        raise RuntimeError(f"Quotex connection error: {exc}") from exc

    logger.info("Quotex connect result: ok=%s reason=%s", ok, reason)

    if not ok:
        raise RuntimeError(f"Quotex connection failed: {reason}")

    return client


@app.get("/")
async def root():
    return {"ok": True, "service": "quotex-live-data-bridge", "websocket": "/ws"}


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "quotex-live-data-bridge",
        "quotex_credentials_configured": bool(EMAIL and PASSWORD),
        "quotex_ssid_configured": bool(SSID),
        "quotex_cookies_configured": bool(COOKIES),
        "host": HOST,
    }


@app.websocket("/ws")
async def websocket_feed(ws: WebSocket):
    await ws.accept()
    client = None
    asset = None
    timeframe = 60

    try:
        logger.info("Browser WebSocket connected")
        request = await ws.receive_json()
        logger.info("Browser subscription request: %s", request)

        if request.get("type") != "subscribe":
            await ws.send_json(
                {"type": "error", "message": "First message must be subscribe"}
            )
            await ws.close()
            return

        mode = str(request.get("mode", "REGULAR")).upper()
        asset = normalize_asset(str(request.get("symbol", "EUR/USD")), mode)
        timeframe = int(request.get("timeframe", 60))

        if timeframe not in (5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600):
            timeframe = 60

        client = await make_client(asset)

        # Resolve the exact asset name used by the current Quotex session.
        resolved_asset, asset_status = await client.get_available_asset(asset, force_open=False)
        logger.info("Asset resolution: requested=%s resolved=%s status=%s", asset, resolved_asset, asset_status)

        if not asset_status or len(asset_status) < 3 or not asset_status[2]:
            resolved_asset, asset_status = await client.get_available_asset(asset, force_open=True)
            logger.info("Asset OTC fallback: resolved=%s status=%s", resolved_asset, asset_status)

        if not asset_status or len(asset_status) < 3 or not asset_status[2]:
            raise RuntimeError(f"Quotex asset is unavailable: {asset}")

        asset = resolved_asset

        # Quotex returns at most 199 candles per history request.
        history = await client.get_candles(
            asset,
            time.time(),
            min(timeframe * 199, 11940),
            timeframe,
        )
        snapshot = normalize_candles(history)
        logger.info("Historical candles received: %d for %s", len(snapshot), asset)

        if not snapshot:
            raise RuntimeError(f"Quotex returned no candles for {asset}")

        await ws.send_json(
            {
                "type": "snapshot",
                "symbol": asset,
                "candles": snapshot,
            }
        )

        # IMPORTANT: pyquotex requires the realtime candle stream to be
        # explicitly subscribed before get_realtime_candles() is read.
        # pyquotex 1.1.0 starts the subscription asynchronously and returns
        # None on success. Do NOT treat a falsy return value as a failure.
        await client.start_candles_stream(asset, timeframe)
        logger.info(
            "Realtime candle subscription requested: asset=%s timeframe=%ss",
            asset,
            timeframe,
        )

        last_signature = None

        while True:
            raw = await client.get_realtime_candles(asset)
            candles = normalize_candles(raw)

            if candles:
                signature = (
                    candles[-1]["time"],
                    candles[-1]["open"],
                    candles[-1]["high"],
                    candles[-1]["low"],
                    candles[-1]["close"],
                )

                if signature != last_signature:
                    last_signature = signature
                    await ws.send_json(
                        {
                            "type": "candles",
                            "symbol": asset,
                            "candles": candles,
                        }
                    )

            await asyncio.sleep(0.25)

    except WebSocketDisconnect:
        logger.info("Browser WebSocket disconnected asset=%s", asset)
    except Exception as exc:
        logger.exception("Quotex bridge error")
        try:
            await ws.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        if client is not None and asset is not None:
            try:
                await client.stop_candles_stream(asset)
            except Exception:
                pass
            try:
                await client.close()
            except Exception:
                logger.exception("Error closing Quotex client")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "quotex_bridge:app",
        host=os.getenv("BRIDGE_HOST", "0.0.0.0"),
        port=int(os.getenv("BRIDGE_PORT", "8000")),
        reload=False,
    )
