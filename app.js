(() => {
  const $ = id => document.getElementById(id);
  const state = { results:[], activeTab:"all", universe:null, metadata:null, running:false };

  const fmt = {
    money(v){
      if (!Number.isFinite(Number(v))) return "—";
      const n=Number(v);
      if (Math.abs(n)>=1e12) return "$"+(n/1e12).toFixed(2)+"T";
      if (Math.abs(n)>=1e9) return "$"+(n/1e9).toFixed(2)+"B";
      if (Math.abs(n)>=1e6) return "$"+(n/1e6).toFixed(1)+"M";
      return "$"+n.toLocaleString(undefined,{maximumFractionDigits:0});
    },
    price(v){ return Number.isFinite(Number(v)) ? "$"+Number(v).toFixed(2) : "—"; },
    num(v,d=2){ return Number.isFinite(Number(v)) ? Number(v).toFixed(d) : "—"; },
    pct(v,d=2){ return Number.isFinite(Number(v)) ? Number(v).toFixed(d)+"%" : "—"; },
    int(v){ return Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString() : "—"; }
  };

  function apiKey(){ return localStorage.getItem("codex_bq_api_key") || ""; }

  function setStatus(kind,title,text,progress=null){
    $("statusDot").className=`status-dot ${kind}`;
    $("statusTitle").textContent=title;
    $("statusText").textContent=text;
    if (progress === null) {
      $("progressWrap").classList.add("hidden");
    } else {
      $("progressWrap").classList.remove("hidden");
      const p=Math.max(0,Math.min(100,progress));
      $("progressBar").style.width=p+"%";
      $("progressLabel").textContent=Math.round(p)+"%";
    }
  }

  function getConfig(){
    return {
      nyse:$("exchangeNYSE").checked,
      nasdaq:$("exchangeNASDAQ").checked,
      candidateLimit:$("candidateLimit").value,
      scanDays:$("scanDays").value,
      profitability:$("profitability").value,
      minPrice:$("minPrice").value, maxPrice:$("maxPrice").value,
      minMarketCap:$("minMarketCap").value, maxPE:$("maxPE").value,
      sector:$("sector").value,
      minRevenueGrowth:$("minRevenueGrowth").value,
      minROE:$("minROE").value,
      maxDebtEquity:$("maxDebtEquity").value,
      fcfFilter:$("fcfFilter").value,
      minDivYield:$("minDivYield").value, maxDivYield:$("maxDivYield").value,
      dividendPayer:$("dividendPayer").value,
      minBeta:$("minBeta").value, maxBeta:$("maxBeta").value,
      betaLookback:$("betaLookback").value,
      weekdayLookback:$("weekdayLookback").value,
      nearHigh:$("nearHigh").value, nearLow:$("nearLow").value,
      minAvgVolume:$("minAvgVolume").value,
      minRSI:$("minRSI").value, maxRSI:$("maxRSI").value,
      trendFilter:$("trendFilter").value,
      gapThreshold:$("gapThreshold").value,
      goldenTolerance:$("goldenTolerance").value,
      unusualVolumeMultiplier:$("unusualVolumeMultiplier").value,
      breakoutVolumeMultiplier:$("breakoutVolumeMultiplier").value,
      requiredSignal:$("requiredSignal").value
    };
  }

  function metricSet(metadata){
    const arr = Array.isArray(metadata) ? metadata : (metadata?.data || []);
    return new Set(arr.map(x=>x.metric_full));
  }

  function pickMetric(set, candidates){
    return candidates.find(x=>set.has(x)) || null;
  }

  function buildFundamentalQuery(cfg, metadata){
    const set=metricSet(metadata);
    const m={
      marketCap:pickMetric(set,["Market Capitalization","Market Cap"]),
      netIncome:pickMetric(set,["Net Income (Yr)","Net Income (TTM)","Net Income"]),
      pe:pickMetric(set,["P/E Ratio","PE Ratio"]),
      divYield:pickMetric(set,["Dividend Yield"]),
      revenueGrowth:pickMetric(set,["Revenue Growth (YoY)","Revenue Growth YoY","Revenue Growth","Revenue Growth %"]),
      roe:pickMetric(set,["Return on Equity","ROE","Return On Equity"]),
      debtEquity:pickMetric(set,["Debt / Equity","Debt to Equity","Debt/Equity Ratio","Debt To Equity"]),
      freeCashFlow:pickMetric(set,["Free Cash Flow (TTM)","Free Cash Flow","FCF"])
    };
    if (!m.marketCap) throw new Error("Could not find Market Capitalization in screener metadata.");

    const cond=[];
    const cols=Object.values(m).filter(Boolean);
    const minCap=Number(cfg.minMarketCap);
    cond.push(`"${m.marketCap}" >= ${Number.isFinite(minCap) ? minCap*1e6 : 0}`);

    if (cfg.profitability==="positive" && m.netIncome) cond.push(`"${m.netIncome}" > 0`);
    if (cfg.profitability==="negative" && m.netIncome) cond.push(`"${m.netIncome}" < 0`);
    if (cfg.maxPE!=="" && m.pe) cond.push(`"${m.pe}" <= ${Number(cfg.maxPE)}`);
    if (cfg.minRevenueGrowth!=="" && m.revenueGrowth) cond.push(`"${m.revenueGrowth}" >= ${Number(cfg.minRevenueGrowth)}`);
    if (cfg.minROE!=="" && m.roe) cond.push(`"${m.roe}" >= ${Number(cfg.minROE)}`);
    if (cfg.maxDebtEquity!=="" && m.debtEquity) cond.push(`"${m.debtEquity}" <= ${Number(cfg.maxDebtEquity)}`);
    if (cfg.fcfFilter==="positive" && m.freeCashFlow) cond.push(`"${m.freeCashFlow}" > 0`);
    if (cfg.minDivYield!=="" && m.divYield) cond.push(`"${m.divYield}" >= ${Number(cfg.minDivYield)}`);
    if (cfg.maxDivYield!=="" && m.divYield) cond.push(`"${m.divYield}" <= ${Number(cfg.maxDivYield)}`);
    if (cfg.dividendPayer==="yes" && m.divYield) cond.push(`"${m.divYield}" > 0`);
    if (cfg.dividendPayer==="no" && m.divYield) cond.push(`"${m.divYield}" = 0`);
    if (cfg.sector) cond.push(`"sector" = '${cfg.sector.replaceAll("'","''")}'`);

    const unavailable=[];
    if(cfg.minRevenueGrowth!==""&&!m.revenueGrowth) unavailable.push("Revenue Growth");
    if(cfg.minROE!==""&&!m.roe) unavailable.push("ROE");
    if(cfg.maxDebtEquity!==""&&!m.debtEquity) unavailable.push("Debt/Equity");
    if(cfg.fcfFilter==="positive"&&!m.freeCashFlow) unavailable.push("Free Cash Flow");
    if(unavailable.length) throw new Error(`This API account does not expose the requested metric(s): ${unavailable.join(", ")}.`);

    return {conditions:cond.join(" AND "), columns:[...new Set(cols)], metrics:m};
  }

  function normalizePercent(v){
    if (v===null || v===undefined || v==="") return null;
    if (typeof v==="string") return Number(v.replace("%","").trim());
    return Number(v);
  }

  function normalizeFundamental(row, metrics, universeMap){
    const u=universeMap.get(row.ticker) || {};
    return {
      ticker:row.ticker,
      name:row.name_short || row.name || u.name_short || row.ticker,
      fullName:row.name || u.name || row.name_short || row.ticker,
      sector:row.sector || u.sector || "",
      industry:row.industry || u.industry || "",
      exchange:u.exchange || "",
      marketCap:metrics.marketCap ? Number(row[metrics.marketCap]) : null,
      netIncome:metrics.netIncome ? Number(row[metrics.netIncome]) : null,
      pe:metrics.pe ? Number(row[metrics.pe]) : null,
      revenueGrowth:metrics.revenueGrowth ? normalizePercent(row[metrics.revenueGrowth]) : null,
      roe:metrics.roe ? normalizePercent(row[metrics.roe]) : null,
      debtEquity:metrics.debtEquity ? Number(row[metrics.debtEquity]) : null,
      freeCashFlow:metrics.freeCashFlow ? Number(row[metrics.freeCashFlow]) : null,
      dividendYield:metrics.divYield ? normalizePercent(row[metrics.divYield]) : null
    };
  }

  function clientFundamentalFilters(items,cfg){
    const minP=cfg.minPrice===""?null:Number(cfg.minPrice), maxP=cfg.maxPrice===""?null:Number(cfg.maxPrice);
    // Price filters are applied after quote analysis because the fundamentals response need not contain price.
    return items.filter(x=>{
      if (!((cfg.nyse && x.exchange==="NYSE") || (cfg.nasdaq && x.exchange==="NASDAQ"))) return false;
      return true;
    }).map(x=>({...x,_minPrice:minP,_maxPrice:maxP}));
  }

  function passesPrice(item){
    if (item._minPrice!==null && !(item.tech.price>=item._minPrice)) return false;
    if (item._maxPrice!==null && !(item.tech.price<=item._maxPrice)) return false;
    return true;
  }

  function parseQuoteResponse(json, tickers){
    const out=new Map();
    if (!json) return out;

    // Multi-ticker form: { AAPL: {metadata,data}, MSFT:{...} }
    for (const t of tickers){
      const block=json[t] || json.data?.[t];
      if (block?.data && Array.isArray(block.data)) out.set(t,block.data);
    }

    // Single-ticker form: {metadata,data:[...]}
    if (tickers.length===1 && Array.isArray(json.data)) out.set(tickers[0],json.data);

    return out;
  }

  function isoDate(d){ return d.toISOString().slice(0,10); }

  async function loadSectors(){
    if (!apiKey()) return;
    try{
      if (!state.universe) state.universe=await BQ_API.universe(apiKey());
      const rows=state.universe?.data || state.universe || [];
      const sectors=[...new Set(rows.filter(r=>["NYSE","NASDAQ"].includes(r.exchange)).map(r=>r.sector).filter(Boolean))].sort();
      $("sector").innerHTML='<option value="">All sectors</option>'+sectors.map(s=>`<option>${escapeHtml(s)}</option>`).join("");
    }catch(e){ console.warn("Sector load failed",e); }
  }

  async function runScan(){
    if (state.running) return;
    if (!apiKey()) { $("settingsDialog").showModal(); return; }
    state.running=true;
    $("scanBtn").disabled=true;
    $("exportBtn").disabled=true;
    state.results=[];
    render();

    try{
      const cfg=getConfig();
      if (!cfg.nyse && !cfg.nasdaq) throw new Error("Select NYSE, NASDAQ, or both.");
      setStatus("running","Preparing","Loading the US equity universe and screener metadata…",2);

      const key=apiKey();
      const [universe, metadata] = await Promise.all([
        state.universe || BQ_API.universe(key),
        state.metadata || BQ_API.metadata(key)
      ]);
      state.universe=universe; state.metadata=metadata;

      const universeRows=universe?.data || universe || [];
      const allowed=universeRows.filter(r =>
        r.security_type==="Equity" &&
        ((cfg.nyse && r.exchange==="NYSE") || (cfg.nasdaq && r.exchange==="NASDAQ"))
      );
      const universeMap=new Map(allowed.map(r=>[r.ticker,r]));

      const q=buildFundamentalQuery(cfg,metadata);
      setStatus("running","Screening fundamentals","Applying profitability, market cap, valuation, dividend, and sector rules…",7);
      const fund=await BQ_API.screener(key,q.conditions,q.columns,1,10000);
      let candidates=(fund?.data || [])
        .filter(r=>universeMap.has(r.ticker))
        .map(r=>normalizeFundamental(r,q.metrics,universeMap));
      candidates=clientFundamentalFilters(candidates,cfg);

      const limit=cfg.candidateLimit==="all" ? candidates.length : Number(cfg.candidateLimit);
      candidates=candidates
        .sort((a,b)=>(b.marketCap||0)-(a.marketCap||0))
        .slice(0,limit);

      if (!candidates.length) {
        setStatus("success","Complete","No stocks matched the fundamental filters.",100);
        return;
      }

      // We need enough price history for SMA200 + scan window + 1Y beta.
      const maxBars=Math.max(252,Number(cfg.betaLookback),Number(cfg.weekdayLookback||252),200+Number(cfg.scanDays)+10);
      const calendarDays=Math.ceil(maxBars*1.65)+40;
      const till=new Date();
      const from=new Date(Date.now()-calendarDays*86400000);
      const fromDate=isoDate(from), tillDate=isoDate(till);

      setStatus("running","Loading benchmark","Downloading SPY history for beta calculations…",10);
      const spyJson=await BQ_API.quotes(key,["SPY"],fromDate,tillDate,1,1000);
      const spyMap=parseQuoteResponse(spyJson,["SPY"]);
      const benchmark=MarketScanner.normalizeRows(spyMap.get("SPY") || []);
      if (benchmark.length<60) throw new Error("SPY benchmark history could not be loaded.");

      const batchSize=20;
      let analyzed=0;
      for (let i=0;i<candidates.length;i+=batchSize){
        const batch=candidates.slice(i,i+batchSize);
        const tickers=batch.map(x=>x.ticker);
        const pct=10+((i/candidates.length)*86);
        setStatus("running","Scanning price history",`Analyzing ${Math.min(i+batch.length,candidates.length).toLocaleString()} of ${candidates.length.toLocaleString()} candidates…`,pct);

        try{
          const json=await BQ_API.quotes(key,tickers,fromDate,tillDate,1,1000);
          const map=parseQuoteResponse(json,tickers);
          for (const f of batch){
            const rows=map.get(f.ticker) || [];
            const item=MarketScanner.analyzeStock(f,rows,benchmark,cfg);
            analyzed++;
            if (item && passesPrice(item)) state.results.push(item);
          }
        }catch(batchErr){
          console.warn("Batch failed; retrying individually",tickers,batchErr);
          for (const f of batch){
            try{
              const json=await BQ_API.quotes(key,[f.ticker],fromDate,tillDate,1,1000);
              const map=parseQuoteResponse(json,[f.ticker]);
              const item=MarketScanner.analyzeStock(f,map.get(f.ticker)||[],benchmark,cfg);
              analyzed++;
              if (item && passesPrice(item)) state.results.push(item);
            }catch(e){ console.warn("Ticker failed",f.ticker,e); analyzed++; }
          }
        }
        $("statAnalyzed").textContent=analyzed.toLocaleString();
        render();
        await new Promise(r=>setTimeout(r,0));
      }

      setStatus("success","Complete",`${state.results.length.toLocaleString()} stocks matched all selected filters.`,100);
      $("exportBtn").disabled=state.results.length===0;
    }catch(e){
      console.error(e);
      setStatus("error","Scan failed",e.message || String(e),null);
    }finally{
      state.running=false;
      $("scanBtn").disabled=false;
      updateStats();
    }
  }

  function filteredResults(){
    let rows=state.results.slice();
    if (state.activeTab==="golden") rows=rows.filter(x=>x.signals.golden);
    if (state.activeTab==="gapup") rows=rows.filter(x=>x.signals.gapUp);
    if (state.activeTab==="gapdown") rows=rows.filter(x=>x.signals.gapDown);
    if (state.activeTab==="bollingerup") rows=rows.filter(x=>x.signals.bollingerUp);
    if (state.activeTab==="bollingerdown") rows=rows.filter(x=>x.signals.bollingerDown);
    if (state.activeTab==="goldencross") rows=rows.filter(x=>x.signals.goldenCross);
    if (state.activeTab==="deathcross") rows=rows.filter(x=>x.signals.deathCross);
    if (state.activeTab==="macdbull") rows=rows.filter(x=>x.signals.macdBull);
    if (state.activeTab==="macdbear") rows=rows.filter(x=>x.signals.macdBear);
    if (state.activeTab==="unusualvolume") rows=rows.filter(x=>x.signals.unusualVolume);
    if (state.activeTab==="breakout52") rows=rows.filter(x=>x.signals.breakout52);
    if (state.activeTab==="volbreakout") rows=rows.filter(x=>x.signals.volumeBreakout);

    const q=$("resultSearch").value.trim().toLowerCase();
    if (q) rows=rows.filter(x=>x.ticker.toLowerCase().includes(q)||x.name.toLowerCase().includes(q));

    switch($("sortBy").value){
      case "scoreDesc": rows.sort((a,b)=>(b.codexScore||0)-(a.codexScore||0)); break;
      case "marketCapDesc": rows.sort((a,b)=>(b.marketCap||0)-(a.marketCap||0)); break;
      case "nearHighAsc": rows.sort((a,b)=>(a.tech.pctFromHigh??999)-(b.tech.pctFromHigh??999)); break;
      case "divYieldDesc": rows.sort((a,b)=>(b.dividendYield||0)-(a.dividendYield||0)); break;
      case "betaAsc": rows.sort((a,b)=>(a.beta??999)-(b.beta??999)); break;
      case "gapDesc": rows.sort((a,b)=>(b.signals.gapUp?.gapPct??-999)-(a.signals.gapUp?.gapPct??-999)); break;
      case "gapAsc": rows.sort((a,b)=>(a.signals.gapDown?.gapPct??999)-(b.signals.gapDown?.gapPct??999)); break;
      default: rows.sort((a,b)=>a.ticker.localeCompare(b.ticker));
    }
    return rows;
  }

  function signalHtml(x){
    const tags=[];
    if (x.signals.golden) tags.push('<span class="tag gold">Golden Star</span>');
    if (x.signals.goldenCross) tags.push('<span class="tag good">Golden Cross</span>');
    if (x.signals.deathCross) tags.push('<span class="tag bad">Death Cross</span>');
    if (x.signals.bollingerUp) tags.push('<span class="tag good">Bollinger ↑</span>');
    if (x.signals.bollingerDown) tags.push('<span class="tag bad">Bollinger ↓</span>');
    if (x.signals.macdBull) tags.push('<span class="tag good">MACD ↑</span>');
    if (x.signals.macdBear) tags.push('<span class="tag bad">MACD ↓</span>');
    if (x.signals.unusualVolume) tags.push('<span class="tag info">Unusual Vol</span>');
    if (x.signals.breakout52) tags.push('<span class="tag good">52W Breakout</span>');
    if (x.signals.volumeBreakout) tags.push('<span class="tag good">Vol Breakout</span>');
    if (x.signals.gapUp) tags.push(`<span class="tag good">Gap +${Math.abs(x.signals.gapUp.gapPct).toFixed(1)}%</span>`);
    if (x.signals.gapDown) tags.push(`<span class="tag bad">Gap ${x.signals.gapDown.gapPct.toFixed(1)}%</span>`);
    return tags.join("") || "—";
  }

  function render(){
    const rows=filteredResults();
    if (!rows.length){
      $("resultsBody").innerHTML='<tr><td colspan="14" class="empty">No matching stocks in this view.</td></tr>';
    } else {
      $("resultsBody").innerHTML=rows.map(x=>`
        <tr data-ticker="${escapeHtml(x.ticker)}">
          <td><span class="score-pill ${x.codexScore>=70?"high":x.codexScore<45?"low":""}">${x.codexScore}</span></td>
          <td><strong>${escapeHtml(x.ticker)}</strong></td>
          <td>${escapeHtml(x.name)}</td>
          <td>${escapeHtml(x.exchange)}</td>
          <td class="num">${fmt.price(x.tech.price)}</td>
          <td class="num">${fmt.money(x.netIncome)}</td>
          <td class="num">${fmt.price(x.tech.high52)}</td>
          <td class="num">${fmt.pct(x.tech.pctFromHigh)}</td>
          <td class="num">${fmt.num(x.beta)}</td>
          <td>${(x.dividendYield||0)>0?"Yes":"No"}</td>
          <td class="num">${fmt.pct(x.dividendYield)}</td>
          <td class="num">${fmt.num(x.tech.rsi14,1)}</td>
          <td class="num">${fmt.int(x.tech.avgVol20)}</td>
          <td>${signalHtml(x)}</td>
        </tr>`).join("");
      [...$("resultsBody").querySelectorAll("tr[data-ticker]")].forEach(tr=>{
        tr.addEventListener("click",()=>showDetail(tr.dataset.ticker));
      });
    }
    updateStats();
  }

  function updateStats(){
    const g=state.results.filter(x=>x.signals.golden).length;
    const u=state.results.filter(x=>x.signals.gapUp).length;
    const d=state.results.filter(x=>x.signals.gapDown).length;
    $("statMatches").textContent=state.results.length.toLocaleString();
    $("statGolden").textContent=g.toLocaleString();
    $("statGapUp").textContent=u.toLocaleString();
    $("statGapDown").textContent=d.toLocaleString();
  }


  function weekdayAnalysisHtml(x){
    const a=x.weekday;
    if (!a) return '<div class="signal-box"><small>Weekday analysis unavailable.</small></div>';
    const rows=a.stats.map(s=>`
      <tr>
        <td><strong>${escapeHtml(s.day)}</strong></td>
        <td class="num">${s.sessions}</td>
        <td class="num">${fmt.price(s.avgOpen)}</td>
        <td class="num">${fmt.price(s.avgLow)}</td>
        <td class="num">${fmt.price(s.medianLow)}</td>
        <td class="num">${fmt.price(s.avgClose)}</td>
        <td class="num">${s.weeklyLowWins}</td>
        <td class="num">${fmt.pct(s.weeklyLowRate,1)}</td>
      </tr>`).join("");

    return `
      <div class="signal-box">
        <strong>Best Day to Buy: ${escapeHtml(a.verdict || "—")}</strong>
        <small>
          Based on the last ${a.lookback} trading sessions. Lowest average low: ${escapeHtml(a.bestAvgLow||"—")};
          lowest median low: ${escapeHtml(a.bestMedianLow||"—")};
          most weekly low wins: ${escapeHtml(a.mostWeeklyWins||"—")}.
        </small>
      </div>
      <div class="table-card" style="margin-top:10px">
        <div class="table-scroll" style="max-height:none">
          <table>
            <thead>
              <tr>
                <th>Weekday</th>
                <th>Sessions</th>
                <th>Avg Open</th>
                <th>Avg Low</th>
                <th>Median Low</th>
                <th>Avg Close</th>
                <th>Weekly Low Wins</th>
                <th>Win Rate</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  function showDetail(ticker){
    const x=state.results.find(r=>r.ticker===ticker);
    if (!x) return;
    $("detailTitle").textContent=`${x.ticker} · ${x.name}`;
    const signals=[];
    if (x.signals.golden) signals.push(`<div class="signal-box"><strong>Golden Star (Custom) · ${x.signals.golden.date}</strong><small>Close ${fmt.price(x.signals.golden.close)} · SMA20 ${fmt.price(x.signals.golden.sma20)} · SMA50 ${fmt.price(x.signals.golden.sma50)} · cluster spread ${fmt.pct(x.signals.golden.spreadPct)}</small></div>`);
    if (x.signals.gapUp) signals.push(`<div class="signal-box"><strong>Gap Up · ${x.signals.gapUp.date}</strong><small>${fmt.pct(x.signals.gapUp.gapPct)} · prior close ${fmt.price(x.signals.gapUp.priorClose)} → open ${fmt.price(x.signals.gapUp.open)}</small></div>`);
    if (x.signals.gapDown) signals.push(`<div class="signal-box"><strong>Gap Down · ${x.signals.gapDown.date}</strong><small>${fmt.pct(x.signals.gapDown.gapPct)} · prior close ${fmt.price(x.signals.gapDown.priorClose)} → open ${fmt.price(x.signals.gapDown.open)}</small></div>`);
    if (x.signals.goldenCross) signals.push(`<div class="signal-box"><strong>Golden Cross · ${x.signals.goldenCross.date}</strong><small>SMA50 crossed above SMA200.</small></div>`);
    if (x.signals.deathCross) signals.push(`<div class="signal-box"><strong>Death Cross · ${x.signals.deathCross.date}</strong><small>SMA50 crossed below SMA200.</small></div>`);
    if (x.signals.bollingerUp) signals.push(`<div class="signal-box"><strong>Bollinger Breakout · ${x.signals.bollingerUp.date}</strong><small>Close ${fmt.price(x.signals.bollingerUp.close)} crossed above upper band ${fmt.price(x.signals.bollingerUp.band)}.</small></div>`);
    if (x.signals.bollingerDown) signals.push(`<div class="signal-box"><strong>Bollinger Breakdown · ${x.signals.bollingerDown.date}</strong><small>Close ${fmt.price(x.signals.bollingerDown.close)} crossed below lower band ${fmt.price(x.signals.bollingerDown.band)}.</small></div>`);
    if (x.signals.macdBull) signals.push(`<div class="signal-box"><strong>MACD Bullish Cross · ${x.signals.macdBull.date}</strong><small>MACD crossed above its signal line.</small></div>`);
    if (x.signals.macdBear) signals.push(`<div class="signal-box"><strong>MACD Bearish Cross · ${x.signals.macdBear.date}</strong><small>MACD crossed below its signal line.</small></div>`);
    if (x.signals.unusualVolume) signals.push(`<div class="signal-box"><strong>Unusual Volume · ${x.signals.unusualVolume.date}</strong><small>${fmt.num(x.signals.unusualVolume.multiple,1)}× the prior 20-session average.</small></div>`);
    if (x.signals.breakout52) signals.push(`<div class="signal-box"><strong>52-Week Breakout · ${x.signals.breakout52.date}</strong><small>Close ${fmt.price(x.signals.breakout52.close)} exceeded prior 52-week high ${fmt.price(x.signals.breakout52.priorHigh)}.</small></div>`);
    if (x.signals.volumeBreakout) signals.push(`<div class="signal-box"><strong>Volume-Confirmed Breakout · ${x.signals.volumeBreakout.date}</strong><small>20-day price breakout with ${fmt.num(x.signals.volumeBreakout.multiple,1)}× average volume.</small></div>`);
    $("detailContent").innerHTML=`
      <p>${escapeHtml(x.fullName)} · ${escapeHtml(x.exchange)} · ${escapeHtml(x.sector||"Unclassified")} / ${escapeHtml(x.industry||"")}</p>
      <div class="detail-grid">
        ${metric("Price",fmt.price(x.tech.price))}
        ${metric("Market Cap",fmt.money(x.marketCap))}
        ${metric("Net Income",fmt.money(x.netIncome))}
        ${metric("P/E",fmt.num(x.pe))}
        ${metric("Codex Score",x.codexScore)}
        ${metric("Revenue Growth",fmt.pct(x.revenueGrowth))}
        ${metric("ROE",fmt.pct(x.roe))}
        ${metric("Debt / Equity",fmt.num(x.debtEquity))}
        ${metric("Free Cash Flow",fmt.money(x.freeCashFlow))}
        ${metric("Beta",fmt.num(x.beta))}
        ${metric("Dividend Yield",fmt.pct(x.dividendYield))}
        ${metric("52W High",fmt.price(x.tech.high52))}
        ${metric("From 52W High",fmt.pct(x.tech.pctFromHigh))}
        ${metric("52W Low",fmt.price(x.tech.low52))}
        ${metric("RSI 14",fmt.num(x.tech.rsi14,1))}
        ${metric("SMA 20",fmt.price(x.tech.sma20))}
        ${metric("SMA 50",fmt.price(x.tech.sma50))}
        ${metric("SMA 200",fmt.price(x.tech.sma200))}
        ${metric("Avg Volume 20D",fmt.int(x.tech.avgVol20))}
        ${metric("Price Date",x.tech.date||"—")}
        ${metric("Current Streak",x.streak?.days ? `${x.streak.days} ${x.streak.direction}` : "—")}
      </div>
      <h3>Best Day to Buy</h3>
      ${weekdayAnalysisHtml(x)}
      <h3 style="margin-top:18px">Signals in scan window</h3>
      <div class="signal-list">${signals.join("")||'<div class="signal-box"><small>No Golden Star or gap signals in the selected scan window.</small></div>'}</div>`;
    $("detailDialog").showModal();
  }

  function metric(label,value){ return `<div class="detail-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`; }
  function escapeHtml(s){ return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function csvEscape(v){
    const s=String(v??"");
    return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
  }

  function exportCsv(){
    const rows=filteredResults();
    const headers=["Codex Score","Ticker","Company","Exchange","Sector","Industry","Price","Market Cap","Net Income","P/E","Revenue Growth","ROE","Debt/Equity","Free Cash Flow","52W High","52W Low","Pct From High","Beta","Dividend Payer","Dividend Yield","RSI 14","SMA20","SMA50","SMA200","Avg Volume 20D","Best Day to Buy","Lowest Avg Low Day","Lowest Median Low Day","Most Weekly Low Wins Day","Golden Star Date","Golden Cross Date","Death Cross Date","Bollinger Breakout Date","Bollinger Breakdown Date","MACD Bull Date","MACD Bear Date","Unusual Volume Date","52W Breakout Date","Volume Breakout Date","Gap Up Date","Gap Up %","Gap Down Date","Gap Down %"];
    const lines=[headers.join(",")];
    for (const x of rows){
      lines.push([
        x.codexScore,x.ticker,x.name,x.exchange,x.sector,x.industry,x.tech.price,x.marketCap,x.netIncome,x.pe,x.revenueGrowth,x.roe,x.debtEquity,x.freeCashFlow,x.tech.high52,x.tech.low52,x.tech.pctFromHigh,x.beta,(x.dividendYield||0)>0?"Yes":"No",x.dividendYield,x.tech.rsi14,x.tech.sma20,x.tech.sma50,x.tech.sma200,x.tech.avgVol20,x.weekday?.verdict||"",x.weekday?.bestAvgLow||"",x.weekday?.bestMedianLow||"",x.weekday?.mostWeeklyWins||"",x.signals.golden?.date||"",x.signals.goldenCross?.date||"",x.signals.deathCross?.date||"",x.signals.bollingerUp?.date||"",x.signals.bollingerDown?.date||"",x.signals.macdBull?.date||"",x.signals.macdBear?.date||"",x.signals.unusualVolume?.date||"",x.signals.breakout52?.date||"",x.signals.volumeBreakout?.date||"",x.signals.gapUp?.date||"",x.signals.gapUp?.gapPct??"",x.signals.gapDown?.date||"",x.signals.gapDown?.gapPct??""
      ].map(csvEscape).join(","));
    }
    const blob=new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`codex-market-scan-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function resetFilters(){
    $("profitability").value="positive"; $("minPrice").value="2"; $("maxPrice").value="";
    $("minMarketCap").value="100"; $("maxPE").value=""; $("sector").value="";
    $("minRevenueGrowth").value=""; $("minROE").value=""; $("maxDebtEquity").value=""; $("fcfFilter").value="any";
    $("minDivYield").value=""; $("maxDivYield").value=""; $("dividendPayer").value="any";
    $("minBeta").value=""; $("maxBeta").value=""; $("nearHigh").value=""; $("nearLow").value="";
    $("minAvgVolume").value="100000"; $("minRSI").value=""; $("maxRSI").value="";
    $("trendFilter").value="any"; $("gapThreshold").value="2"; $("goldenTolerance").value="2.5";
    $("unusualVolumeMultiplier").value="2"; $("breakoutVolumeMultiplier").value="1.5"; $("requiredSignal").value="any";
    $("scanDays").value="10"; $("candidateLimit").value="500"; $("betaLookback").value="252"; $("weekdayLookback").value="252";
    $("exchangeNYSE").checked=true; $("exchangeNASDAQ").checked=true; $("strategyPreset").value="custom";
  }


  const PRESETS={
    custom:{},
    quality:{profitability:"positive",minMarketCap:"500",maxPE:"35",minRevenueGrowth:"0",minROE:"8",fcfFilter:"positive",trendFilter:"above200",minAvgVolume:"250000"},
    value:{profitability:"positive",minMarketCap:"300",maxPE:"18",fcfFilter:"positive",maxDebtEquity:"2",minAvgVolume:"150000"},
    dividend:{profitability:"positive",minMarketCap:"1000",dividendPayer:"yes",minDivYield:"2",maxDivYield:"8",fcfFilter:"positive",maxBeta:"1.3"},
    momentum:{profitability:"positive",nearHigh:"15",minRSI:"50",maxRSI:"75",trendFilter:"bullstack",minAvgVolume:"300000"},
    breakout:{profitability:"positive",nearHigh:"8",trendFilter:"above50",minAvgVolume:"300000",requiredSignal:"volbreakout",breakoutVolumeMultiplier:"1.5"},
    lowbeta:{profitability:"positive",maxBeta:"0.9",minMarketCap:"1000",fcfFilter:"positive",trendFilter:"above200"},
    smallcap:{profitability:"positive",minMarketCap:"100",maxPE:"30",minRevenueGrowth:"0",fcfFilter:"positive",minAvgVolume:"100000"}
  };

  function applyPreset(name){
    resetFilters();
    $("strategyPreset").value=name;
    const p=PRESETS[name]||{};
    for(const [id,value] of Object.entries(p)){
      const el=$(id);
      if(el) el.value=value;
    }
  }

  $("settingsBtn").addEventListener("click",()=>{ $("apiKey").value=apiKey(); $("apiTestResult").textContent=""; $("settingsDialog").showModal(); });
  $("settingsForm").addEventListener("close",()=>{});
  $("settingsForm").addEventListener("submit",e=>{
    const submitter=e.submitter;
    if (submitter?.value==="save") {
      const value=$("apiKey").value.trim();
      if (value) localStorage.setItem("codex_bq_api_key",value);
      else localStorage.removeItem("codex_bq_api_key");
      setTimeout(loadSectors,0);
    }
  });
  $("testApiBtn").addEventListener("click",async()=>{
    const key=$("apiKey").value.trim();
    $("apiTestResult").className="api-test"; $("apiTestResult").textContent="Testing…";
    try{
      const j=await BQ_API.test(key);
      const count=j?.metadata?.total_records ?? j?.data?.length ?? "many";
      $("apiTestResult").className="api-test good"; $("apiTestResult").textContent=`Connected successfully. Equity universe returned ${count} records.`;
    }catch(e){
      $("apiTestResult").className="api-test bad"; $("apiTestResult").textContent=e.message;
    }
  });

  $("strategyPreset").addEventListener("change",e=>applyPreset(e.target.value));
  $("resultView").addEventListener("change",e=>{ state.activeTab=e.target.value; render(); });
  $("scanBtn").addEventListener("click",runScan);
  $("exportBtn").addEventListener("click",exportCsv);
  $("resetBtn").addEventListener("click",resetFilters);
  $("resultSearch").addEventListener("input",render);
  $("sortBy").addEventListener("change",render);
  $("closeDetailBtn").addEventListener("click",()=>$("detailDialog").close());

  document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab=btn.dataset.tab;
    render();
  }));

  if (!apiKey()) setTimeout(()=>$("settingsDialog").showModal(),250);
  else loadSectors();
})();
