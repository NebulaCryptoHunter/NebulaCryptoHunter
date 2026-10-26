// NEBULA AI Engine V1 — explainable deterministic candidate triage.
// This is not a trained model or calibrated probability.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export function scoreCandidate(p){
 const reasons=[],missing=[];
 for(const k of ['liquidityUsd','volumeH1','changeH1','buysH1','sellsH1'])if(!finite(p?.[k]))missing.push(k);
 if(missing.length)return {status:'INSUFFICIENT_DATA',score:null,confidence:null,missing};
 const liq=p.liquidityUsd,vol=p.volumeH1,change=p.changeH1;
 const trades=p.buysH1+p.sellsH1;
 const liquidityScore=clamp(Math.log10(1+liq)/6,0,1)*25;
 const volumeScore=clamp(vol/Math.max(liq,1),0,3)/3*25;
 const momentumScore=clamp(change,0,50)/50*25;
 const flowScore=trades>=20?clamp(p.buysH1/trades,0,1)*25:0;
 if(trades<20)reasons.push('LOW_TRANSACTION_SAMPLE');
 if(liq<20000)reasons.push('LOW_LIQUIDITY');
 if(change>100)reasons.push('EXTREME_MOVE_CHASE_RISK');
 return {status:reasons.includes('LOW_LIQUIDITY')?'RISK_REVIEW':'SCORED',
  score:Math.round((liquidityScore+volumeScore+momentumScore+flowScore)*100)/100,
  confidence:null,confidenceReason:'NOT_CALIBRATED',reasons,
  whaleStatus:'UNVERIFIED',rugStatus:'UNKNOWN',buyAllowed:false};
}
export default {async fetch(request){const path=new URL(request.url).pathname;if(path==='/health')return Response.json({service:'nebula-ai-engine',status:'ready',model:'deterministic-v1',trading:false});return Response.json({error:'NOT_FOUND'}, {status:404});}};
