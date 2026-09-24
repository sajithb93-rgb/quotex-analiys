# Quotex Smart Analysis

Separate web dashboard for Regular + OTC analysis on a 1-minute chart.

Included: responsive dark UI, Regular/OTC mode, 1M, lightweight SVG candles, HH/HL/LH/LL labels, BOS/CHoCH, FVG zones, BUY/SELL/WAIT panel, bounded realtime candle engine and adapter boundary.

The current browser build uses a local realtime stream simulator so the rendering path can be tested without pretending to have direct Quotex feed access. For production-live data, connect an authorized/supported Regular or OTC source to the normalized OHLC adapter. Do not scrape, bypass authentication, or reverse-engineer a private Quotex websocket/API.

Performance: bounded visible candles, lightweight SVG, memoized structure analysis, and only the current candle is updated between 1-minute closes. React memoization/caching and non-blocking update patterns are used where useful.

Run: npm install && npm run dev
Build: npm run build

Analysis software is decision-support only and does not guarantee trading outcomes.
