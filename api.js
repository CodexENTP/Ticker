const BQ_API = (() => {
  const BASE = "https://data.businessquant.com";
  const DAILY_LIMIT = 30;
  const usageKey = () => `codex-bq-usage-${new Date().toISOString().slice(0,10)}`;

  function usage(){ return Number(localStorage.getItem(usageKey()) || 0); }
  function remaining(){ return Math.max(0, DAILY_LIMIT - usage()); }
  function increment(){ localStorage.setItem(usageKey(), String(usage()+1)); window.dispatchEvent(new CustomEvent('codex-api-usage')); }
  function cacheGet(key, maxAgeMs){
    try { const raw=localStorage.getItem(`codex-cache-${key}`); if(!raw) return null; const v=JSON.parse(raw); if(Date.now()-v.at>maxAgeMs) return null; return v.data; } catch(_){ return null; }
  }
  function cacheSet(key,data){ try{ localStorage.setItem(`codex-cache-${key}`, JSON.stringify({at:Date.now(),data})); }catch(_){} }

  async function request(path, {apiKey, method="GET", body=null, cacheKey=null, cacheMs=0, sessionCache=false} = {}) {
    if (!apiKey) throw new Error("Missing Business Quant API key.");
    if(cacheKey){
      const store=sessionCache?sessionStorage:localStorage;
      try{ const raw=store.getItem(`codex-cache-${cacheKey}`); if(raw){ const v=JSON.parse(raw); if(!cacheMs || Date.now()-v.at<cacheMs) return v.data; }}catch(_){}
    }
    if (remaining() <= 0) throw new Error("Business Quant daily API budget reached (30/30). Try again after the daily quota resets.");
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}api_key=${encodeURIComponent(apiKey)}`;
    const options = { method, headers: { "Accept": "application/json" } };
    if (body !== null) { options.headers["Content-Type"]="application/json"; options.body=JSON.stringify(body); }
    let res;
    try { res = await fetch(url, options); }
    catch(e){ throw new Error("Failed to fetch Business Quant. If your key works in a direct browser URL, this can indicate a browser/CORS restriction."); }
    increment();
    if (!res.ok) {
      let detail=""; try{detail=await res.text();}catch(_){}
      throw new Error(`Business Quant ${res.status}: ${detail || res.statusText}`);
    }
    const data=await res.json();
    if(cacheKey){
      const store=sessionCache?sessionStorage:localStorage;
      try{store.setItem(`codex-cache-${cacheKey}`,JSON.stringify({at:Date.now(),data}));}catch(_){}
    }
    return data;
  }

  const test = apiKey => request("/universe?security_type=Equity",{apiKey});
  const universe = apiKey => request("/universe?security_type=Equity",{apiKey,cacheKey:"universe",cacheMs:24*3600e3});
  const metadata = apiKey => request("/metadata?table=screener",{apiKey,cacheKey:"metadata",cacheMs:7*24*3600e3});
  const screener = (apiKey,conditions,preferredColumns,page=1,limit=10000) => request(`/screener?page=${page}&limit=${limit}`,{apiKey,method:"POST",body:{conditions,preferred_columns:preferredColumns}});
  const quotes = (apiKey,tickers,fromDate,tillDate,page=1,limit=1000) => {
    const params=new URLSearchParams({ticker:tickers.join(","),mode:"eod",from_date:fromDate,till_date:tillDate,page:String(page),limit:String(limit)});
    const ck=`q-${tickers.join('-')}-${fromDate}-${tillDate}`;
    return request(`/quotes?${params}`,{apiKey,cacheKey:ck,cacheMs:12*3600e3,sessionCache:true});
  };
  function clearCache(){ Object.keys(localStorage).filter(k=>k.startsWith('codex-cache-')).forEach(k=>localStorage.removeItem(k)); sessionStorage.clear(); }
  return {test,universe,metadata,screener,quotes,usage,remaining,DAILY_LIMIT,clearCache};
})();
