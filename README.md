# Codex Analytics Market Scanner

A GitHub Pages-friendly NYSE/NASDAQ stock research terminal using the Codex Analytics visual system.

## Core universe

- NYSE equities
- NASDAQ equities
- OTC / pink-sheet securities excluded by exchange before analysis

## User-friendly workflow

1. Choose a **Strategy** preset or leave it on Custom.
2. Choose how recently signals must have occurred.
3. Click **Scan Market**.
4. Use the single **Results** dropdown to move between signal lists.
5. Click a stock for detailed fundamentals, technical signals, and Best Day to Buy analysis.

Advanced filters are organized into collapsible sections so the main workflow stays simple.

## Strategy presets

- Quality & Profitability
- Value
- Dividend Income
- Momentum
- Breakout Candidates
- Lower Volatility
- Profitable Small Cap
- Custom

Every preset simply fills transparent filters; you can change any value afterward.

## Fundamental filters

- Positive / negative / any net income
- Price
- Market capitalization
- P/E
- Sector
- Revenue growth
- Return on equity
- Debt / equity
- Free cash flow
- Dividend payer
- Dividend yield

Some advanced fundamental metrics depend on which screener metrics your Business Quant API account exposes. If a selected metric is unavailable, the app tells you instead of silently ignoring the filter.

## Technical filters

- Beta range and lookback
- Distance from 52-week high / low
- 20-day average volume
- RSI 14
- SMA 20 / 50 / 200 trend filters
- Best Day to Buy weekday lookback

## Signal scanners

- Golden Star (custom transparent approximation)
- Gap Up / Gap Down
- Golden Cross / Death Cross
- Bollinger Band Breakout / Breakdown
- MACD Bullish / Bearish Cross
- Unusual Volume
- 52-Week Breakout
- Volume-Confirmed 20-Day Breakout

The signal lookback is controlled independently from the weekday-analysis lookback.

## Codex Score

Each result receives a transparent 0–100 ranking based on a mix of:

- Profitability
- Revenue growth / ROE when available
- Debt level when available
- Price above long-term trend
- Bullish moving-average structure
- RSI condition
- Proximity to the 52-week high
- Dividend status
- Bullish and bearish technical signals

It is a research ranking, not an investment recommendation or expected-return forecast.

## Best Day to Buy

For Monday through Friday, the stock detail screen calculates:

- Average open
- Average intraday low
- Median intraday low
- Average close
- Number of weeks where that weekday produced the week's lowest intraday price
- Weekly-low win rate

The displayed Best Day to Buy is a descriptive historical composite, not a prediction.

## Data source

The app is written for the Business Quant API:

- `/universe`
- `/metadata?table=screener`
- `/screener`
- `/quotes`

Your API key is stored only in your browser's localStorage. Do not commit an API key to GitHub.

## GitHub Pages

Upload all files in this ZIP to the root of your repository, replacing the prior version. Then use:

**Settings → Pages → Deploy from a branch → main → /(root)**

## Files

- `index.html`
- `styles.css`
- `api.js`
- `scanner.js`
- `app.js`
- `codex-ca.png`
- `codex-word.png`
- `README.md`
- `.gitignore`

## Disclaimer

This application is a market research tool, not individualized investment advice. Historical patterns and technical signals can fail or reverse, and market/fundamental data can be delayed or inaccurate. Do your own due diligence before trading.
