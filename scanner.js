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


  function stddev(values) {
    const xs = values.filter(Number.isFinite);
    if (!xs.length) return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s,x)=>s+(x-m)**2,0)/xs.length);
  }

  function emaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    if (values.length < period) return out;
    const k = 2/(period+1);
    let seed = mean(values.slice(0,period));
    out[period-1] = seed;
    for (let i=period;i<values.length;i++) {
      seed = values[i]*k + seed*(1-k);
      out[i] = seed;
    }
    return out;
  }

  function mostRecentBollinger(rows, scanDays, direction="up") {
    const period=20, mult=2;
    let match=null;
    const start=Math.max(period, rows.length-scanDays);
    for (let i=start;i<rows.length;i++) {
      const vals=rows.slice(i-period+1,i+1).map(r=>r.close);
      const prevVals=rows.slice(i-period,i).map(r=>r.close);
      if (vals.length<period || prevVals.length<period) continue;
      const m=mean(vals), sd=stddev(vals), pm=mean(prevVals), psd=stddev(prevVals);
      const upper=m+mult*sd, lower=m-mult*sd, pUpper=pm+mult*psd, pLower=pm-mult*psd;
      const crossed = direction==="up"
        ? rows[i].close>upper && rows[i-1].close<=pUpper
        : rows[i].close<lower && rows[i-1].close>=pLower;
      if (crossed) match={date:rows[i].date, close:rows[i].close, band:direction==="up"?upper:lower};
    }
    return match;
  }

  function mostRecentMACDCross(rows, scanDays, direction="bull") {
    const closes=rows.map(r=>r.close);
    const e12=emaSeries(closes,12), e26=emaSeries(closes,26);
    const macd=closes.map((_,i)=>(Number.isFinite(e12[i])&&Number.isFinite(e26[i]))?e12[i]-e26[i]:null);
    const compact=macd.map(v=>Number.isFinite(v)?v:0);
    const signal=emaSeries(compact,9);
    let match=null;
    const start=Math.max(35,rows.length-scanDays);
    for(let i=start;i<rows.length;i++){
      if (![macd[i],macd[i-1],signal[i],signal[i-1]].every(Number.isFinite)) continue;
      const crossed=direction==="bull"
        ? macd[i]>signal[i] && macd[i-1]<=signal[i-1]
        : macd[i]<signal[i] && macd[i-1]>=signal[i-1];
      if(crossed) match={date:rows[i].date, macd:macd[i], signal:signal[i]};
    }
    return match;
  }

  function mostRecentMovingAverageCross(rows, scanDays, direction="golden") {
    let match=null;
    const start=Math.max(200,rows.length-scanDays);
    for(let i=start;i<rows.length;i++){
      const f=smaAt(rows,50,i), s=smaAt(rows,200,i), pf=smaAt(rows,50,i-1), ps=smaAt(rows,200,i-1);
      if (![f,s,pf,ps].every(Number.isFinite)) continue;
      const crossed=direction==="golden" ? f>s && pf<=ps : f<s && pf>=ps;
      if(crossed) match={date:rows[i].date,sma50:f,sma200:s};
    }
    return match;
  }

  function mostRecentUnusualVolume(rows, scanDays, multiplier=2) {
    let match=null;
    const start=Math.max(20,rows.length-scanDays);
    for(let i=start;i<rows.length;i++){
      const avg=mean(rows.slice(i-20,i).map(r=>r.volume));
      if (Number.isFinite(avg) && avg>0 && rows[i].volume>=avg*multiplier) {
        match={date:rows[i].date,volume:rows[i].volume,avg20:avg,multiple:rows[i].volume/avg};
      }
    }
    return match;
  }

  function mostRecent52WeekBreakout(rows, scanDays) {
    let match=null;
    const start=Math.max(252,rows.length-scanDays);
    for(let i=start;i<rows.length;i++){
      const prior=rows.slice(i-252,i);
      if(prior.length<252) continue;
      const priorHigh=Math.max(...prior.map(r=>r.high));
      if(rows[i].close>priorHigh) match={date:rows[i].date,close:rows[i].close,priorHigh};
    }
    return match;
  }

  function mostRecentVolumeBreakout(rows, scanDays, multiplier=1.5) {
    let match=null;
    const start=Math.max(20,rows.length-scanDays);
    for(let i=start;i<rows.length;i++){
      const prior=rows.slice(i-20,i);
      if(prior.length<20) continue;
      const priorHigh=Math.max(...prior.map(r=>r.high));
      const avgVol=mean(prior.map(r=>r.volume));
      if(rows[i].close>priorHigh && rows[i].volume>=avgVol*multiplier){
        match={date:rows[i].date,close:rows[i].close,priorHigh,volume:rows[i].volume,avg20:avgVol,multiple:rows[i].volume/avgVol};
      }
    }
    return match;
  }

  function currentStreak(rows) {
    if (rows.length<2) return {direction:"flat",days:0};
    let dir=null, days=0;
    for(let i=rows.length-1;i>0;i--){
      const d=rows[i].close-rows[i-1].close;
      const here=d>0?"green":d<0?"red":"flat";
      if(!dir) dir=here;
      if(here!==dir || here==="flat") break;
      days++;
    }
    return {direction:dir||"flat",days};
  }

  function codexScore(item) {
    let score=50;
    if (Number.isFinite(item.netIncome)) score += item.netIncome>0 ? 10 : -15;
    if (Number.isFinite(item.revenueGrowth)) score += item.revenueGrowth>0 ? Math.min(8,item.revenueGrowth/5) : -5;
    if (Number.isFinite(item.roe)) score += item.roe>=10 ? Math.min(6,item.roe/5) : 0;
    if (Number.isFinite(item.debtEquity) && item.debtEquity>2) score -= 5;
    const t=item.tech||{};
    if (t.price>t.sma200) score+=7; else if(Number.isFinite(t.sma200)) score-=6;
    if (t.sma20>t.sma50 && t.sma50>t.sma200) score+=7;
    if (Number.isFinite(t.rsi14)) {
      if (t.rsi14>=45 && t.rsi14<=70) score+=5;
      if (t.rsi14>80) score-=5;
      if (t.rsi14<30) score-=2;
    }
    if (Number.isFinite(t.pctFromHigh) && t.pctFromHigh<=10) score+=4;
    if ((item.dividendYield||0)>0) score+=2;
    const s=item.signals||{};
    ["golden","gapUp","bollingerUp","goldenCross","macdBull","unusualVolume","breakout52","volumeBreakout"].forEach(k=>{if(s[k])score+=3;});
    ["gapDown","bollingerDown","deathCross","macdBear"].forEach(k=>{if(s[k])score-=3;});
    return Math.max(0,Math.min(100,Math.round(score)));
  }

  function requiredSignalPass(signals, required) {
    if(!required || required==="any") return true;
    const map={
      golden:"golden",gapup:"gapUp",gapdown:"gapDown",
      bollingerup:"bollingerUp",bollingerdown:"bollingerDown",
      goldencross:"goldenCross",deathcross:"deathCross",
      macdbull:"macdBull",macdbear:"macdBear",
      unusualvolume:"unusualVolume",breakout52:"breakout52",volbreakout:"volumeBreakout"
    };
    return Boolean(signals[map[required]]);
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


  function median(values) {
    const a = values.filter(Number.isFinite).slice().sort((x,y)=>x-y);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid-1] + a[mid]) / 2;
  }

  function weekdayName(dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getUTCDay()];
  }

  function isoWeekKey(dateStr) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}`;
  }

  function weekdayAnalysis(rows, lookback=252) {
    const relevant = rows.slice(-Number(lookback || 252));
    const names = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
    const byDay = Object.fromEntries(names.map(n => [n, {
      day:n, sessions:0, opens:[], lows:[], closes:[], weeklyLowWins:0
    }]));

    for (const r of relevant) {
      const name = weekdayName(r.date);
      if (!byDay[name]) continue;
      byDay[name].sessions++;
      byDay[name].opens.push(r.open);
      byDay[name].lows.push(r.low);
      byDay[name].closes.push(r.close);
    }

    const weeks = new Map();
    for (const r of relevant) {
      const name = weekdayName(r.date);
      if (!byDay[name]) continue;
      const key = isoWeekKey(r.date);
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key).push({name, low:r.low, date:r.date});
    }
    for (const arr of weeks.values()) {
      if (!arr.length) continue;
      const minLow = Math.min(...arr.map(x=>x.low));
      const winners = arr.filter(x=>Math.abs(x.low-minLow) < 1e-9);
      for (const w of winners) byDay[w.name].weeklyLowWins++;
    }

    const stats = names.map(name => {
      const x = byDay[name];
      return {
        day:name,
        sessions:x.sessions,
        avgOpen:mean(x.opens),
        medianOpen:median(x.opens),
        avgLow:mean(x.lows),
        medianLow:median(x.lows),
        avgClose:mean(x.closes),
        medianClose:median(x.closes),
        weeklyLowWins:x.weeklyLowWins,
        weeklyLowRate: weeks.size ? (x.weeklyLowWins / weeks.size) * 100 : null
      };
    });

    const eligible = stats.filter(x=>x.sessions>0);
    const bestAvgLow = eligible.length ? eligible.reduce((a,b)=>(b.avgLow < a.avgLow ? b : a)) : null;
    const bestMedianLow = eligible.length ? eligible.reduce((a,b)=>(b.medianLow < a.medianLow ? b : a)) : null;
    const mostWeeklyWins = eligible.length ? eligible.reduce((a,b)=>(b.weeklyLowWins > a.weeklyLowWins ? b : a)) : null;

    let verdict = null;
    if (eligible.length) {
      const scores = Object.fromEntries(names.map(n=>[n,0]));
      if (bestAvgLow) scores[bestAvgLow.day] += 1;
      if (bestMedianLow) scores[bestMedianLow.day] += 1;
      if (mostWeeklyWins) scores[mostWeeklyWins.day] += 1;
      verdict = eligible
        .slice()
        .sort((a,b)=>(scores[b.day]-scores[a.day]) || (a.avgLow-b.avgLow))[0];
    }

    return {
      lookback:Number(lookback || 252),
      weeks:weeks.size,
      stats,
      bestAvgLow:bestAvgLow?.day || null,
      bestMedianLow:bestMedianLow?.day || null,
      mostWeeklyWins:mostWeeklyWins?.day || null,
      verdict:verdict?.day || null
    };
  }

  function analyzeStock(fundamental, rawRows, benchmarkRows, cfg) {
    const rows = normalizeRows(rawRows);
    if (rows.length < 60) return null;
    const tech = currentTechnicals(rows);
    const betaValue = beta(rows, benchmarkRows, Number(cfg.betaLookback || 252));
    const gaps = mostRecentGap(rows, Number(cfg.scanDays), Number(cfg.gapThreshold));
    const signals = {
      golden: mostRecentGoldenStar(rows, Number(cfg.scanDays), Number(cfg.goldenTolerance)),
      gapUp: gaps.up,
      gapDown: gaps.down,
      bollingerUp: mostRecentBollinger(rows, Number(cfg.scanDays), "up"),
      bollingerDown: mostRecentBollinger(rows, Number(cfg.scanDays), "down"),
      goldenCross: mostRecentMovingAverageCross(rows, Number(cfg.scanDays), "golden"),
      deathCross: mostRecentMovingAverageCross(rows, Number(cfg.scanDays), "death"),
      macdBull: mostRecentMACDCross(rows, Number(cfg.scanDays), "bull"),
      macdBear: mostRecentMACDCross(rows, Number(cfg.scanDays), "bear"),
      unusualVolume: mostRecentUnusualVolume(rows, Number(cfg.scanDays), Number(cfg.unusualVolumeMultiplier || 2)),
      breakout52: mostRecent52WeekBreakout(rows, Number(cfg.scanDays)),
      volumeBreakout: mostRecentVolumeBreakout(rows, Number(cfg.scanDays), Number(cfg.breakoutVolumeMultiplier || 1.5))
    };
    const item = {
      ...fundamental,
      rows,
      tech,
      beta:betaValue,
      weekday:weekdayAnalysis(rows, Number(cfg.weekdayLookback || 252)),
      streak:currentStreak(rows),
      signals
    };
    item.codexScore = codexScore(item);
    return passesTechnicalFilters(item,cfg) && requiredSignalPass(signals,cfg.requiredSignal) ? item : null;
  }

  return { normalizeRows, analyzeStock, weekdayAnalysis };
})();
