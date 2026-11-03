import {MODEL, SCORING_POLICY} from './scoring-v2.mjs';
import {assessRisk} from './risk-assessment.mjs';
import {modelValidation} from './model-validation.mjs';
const number = x => typeof x === 'number' && Number.isFinite(x);
const object = x => {if(typeof x === 'string')try{x=JSON.parse(x)}catch{return null}return x && typeof x === 'object' && !Array.isArray(x) ? x : null;};
const time = x => typeof x === 'string' ? Date.parse(x) : NaN;
const fraction = (n, d) => ({numerator:n, denominator:d, value:d > 0 ? n / d * 100 : null});
// Exactly the same first pool per mint as the visible radar, not the raw pool-row count.
export function visibleTokens(data) {
  const seen = new Set();
  return (Array.isArray(data?.items) ? data.items : []).filter(x => {
    if(!x || typeof x.mint !== 'string' || !x.mint || seen.has(x.mint))return false;
    seen.add(x.mint);return true;
  });
}
export function performanceMetrics(data, {now=Date.now()}={}) {
  const items=visibleTokens(data), count=items.length, validPrice=x=>number(x.price_usd)&&x.price_usd>0;
  const freshTime=t=>Number.isFinite(t)&&t<=now+SCORING_POLICY.futureToleranceMs&&now-t<=SCORING_POLICY.maxObservationAgeMs;
  const fresh=x=>freshTime(time(x.observed_at))&&(x.source_as_of==null||freshTime(time(x.source_as_of)));
  const scored=items.filter(x=>x.model===MODEL&&number(x.score)&&x.score>=0&&x.score<=100);
  let checked=0, passed=0, detected=0;const checkExpiries=[],setupExpiries=[];
  const expiry=e=>Math.min(...[e?.observedAt,...['sourceAsOf','sourceUpdatedAt'].filter(k=>e?.[k]!=null).map(k=>e[k])].map(time))+SCORING_POLICY.maxObservationAgeMs;
  for(const x of scored) {
    const itemCheckExpiries=[];
    const meta=object(x.tokenMetadata),evidence=object(x.verificationEvidence)||{};
    const risk=assessRisk({base:{mint:x.mint},tokenMetadata:meta,verificationEvidence:evidence},{now});
    for(const [key,c] of Object.entries(risk.checks))if(['PASS','FAIL','CONFLICT'].includes(c.status)){
      const end=key==='rugcheck'?expiry(evidence.rugcheck):key==='holderConcentration'||c.source==='jupiter'?expiry(meta):c.source==='rpc+jupiter'?Math.min(expiry(meta),expiry(evidence.mintAccount)):expiry(evidence.mintAccount);
      checked++;if(Number.isFinite(end)){checkExpiries.push(end);itemCheckExpiries.push(end);}
    }
    if(risk.allChecksPassed)passed++;if(risk.status==='RISK_DETECTED')detected++;
    if(x.decision==='REVIEW'&&fresh(x)&&validPrice(x)&&risk.allChecksPassed&&itemCheckExpiries.length===5&&x.tracking?.state!=='WEAK'&&x.tracking?.state!=='EXITED')
      setupExpiries.push(Math.min(time(x.observed_at)+SCORING_POLICY.maxObservationAgeMs,x.source_as_of==null?Infinity:time(x.source_as_of)+SCORING_POLICY.maxObservationAgeMs,...itemCheckExpiries));
  }
  const tracking=data?.radarTracking,counts=object(tracking?.counts),validCount=v=>Number.isSafeInteger(v)&&v>=0;
  const totalTracked=(counts?.ACTIVE??0)+(counts?.WEAK??0);
  const tracked=tracking?.version==='radar-v1.0.0'&&counts&&Object.values(counts).every(validCount)&&validCount(totalTracked)?totalTracked:null;
  const validation=modelValidation(data?.candidates,{now});
  const metrics={
    pool:fraction(items.filter(x=>typeof x.pair_address==='string'&&!!x.pair_address&&number(x.liquidity_usd)&&x.liquidity_usd>0&&validPrice(x)).length,count),
    price:fraction(items.filter(validPrice).length,count),
    scored:fraction(scored.length,count),
    fresh:{...fraction(items.filter(x=>validPrice(x)&&fresh(x)).length,count),expiries:items.filter(x=>validPrice(x)&&fresh(x)).map(x=>Math.min(time(x.observed_at),x.source_as_of==null?Infinity:time(x.source_as_of))+SCORING_POLICY.maxObservationAgeMs)},
    risk:{...fraction(checked,scored.length*5),checkExpiries,passedTokens:passed,detectedTokens:detected,scoredTokens:scored.length},
    evaluation:fraction(validation.measured,validation.eligible),
    positive:fraction(validation.positive,validation.measured),
  };
  return {version:'research-performance-v1',activeModel:MODEL,asOf:new Date(now).toISOString(),tokenCount:count,metrics,validation,
    overview:{tracked,activeSetups:setupExpiries.length,setupExpiries,trackedScope:'PERSISTENT_ACTIVE_AND_WEAK',setupScope:'UNIQUE_VISIBLE_FRESH_V4_REVIEW_WITH_CURRENT_PASSING_CHECKS'},
    definition:'Unique visible tokens; data/readiness and descriptive same-pool returns, not accuracy, win rate, profit probability or calibrated performance'};
}
export function withPerformance(data, options) {
  const aiPerformance=performanceMetrics(data,options);
  return {...data,activeModel:MODEL,scoreValidation:aiPerformance.validation,aiPerformance};
}
