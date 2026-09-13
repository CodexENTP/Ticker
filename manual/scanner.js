const MarketScanner = (() => {
  const SMA_FAST = 20;
  const SMA_SLOW = 50;
  const SMA_LONG = 200;

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a,b)=>a+b,0) / values.length;
  }

  function smaAt(rows, period, idx) {
    if (idx < period - 1) return null;
    const slice = rows.slice(idx - period + 1, idx + 1).map(r => Number(r.close)).filter(Number.isFinite);
    return slice.length === period ? mean(slice) : null;
  }

  function rsi(rows, period=14) {
    if (rows.length < period + 1) return null;
    const data = rows.slice(-(period + 1));
    let gains = 0, losses = 0;
    for (let i=1;i<data.length;i++) {
      const d = Number(data[i].close) - Number(data[i-1].close);
      if (d > 0) gains += d; else losses -= d;
    }
    const avgGain = gains / period, avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  function returnsByDate(rows) {
    const out = new Map();
    for (let i=1;i<rows.length;i++) {
      const a = Number(rows[i-1].close), b = Number(rows[i].close);
      if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) {
        out.set(dateOnly(rows[i].date), (b / a) - 1);
      }
    }
    return out;
  }

  function beta(stockRows, benchmarkRows, lookback=252) {
    const sr = returnsByDate(stockRows);
    const br = returnsByDate(benchmarkRows);
    const dates = [...sr.keys()].filter(d => br.has(d)).slice(-lookback);
    if (dates.length < Math.min(30, lookback)) return null;
    const xs = dates.map(d => br.get(d));
    const ys = dates.map(d => sr.get(d));
    const mx = mean(xs), my = mean(ys);
    let cov = 0, variance = 0;
    for (let i=0;i<dates.length;i++) {
      cov += (xs[i]-mx) * (ys[i]-my);
      variance += (xs[i]-mx) ** 2;
    }
    return variance === 0 ? null : cov / variance;
  }

  function dateOnly(v) {
    return String(v || "").slice(0,10);
  }

  function normalizeRows(raw) {
    return (raw || [])
      .map(r => ({
        date: dateOnly(r.date),
        open:Number(r.open), high:Number(r.high), low:Number(r.low),
        close:Number(r.close), volume:Number(r.volume)
      }))
      .filter(r => r.date && [r.open,r.high,r.low,r.close].every(Number.isFinite))
      .sort((a,b)=>a.date.localeCompare(b.date));
  }

  function pct(a,b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return ((a - b) / b) * 100;
  }

  function mostRecentGap(rows, scanDays, threshold) {
    const start = Math.max(1, rows.length - scanDays);
    let up = null, down = null;
    for (let i=start;i<rows.length;i++) {
      const prevClose = rows[i-1].close;
      const gap = pct(rows[i].open, prevClose);
      if (gap === null) continue;
      const record = {date:rows[i].date, gapPct:gap, open:rows[i].open, priorClose:prevClose};
      if (gap >= threshold) up = record;
      if (gap <= -threshold) down = record;
    }
    return {up, down};
  }

  /*
    Golden Star (Custom) — transparent approximation, NOT StockInvest.us's proprietary formula.

    A day qualifies when:
    1) Close, SMA20 and SMA50 form a tight cluster. The max distance from the cluster
       center must be <= the user-defined tolerance.
    2) SMA20 is rising compared with 5 sessions earlier.
    3) SMA50 is flat-to-rising compared with 5 sessions earlier.
    4) Close is above its close 5 sessions earlier.
    5) SMA20 is not materially below SMA50 (allows an early signal around the crossover).

    This intentionally searches for the "price + short MA + long MA meet while strengthening"
    concept without claiming to reproduce a proprietary signal.
  */
  function mostRecentGoldenStar(rows, scanDays, tolerancePct) {
    const start = Math.max(SMA_SLOW + 5, rows.length - scanDays);
    let match = null;
    for (let i=start;i<rows.length;i++) {
      const c = rows[i].close;
      const f = smaAt(rows, SMA_FAST, i);
      const s = smaAt(rows, SMA_SLOW, i);
      const f5 = smaAt(rows, SMA_FAST, i-5);
      const s5 = smaAt(rows, SMA_SLOW, i-5);
      if (![c,f,s,f5,s5].every(Number.isFinite)) continue;

      const center = (c + f + s) / 3;
      const spread = ((Math.max(c,f,s) - Math.min(c,f,s)) / center) * 100;
      const fastRising = f > f5;
      const slowNotFalling = s >= s5 * 0.998;
      const priceRising = c > rows[i-5].close;
      const fastNearOrAboveSlow = f >= s * 0.99;

      if (spread <= tolerancePct && fastRising && slowNotFalling && priceRising && fastNearOrAboveSlow) {
        match = { date:rows[i].date, spreadPct:spread, close:c, sma20:f, sma50:s };
      }
    }
    return match;
  }

  function currentTechnicals(rows) {
    if (!rows.length) return {};
    const i = rows.length - 1;
    const latest = rows[i];
    const trailing252 = rows.slice(-252);
    const high52 = trailing252.length ? Math.max(...trailing252.map(r=>r.high)) : null;
    const low52 = trailing252.length ? Math.min(...trailing252.map(r=>r.low)) : null;
    const avgVol20 = mean(rows.slice(-20).map(r=>r.volume).filter(Number.isFinite));
    const sma20 = smaAt(rows,20,i);
    const sma50 = smaAt(rows,50,i);
    const sma200 = smaAt(rows,200,i);
    return {
      price:latest.close,
      date:latest.date,
      high52, low52,
      pctFromHigh: high52 ? ((high52-latest.close)/high52)*100 : null,
      pctAboveLow: low52 ? ((latest.close-low52)/low52)*100 : null,
      avgVol20,
      rsi14:rsi(rows,14),
      sma20,sma50,sma200
    };
  }

  function passesTechnicalFilters(item, cfg) {
    const t = item.tech;
    const n = v => v === "" || v === null || v === undefined ? null : Number(v);
    const minBeta=n(cfg.minBeta), maxBeta=n(cfg.maxBeta), nearHigh=n(cfg.nearHigh), nearLow=n(cfg.nearLow);
    const minVol=n(cfg.minAvgVolume), minR=n(cfg.minRSI), maxR=n(cfg.maxRSI);
    if (minBeta !== null && !(item.beta >= minBeta)) return false;
    if (maxBeta !== null && !(item.beta <= maxBeta)) return false;
    if (nearHigh !== null && !(t.pctFromHigh <= nearHigh)) return false;
    if (nearLow !== null && !(t.pctAboveLow <= nearLow)) return false;
    if (minVol !== null && !(t.avgVol20 >= minVol)) return false;
    if (minR !== null && !(t.rsi14 >= minR)) return false;
    if (maxR !== null && !(t.rsi14 <= maxR)) return false;

    switch(cfg.trendFilter){
      case "above20": if (!(t.price > t.sma20)) return false; break;
      case "above50": if (!(t.price > t.sma50)) return false; break;
      case "above200": if (!(t.price > t.sma200)) return false; break;
      case "bullstack": if (!(t.sma20 > t.sma50 && t.sma50 > t.sma200)) return false; break;
    }
    return true;
  }

  function analyzeStock(fundamental, rawRows, benchmarkRows, cfg) {
    const rows = normalizeRows(rawRows);
    if (rows.length < 60) return null;
    const tech = currentTechnicals(rows);
    const betaValue = beta(rows, benchmarkRows, Number(cfg.betaLookback || 252));
    const gaps = mostRecentGap(rows, Number(cfg.scanDays), Number(cfg.gapThreshold));
    const golden = mostRecentGoldenStar(rows, Number(cfg.scanDays), Number(cfg.goldenTolerance));
    const item = {
      ...fundamental,
      rows,
      tech,
      beta:betaValue,
      signals:{golden, gapUp:gaps.up, gapDown:gaps.down}
    };
    return passesTechnicalFilters(item,cfg) ? item : null;
  }

  return { normalizeRows, analyzeStock };
})();
