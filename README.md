# Quotex Smart Analysis

This dashboard renders actual Quotex candle data through a server-side adapter. The browser does not generate synthetic/random prices in live mode.

## Live architecture

Browser (Vite/React) -> WebSocket -> `server/quotex_bridge.py` -> Quotex session -> live candle stream.

The bridge uses the open-source **PyQuotex** client as an unofficial integration layer. PyQuotex documents WebSocket connectivity, historical candles, and real-time candle subscriptions, but it is not an official Quotex API. Its behavior can change if Quotex changes its private protocol or access controls.

## 1. Start the bridge

Requirements: Python 3.12+.

```bash
cd server
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Put the Quotex account credentials only in `server/.env`. Never put them in `VITE_*` variables or frontend source code.

Then:

```bash
python quotex_bridge.py
```

The bridge listens on `ws://localhost:8000/ws`.

## 2. Point the frontend to the bridge

Create `.env.local` in the project root:

```bash
VITE_QUOTEX_WS_URL=ws://localhost:8000/ws
```

Then run:

```bash
npm install
npm run dev
```

## 3. Deployment

The React/Vite frontend can be deployed to Vercel, but the persistent Quotex WebSocket bridge should run as a separate long-lived Python service. Set `VITE_QUOTEX_WS_URL` to that bridge's secure `wss://.../ws` endpoint.

## Security

Do not commit `.env` or account credentials. The bridge is data-only in this implementation; it does not expose trade placement endpoints.

## Data behavior

- No random/synthetic candles are generated in live mode.
- Historical candles are loaded first, then the real-time candle stream updates the chart.
- Changing symbol or Regular/OTC reconnects the feed.
- SMC/FVG/pressure analysis consumes the same candle array shown on the chart.
- If the bridge is offline or not configured, the dashboard intentionally shows an empty chart instead of pretending simulated prices are Quotex prices.