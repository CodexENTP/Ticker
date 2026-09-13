const MarketScanner = (() => {
  const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const dateOnly=v=>String(v||'').slice(0,10);
  const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?((a-b)/b)*100:null;
  function normalizeRows(raw){return(raw||[]).map(r=>({date:dateOnly(r.date),open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:+r.volume})).filter(r=>r.date&&[r.open,r.high,r.low,r.close].every(Number.isFinite)).sort((a,b)=>a.date.localeCompare(b.date));}
  function smaAt(rows,p,i){if(i<p-1)return null;const a=rows.slice(i-p+1,i+1).map(r=>r.close);return a.length===p?mean(a):null;}
  function ema(values,p){const o=Array(values.length).fill(null);if(values.length<p)return o;let x=mean(values.slice(0,p)),k=2/(p+1);o[p-1]=x;for(let i=p;i<values.length;i++){x=values[i]*k+x*(1-k);o[i]=x;}return o;}
  function rsiSeries(rows,p=14){const out=Array(rows.length).fill(null);if(rows.length<=p)return out;let gains=0,losses=0;for(let i=1;i<=p;i++){const d=rows[i].close-rows[i-1].close;if(d>0)gains+=d;else losses-=d;}let ag=gains/p,al=losses/p;out[p]=al===0?100:100-100/(1+ag/al);for(let i=p+1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;const g=Math.max(d,0),l=Math.max(-d,0);ag=(ag*(p-1)+g)/p;al=(al*(p-1)+l)/p;out[i]=al===0?100:100-100/(1+ag/al);}return out;}
  function macd(rows){const c=rows.map(r=>r.close),e12=ema(c,12),e26=ema(c,26),m=Array(c.length).fill(null);for(let i=0;i<c.length;i++)if(Number.isFinite(e12[i])&&Number.isFinite(e26[i]))m[i]=e12[i]-e26[i];const valid=m.map((v,i)=>({v,i})).filter(x=>Number.isFinite(x.v));const sigVals=ema(valid.map(x=>x.v),9),s=Array(c.length).fill(null);valid.forEach((x,j)=>{if(Number.isFinite(sigVals[j]))s[x.i]=sigVals[j];});const h=m.map((v,i)=>Number.isFinite(v)&&Number.isFinite(s[i])?v-s[i]:null);return{macd:m,signal:s,hist:h};}
  function returns(rows){const m=new Map();for(let i=1;i<rows.length;i++)if(rows[i-1].close)m.set(rows[i].date,rows[i].close/rows[i-1].close-1);return m;}
  function beta(rows,bench,n=252){const a=returns(rows),b=returns(bench),d=[...a.keys()].filter(x=>b.has(x)).slice(-n);if(d.length<30)return null;const x=d.map(k=>b.get(k)),y=d.map(k=>a.get(k)),mx=mean(x),my=mean(y);let cv=0,v=0;for(let i=0;i<d.length;i++){cv+=(x[i]-mx)*(y[i]-my);v+=(x[i]-mx)**2;}return v?cv/v:null;}
  function avgVol(rows,n=20){const a=rows.slice(-n).map(r=>r.volume).filter(Number.isFinite);return mean(a);}
  function findGapSetup(rows,cfg){
    const now=rows.length-1;if(now<10)return null;const minAge=+(cfg.gapMinAge||5),maxAge=+(cfg.gapMaxAge||60),threshold=+(cfg.gapThreshold||3),maxAbove=+(cfg.gapDistance||5);
    let best=null;
    for(let i=Math.max(1,now-maxAge);i<=now-minAge;i++){
      const bottom=rows[i-1].close,top=rows[i].open,g=pct(top,bottom);if(!(g>=threshold))continue;
      const after=rows.slice(i,now+1),minLow=Math.min(...after.map(r=>r.low));
      const filled=Math.max(0,Math.min(100,((top-minLow)/(top-bottom))*100));if(filled>=100)continue;
      const price=rows[now].close,distAbove=price>top?pct(price,top):0,inside=price<=top&&price>bottom;
      if(!inside&&distAbove>maxAbove)continue;
      const currentFill=inside?Math.max(0,Math.min(100,((top-price)/(top-bottom))*100)):0;
      const rec={date:rows[i].date,age:now-i,bottom,top,gapPct:g,fillPct:currentFill,maxFillPct:filled,distanceAbovePct:distAbove,inside};
      if(!best || rec.distanceAbovePct<best.distanceAbovePct || (rec.inside&&!best.inside))best=rec;
    }return best;
  }
  function downtrend(rows){const i=rows.length-1,s20=smaAt(rows,20,i),s205=smaAt(rows,20,i-5),hi20=Math.max(...rows.slice(-20).map(r=>r.high));const c=rows[i].close;const checks={belowSMA20:Number.isFinite(s20)&&c<s20,sma20Falling:Number.isFinite(s20)&&Number.isFinite(s205)&&s20<s205,below20DHigh:pct(hi20,c)>=5};const count=Object.values(checks).filter(Boolean).length;return{count,checks,pass:count>=2};}
  function earlyGolden(rows,sensitivity='early'){const i=rows.length-1;if(i<205)return null;const s50=smaAt(rows,50,i),s200=smaAt(rows,200,i),s505=smaAt(rows,50,i-5),s2005=smaAt(rows,200,i-5);if(![s50,s200,s505,s2005].every(Number.isFinite)||s50>=s200)return null;const distance=((s200-s50)/s200)*100,prior=((s2005-s505)/s2005)*100,limits={veryearly:10,early:5,near:2,any:99};const lim=limits[sensitivity]||5;return distance<=lim&&s50>s505&&distance<prior?{distancePct:distance,sma50:s50,sma200:s200,closing:prior-distance}:null;}
  function bullishRSIDivergence(rows,rsi){if(rows.length<35)return false;const n=rows.length,half=Math.floor((n-30+n-1)/2);let a=n-30,b=half,c=half+1,d=n-1;const low1=Math.min(...rows.slice(a,b+1).map(r=>r.low)),low2=Math.min(...rows.slice(c,d+1).map(r=>r.low));const idx1=rows.findIndex((r,i)=>i>=a&&i<=b&&r.low===low1),idx2=rows.findIndex((r,i)=>i>=c&&i<=d&&r.low===low2);return idx1>=0&&idx2>=0&&low2<low1&&Number.isFinite(rsi[idx1])&&Number.isFinite(rsi[idx2])&&rsi[idx2]>rsi[idx1];}
  function bollingerReversal(rows){if(rows.length<22)return false;const i=rows.length-1,p=rows.slice(i-20,i).map(r=>r.close),m=mean(p),sd=Math.sqrt(mean(p.map(x=>(x-m)**2))),lower=m-2*sd;return rows[i-1].low<=lower&&rows[i].close>rows[i-1].close;}
  function unusualVolume(rows,m=1.5){if(rows.length<21)return false;const av=mean(rows.slice(-21,-1).map(r=>r.volume));return av>0&&rows.at(-1).volume>=av*m;}
  function higherLow(rows){if(rows.length<15)return false;const a=Math.min(...rows.slice(-15,-8).map(r=>r.low)),b=Math.min(...rows.slice(-7).map(r=>r.low));return b>a;}
  function bullishEngulfing(rows){if(rows.length<2)return false;const a=rows.at(-2),b=rows.at(-1);return a.close<a.open&&b.close>b.open&&b.open<=a.close&&b.close>=a.open;}
  function sma20Reclaim(rows){const i=rows.length-1;if(i<20)return false;const s=smaAt(rows,20,i),ps=smaAt(rows,20,i-1);return rows[i].close>s&&rows[i-1].close<=ps;}
  function subscores(f,t,mode){
    let quality=50,value=50,trend=50,momentum=50,reversal=50,risk=50;
    if(f.netIncome>0)quality+=25;else quality-=30;if(Number.isFinite(f.roe))quality+=Math.min(20,Math.max(-10,f.roe));if(f.freeCashFlow>0)quality+=10;if(Number.isFinite(f.debtEquity)&&f.debtEquity<2)quality+=10;
    if(Number.isFinite(f.pe)){if(f.pe>0&&f.pe<=20)value+=25;else if(f.pe<=35)value+=12;else value-=10;}if(Number.isFinite(f.dividendYield)&&f.dividendYield>0)value+=5;
    if(t.price>t.sma200)trend+=15;if(t.sma50>t.sma200)trend+=15;if(t.earlyGolden)trend+=20;if(t.downtrend?.pass)trend-=8;
    if(Number.isFinite(t.rsi)){if(t.rsi>=45&&t.rsi<=70)momentum+=15;if(t.rsiRising)momentum+=15;if(t.rsi>78)momentum-=15;}if(t.macdBull)momentum+=15;if(t.macdImproving)momentum+=15;
    if(t.gap)reversal+=25;if(t.rsiDivergence)reversal+=15;if(t.bollingerReversal)reversal+=10;if(t.higherLow)reversal+=10;if(t.bullishEngulfing)reversal+=10;if(t.sma20Reclaim)reversal+=10;
    if(Number.isFinite(t.beta)){risk+=t.beta<=1?18:t.beta<=1.5?7:-12;}if(t.unusualVolume)risk+=4;
    const clamp=x=>Math.round(Math.max(0,Math.min(100,x)));const s={quality:clamp(quality),value:clamp(value),trend:clamp(trend),momentum:clamp(momentum),reversal:clamp(reversal),risk:clamp(risk)};
    const weights=mode==='gap'?{quality:.18,value:.08,trend:.08,momentum:.24,reversal:.34,risk:.08}:mode==='early'?{quality:.18,value:.1,trend:.30,momentum:.28,reversal:.06,risk:.08}:{quality:.26,value:.18,trend:.18,momentum:.18,reversal:.08,risk:.12};
    s.composite=Math.round(Object.entries(weights).reduce((z,[k,w])=>z+s[k]*w,0));return s;
  }
  function analyzeStock(f,raw,bench,cfg){const rows=normalizeRows(raw);if(rows.length<60)return null;const i=rows.length-1,rs=rsiSeries(rows),mc=macd(rows),r=rs[i],r3=rs[i-3],h=mc.hist[i],h1=mc.hist[i-1],h3=mc.hist[i-3];const recentBullCross=(()=>{for(let j=Math.max(1,i-5);j<=i;j++)if(Number.isFinite(mc.macd[j])&&Number.isFinite(mc.signal[j])&&Number.isFinite(mc.macd[j-1])&&Number.isFinite(mc.signal[j-1])&&mc.macd[j]>mc.signal[j]&&mc.macd[j-1]<=mc.signal[j-1])return true;return false;})();
    const t={price:rows[i].close,sma20:smaAt(rows,20,i),sma50:smaAt(rows,50,i),sma200:smaAt(rows,200,i),rsi:r,rsiRising:Number.isFinite(r)&&Number.isFinite(r3)&&r>r3,macd:mc.macd[i],macdSignal:mc.signal[i],macdHist:h,macdBull:Number.isFinite(mc.macd[i])&&Number.isFinite(mc.signal[i])&&mc.macd[i]>mc.signal[i],macdImproving:Number.isFinite(h)&&Number.isFinite(h3)&&h>h3,macdCross:recentBullCross,beta:beta(rows,bench,+(cfg.betaLookback||252)),avgVolume20:avgVol(rows),downtrend:downtrend(rows),gap:findGapSetup(rows,cfg),earlyGolden:earlyGolden(rows,cfg.earlySensitivity||'early'),rsiDivergence:bullishRSIDivergence(rows,rs),bollingerReversal:bollingerReversal(rows),unusualVolume:unusualVolume(rows,+(cfg.volumeMultiplier||1.5)),higherLow:higherLow(rows),bullishEngulfing:bullishEngulfing(rows),sma20Reclaim:sma20Reclaim(rows),rows};
    const optional=[t.earlyGolden,t.macdCross,t.rsiDivergence,t.bollingerReversal,t.unusualVolume,t.higherLow,t.bullishEngulfing,t.sma20Reclaim].filter(Boolean).length;t.optionalConfirmations=optional;
    const item={...f,tech:t};item.scores=subscores(item,t,cfg.mode);return item;}
  function evaluate(item,cfg){const t=item.tech,reasons=[],miss=[];const req=(ok,label)=>{(ok?reasons:miss).push(label);};req(item.netIncome>0,'Positive net income');
    if(cfg.mode==='gap'){req(!!t.gap,'Open prior gap-up is in range');req(t.downtrend.pass,'Pullback/downtrend confirmed');req(Number.isFinite(t.rsi)&&t.rsi>=+(cfg.rsiMin||35)&&t.rsi<=+(cfg.rsiMax||55)&&t.rsiRising,'RSI is in recovery range and rising');req(t.macdImproving||t.macdCross,'MACD histogram improving or bullish crossover');req(t.optionalConfirmations>=+(cfg.confirmations||1),`At least ${cfg.confirmations||1} optional confirmation(s)`);}
    else if(cfg.mode==='early'){req(!!t.earlyGolden,'SMA50 is rising toward SMA200');req(Number.isFinite(t.rsi)&&t.rsi>=+(cfg.rsiMin||45)&&t.rsi<=+(cfg.rsiMax||75)&&t.rsiRising,'RSI confirms strengthening momentum');req(t.macdImproving||t.macdBull,'MACD confirms strengthening momentum');}
    else {req(t.avgVolume20>=+(cfg.minAvgVolume||100000),'Sufficient liquidity');if(cfg.requireMomentum)req(t.rsiRising&&(t.macdImproving||t.macdBull),'Momentum confirmation');}
    const total=reasons.length+miss.length,match=miss.length===0,near=!match&&miss.length<=Math.max(1,Math.floor(total*.25));return{match,near,reasons,miss};}
  return{normalizeRows,analyzeStock,evaluate};
})();
