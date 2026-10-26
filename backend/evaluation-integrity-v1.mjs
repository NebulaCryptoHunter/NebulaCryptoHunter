/** NEBULA evaluation integrity guard. No D1 writes; integrate only after staging tests. */
export const WINDOWS_MS=Object.freeze({'30m':1800000,'2h':7200000,'6h':21600000,'24h':86400000,'3d':259200000,'7d':604800000});
export function classifyEvaluation({createdAt,windowKey,observedAt,entryPrice,observedPrice,toleranceMs=120000}={}){
  const start=Date.parse(createdAt), observed=Date.parse(observedAt), window=WINDOWS_MS[windowKey];
  if(!Number.isFinite(start)||!Number.isFinite(observed)||!window)return {status:'INVALID_INPUT',roi:null};
  if(typeof entryPrice!=='number'||!Number.isFinite(entryPrice)||entryPrice<=0)return {status:'INVALID_ENTRY_PRICE',roi:null};
  if(typeof observedPrice!=='number'||!Number.isFinite(observedPrice)||observedPrice<=0)return {status:'PRICE_UNAVAILABLE',roi:null};
  if(!Number.isFinite(toleranceMs)||toleranceMs<0)return {status:'INVALID_INPUT',roi:null};
  const target=start+window;
  if(observed<target-toleranceMs)return {status:'NOT_MATURE',roi:null};
  if(observed>target+toleranceMs)return {status:'HISTORICAL_PRICE_REQUIRED',roi:null,targetAt:new Date(target).toISOString()};
  return {status:'VALID',roi:(observedPrice/entryPrice-1)*100,targetAt:new Date(target).toISOString()};
}
export function evaluationCandidatesSql(){
  return `SELECT p.* FROM predictions p
LEFT JOIN evaluations e ON p.id=e.prediction_id AND e.evaluation_window=?
WHERE p.learning_status IN ('PENDING','EVALUATED')
AND datetime(p.created_at)<=datetime(?)
AND length(p.token_ca) BETWEEN 32 AND 44
AND p.entry_price>0 AND e.id IS NULL
ORDER BY p.created_at ASC LIMIT ?`;
}
