# Codex Analytics Market Scanner v4

A static GitHub Pages stock research scanner using Business Quant for market/fundamental/history data and local browser calculations for technical analysis.

## What changed in v4

- Simplified four-mode start screen:
  - Best Opportunities
  - Gap-Fill Reversal
  - Early Golden Cross
  - Build My Scan
- Quiz-guided filtering instead of exposing every technical control.
- Business Quant free-tier budget tracker (30 calls/day as documented when this build was designed).
- Local caching:
  - Universe: 24 hours
  - Screener metadata: 7 days
  - Quote batches: current browser session / up to 12 hours
- Fundamental pre-screen before historical downloads.
- Gap-Fill Reversal engine:
  - positive net income required
  - prior bullish gap-up
  - configurable age/range
  - open/unfilled gap detection
  - downtrend/pullback confirmation
  - RSI recovery
  - MACD improvement/crossover
  - optional technical confirmations
- Early Golden Cross only (no regular Golden Cross preset): SMA50 below but rising toward SMA200 with narrowing distance.
- Wilder-style RSI(14).
- Correctly aligned MACD 12/26/9 calculation.
- Optional confirmations calculated locally: RSI bullish divergence, Bollinger reversal, unusual volume, higher low, bullish engulfing, SMA20 reclaim, MACD crossover, Early Golden Cross.
- Strategy-aware Codex subscores: Quality, Value, Trend, Momentum, Reversal, Risk.
- Matches / Near Matches / All Analyzed.
- “Why this matched” detail explanation.
- Compact price chart with SMA20/SMA50/SMA200 and gap-zone shading.
- Local watchlist.
- Local scan history.
- Saved scan profile storage foundation.
- CSV export.
- ROE metadata aliases include `Return on Equity (Yr)` / `ROE (Yr)` rather than a generic ROI field.

## Deploy to GitHub Pages

1. Create or open your GitHub repository.
2. Replace the existing app files with everything in this ZIP.
3. Commit/push to the `main` branch.
4. In GitHub: **Settings → Pages → Deploy from a branch → main → /(root)**.
5. Open the Pages URL.
6. Go to **Settings**, enter your Business Quant API key, and click **Save & Test**.

## API notes

The API key is stored only in browser localStorage by this static build. Do not commit a key into the repository.

If Business Quant's own direct endpoint rejects your key as invalid, the app cannot correct that account-side problem. If a direct endpoint works but the app reports “Failed to fetch,” browser CORS may require a proxy architecture.

The on-screen API count tracks calls made by this browser. Business Quant remains the authority for actual quota usage.

## Research disclaimer

Codex scores and technical detections are research heuristics, not investment recommendations or validated predictive models. Confirm market data and any trade decision independently.
