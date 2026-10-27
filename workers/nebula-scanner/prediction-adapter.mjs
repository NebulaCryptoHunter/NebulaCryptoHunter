// NEBULA staging: convert scored scanner observations into auditable prediction candidates.
// This adapter does not write to the production predictions table.
const DECISIONS=new Set(['STRONG_BUY','BUY','ACCUMULATE','WATCH','WAIT','AVOID']);
export function toPredictionCandidates(items,results){
 if(!Array.isArray(items)||!Array.isArray(results)||items.length!==results.length)throw Error('SCORE_COUNT_MISMATCH');
 return items.map((item,i)=>{
  const score=results[i];
  if(!item?.base?.mint||!item?.pairAddress||score?.mint!==item.base.mint||score?.pairAddress!==item.pairAddress)throw Error('SCORE_IDENTITY_MISMATCH');
  if(!DECISIONS.has(score.decision)||!Number.isFinite(score.score))throw Error('INVALID_SCORE');
  const risk=item.risk||{};
  const verified=risk.rugCheck==='SAFE'&&risk.whaleConcentration==='SAFE';
  const decision=!verified&&['STRONG_BUY','BUY','ACCUMULATE'].includes(score.decision)?'WATCH':score.decision;
  return {token_ca:item.base.mint,pair_address:item.pairAddress,observed_at:item.observedAt,decision,raw_decision:score.decision,ai_score:score.score,model:score.model||'UNKNOWN',risk_verified:verified,reason:verified?null:'RISK_UNVERIFIED',source:'scanner-stage'};
 });
}
