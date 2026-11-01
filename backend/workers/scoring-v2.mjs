// Explainable research ranking. These provisional weights are not a trained/calibrated predictor.
export const MODEL='heuristic-v2.0.0';
export const SCORING_POLICY=Object.freeze({minReviewLiquidity:50000,minPressureTransactions:20,maxObservationAgeMs:15*60000,futureToleranceMs:60000,maxTurnover:100,maxReviewGain24h:300});
const clamp=(x,a=0,b=100)=>Math.min(b,Math.max(a,x));
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const positive=x=>number(x)!==null&&x>0;
const round=x=>Math.round(x*100)/100;
export function scoreCandidate(c,{now=Date.now()}={}){
 const policy=SCORING_POLICY,reasons=[],risks=[],missing=[];
 const price=number(c?.priceUsd),liq=number(c?.liquidityUsd),vol=number(c?.volume24h),day=number(c?.change24h);
 for(const [key,valid] of [['priceUsd',positive(price)],['liquidityUsd',positive(liq)],['volume24h',vol!==null&&vol>=0],['change24h',day!==null&&day>=-100]])if(!valid)missing.push(key);
 const base={model:MODEL,dataCoverageDefinition:'Market inputs only; excludes risk verification',confidence:null,confidenceReason:'NOT_CALIBRATED',probabilityOfProfit:null,predictedMultiplier:null,autoTrade:false,modelCalibrated:false};
 if(missing.length)return {...base,decision:'INSUFFICIENT_DATA',score:null,reasons:['Missing valid market data: '+missing.join(', ')],riskFlags:['INCOMPLETE_MARKET_DATA'],dataCoverage:null,components:null};
 const observed=typeof c.observedAt==='string'?Date.parse(c.observedAt):NaN;
 const fresh=Number.isFinite(observed)&&observed<=now+policy.futureToleranceMs&&now-observed<=policy.maxObservationAgeMs;
 if(!fresh)risks.push(Number.isFinite(observed)&&observed>now+policy.futureToleranceMs?'FUTURE_OBSERVATION':'STALE_OR_UNTIMED_OBSERVATION');
 const hour=c.timeframes?.h1||{},five=c.timeframes?.m5||{};
 const h1=number(hour.changePct),m5=number(five.changePct);
 const txWindow=Number.isSafeInteger(hour.buys)&&hour.buys>=0&&Number.isSafeInteger(hour.sells)&&hour.sells>=0?hour:{buys:c.buys24h,sells:c.sells24h};
 const buys=number(txWindow.buys),sells=number(txWindow.sells);
 const hasCounts=Number.isSafeInteger(buys)&&buys>=0&&Number.isSafeInteger(sells)&&sells>=0&&Number.isSafeInteger(buys+sells);
 const tx=hasCounts?buys+sells:null;
 // Beta(10,10) shrinkage prevents one buy/zero sells from looking like robust demand.
 const pressure=tx!==null&&tx>0?100*(buys+10)/(tx+20):null;
 const ratio=vol/liq;
 if(!Number.isFinite(ratio))return {...base,decision:'INSUFFICIENT_DATA',score:null,reasons:['Invalid volume/liquidity ratio'],riskFlags:['INVALID_MARKET_RATIO'],dataCoverage:null,components:null};
 const liquidity=clamp(Math.log10(Math.max(1,liq/10000))*50);
 const activity=clamp(Math.log1p(ratio)/Math.log(11)*100);
 const momentum=clamp(50+(h1!==null?h1:day/24)*2);
 const components={liquidity:round(liquidity),activity:round(activity),momentum:round(momentum),buyPressure:pressure===null?null:round(pressure)};
 const coverage=(pressure===null?0:25)+(h1===null?0:25)+50;
 let score=.30*liquidity+.20*activity+.25*momentum+.25*(pressure??0);
 if(liq<policy.minReviewLiquidity)risks.push('THIN_LIQUIDITY');
 if(tx===null||tx<policy.minPressureTransactions)risks.push('INSUFFICIENT_TRANSACTION_SAMPLE');
 if(h1===null)risks.push('SHORT_TERM_MOMENTUM_MISSING');
 if((h1!==null&&h1<0)||day<0){risks.push('DOWNSIDE_MOMENTUM');score-=Math.min(35,Math.abs(Math.min(h1??0,0))*1.5+Math.abs(Math.min(day,0))*.15)}
 if(pressure!==null&&pressure<50){risks.push('SELL_PRESSURE');score-=(50-pressure)*.5}
 if(ratio>policy.maxTurnover){risks.push('EXTREME_TURNOVER');score-=20}
 if(day>policy.maxReviewGain24h||(m5!==null&&m5>30)){risks.push('OVERHEATED_MOMENTUM');score-=20}
 if(vol===0||tx===0){risks.push('NO_OBSERVED_ACTIVITY');score=Math.min(score,20)}
 if(!fresh)score=Math.min(score,30);
 const verified=c.risk?.rugCheck==='SAFE'&&c.risk?.whaleConcentration==='SAFE';
 if(!verified)reasons.push('Security or whale concentration unverified');
 for(const flag of risks)reasons.push(flag);
 const ready=verified&&fresh&&risks.length===0&&h1>0&&pressure>=55&&coverage===100;
 return {...base,decision:ready&&score>=60?'REVIEW':'WATCH',score:round(clamp(score)),reasons,riskFlags:risks,dataCoverage:coverage,components,metrics:{volumeLiquidityRatio:round(ratio),pressureTransactions:tx,buyPressureWindow:txWindow===hour?'h1':'h24',ageMs:Number.isFinite(observed)?now-observed:null}};
}
