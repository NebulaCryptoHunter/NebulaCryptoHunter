// Same-mint, same-pool point observations. No forecast label, ATH, drawdown or win-rate claim.
export async function evaluateResearch(db){
 if(!db)return {status:'NOT_CONFIGURED'};
 const result=await db.prepare(`WITH observations AS NOT MATERIALIZED (
 SELECT id,mint,pair_address,observed_at,julianday(observed_at) ts,
 json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.priceUsd') price,
 json_type(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.priceUsd') price_type,
 json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.base.mint') payload_mint,
 json_extract(CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END,'$.pairAddress') payload_pair FROM scanner_snapshots
 )
 INSERT OR IGNORE INTO candidate_evaluations(candidate_id,entry_snapshot_id,exit_snapshot_id,entry_price,exit_price,roi_pct,observed_at,evaluated_at,status,model,window_seconds)
 SELECT c.id,a.id,b.id,a.price,b.price,(1.0*b.price/a.price-1)*100,b.observed_at,datetime('now'),'COMPLETED','observed-return-v2',CAST(ROUND((b.ts-a.ts)*86400) AS INTEGER)
 FROM (SELECT * FROM prediction_candidates q WHERE NOT EXISTS(SELECT 1 FROM candidate_evaluations done WHERE done.candidate_id=q.id)
  AND julianday(q.observed_at)<=julianday('now')-30.0/1440 ORDER BY q.observed_at DESC,q.id DESC LIMIT 200) c
 JOIN observations a ON a.mint=c.mint AND a.pair_address=c.pair_address AND a.observed_at=c.observed_at
 JOIN observations b ON b.id=(SELECT x.id FROM observations x
  WHERE x.mint=a.mint AND x.pair_address=a.pair_address AND x.payload_mint=a.mint AND x.payload_pair=a.pair_address
  AND x.observed_at>=strftime('%Y-%m-%dT%H:%M:%S',a.ts+30.0/1440)
  AND x.observed_at<strftime('%Y-%m-%dT%H:%M:%S',a.ts+90.0/1440+1.0/86400)
  AND x.ts>=a.ts+30.0/1440 AND x.ts<=a.ts+90.0/1440 AND x.ts<=julianday('now')
  AND x.price_type IN ('integer','real') AND x.price>0 ORDER BY x.ts,x.id LIMIT 1)
 WHERE a.price_type IN ('integer','real') AND a.price>0 AND a.payload_mint=c.mint AND a.payload_pair=c.pair_address
 AND a.ts<=julianday('now') AND abs((1.0*b.price/a.price-1)*100)<1e308
 AND NOT EXISTS(SELECT 1 FROM candidate_evaluations e WHERE e.candidate_id=c.id)
 ORDER BY c.observed_at,c.id LIMIT 200`).run();
 return {status:'COMPLETED',inserted:result.meta?.changes||0};
}
