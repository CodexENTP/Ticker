# Codex Analytics Market Scanner v6

Dual-mode GitHub Pages app:

- **Manual Scan** (`/manual/`) — restored to the original V1 filter-first scanner workflow, with Codex Score, broader bullish signal tagging, a dedicated Bearish Signals column, support/resistance context, and strict Abandoned Baby detection.
- **Market Scanner** (`/scanner/`) — guided strategy scanner retained from v5.

## Manual Scan v6 changes

The Manual Scan no longer revolves around gap-up/gap-down events. All stocks that pass the selected V1-style fundamental/technical filters can appear in results.

Primary signal views:
1. MACD Bullish Cross
2. RSI Oversold Reversal
3. Bollinger Bullish Signal (upper-band breakout or lower-band reclaim)

Additional bullish tags can include Early Golden Cross, Golden Star (secondary only), Bullish Abandoned Baby, Bullish Engulfing, Hammer at Support, and Support Bounce.

Bearish/caution tags can include MACD Bear Cross, RSI Overbought Rollover, Bollinger Breakdown/Rejection, Bearish Abandoned Baby, Bearish Engulfing, Shooting Star, Support Breakdown, and Below SMA200.

### Abandoned Baby
The detector uses the strict definition: the middle doji must be fully isolated from both neighboring candles, including **no wick/shadow overlap**. Bullish occurrences are also checked for proximity to detected support; bearish occurrences are checked against resistance.

### Codex Score
A 0–100 heuristic ranking aid that considers profitability, valuation, trend, RSI, 52-week position, bullish confirmations, and bearish warnings. It is not a prediction or investment recommendation.

## API key
The home page and both scanners share the same local-storage API key (`codex-bq-key`). The key remains in the browser only.

## GitHub Pages deployment
Replace the repository contents with the contents of this ZIP, preserving the `/manual/` and `/scanner/` folders. Publish from the repository root.
