const BQ_API = (() => {
  const BASE = "https://data.businessquant.com";

  async function request(path, {apiKey, method="GET", body=null} = {}) {
    if (!apiKey) throw new Error("Missing Business Quant API key.");
    const sep = path.includes("?") ? "&" : "?";
    const url = `${BASE}${path}${sep}api_key=${encodeURIComponent(apiKey)}`;
    const options = { method, headers: { "Accept": "application/json" } };
    if (body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }
    const res = await fetch(url, options);
    if (!res.ok) {
      let detail = "";
      try { detail = await res.text(); } catch (_) {}
      throw new Error(`API ${res.status}: ${detail || res.statusText}`);
    }
    return res.json();
  }

  async function test(apiKey) {
    return request("/universe?security_type=Equity", {apiKey});
  }

  async function universe(apiKey) {
    return request("/universe?security_type=Equity", {apiKey});
  }

  async function metadata(apiKey) {
    return request("/metadata?table=screener", {apiKey});
  }

  async function screener(apiKey, conditions, preferredColumns, page=1, limit=10000) {
    return request(`/screener?page=${page}&limit=${limit}`, {
      apiKey,
      method:"POST",
      body:{
        conditions,
        preferred_columns: preferredColumns
      }
    });
  }

  async function quotes(apiKey, tickers, fromDate, tillDate, page=1, limit=1000) {
    const ticker = tickers.join(",");
    const params = new URLSearchParams({
      ticker,
      mode:"eod",
      from_date:fromDate,
      till_date:tillDate,
      page:String(page),
      limit:String(limit)
    });
    return request(`/quotes?${params.toString()}`, {apiKey});
  }

  return { test, universe, metadata, screener, quotes };
})();
