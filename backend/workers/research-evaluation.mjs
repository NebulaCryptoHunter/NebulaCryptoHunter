// Point-in-time, same-pool observations. No fabricated OHLCV or win-rate.
export async function evaluateResearch(db){
 if(!db)return {status:'NOT_CONFIGURED'};
 const result=await db.prepare(`INSERT OR IGNORE INTO candidate_evaluations(candidate_id,entry_snapshot_id,exit_snapshot_id,entry_price,exit_price,roi_pct,observed_at,evaluated_at,status,model,window_seconds)
 SELECT c.id,a.id,b.id,json_extract(a.payload_json,'$.priceUsd'),json_extract(b.payload_json,'$.priceUsd'),
 (1.0*json_extract(b.payload_json,'$.priceUsd')/json_extract(a.payload_json,'$.priceUsd')-1)*100,b.observed_at,datetime('now'),'COMPLETED','observed-return-v1',CAST((julianday(b.observed_at)-julianday(a.observed_at))*86400 AS INTEGER)
 FROM prediction_candidates c JOIN scanner_snapshots a ON a.mint=c.mint AND a.pair_address=c.pair_address AND a.observed_at=c.observed_at
 JOIN scanner_snapshots b ON b.id=(SELECT x.id FROM scanner_snapshots x WHERE x.mint=a.mint AND x.pair_address=a.pair_address AND julianday(x.observed_at)>=julianday(a.observed_at)+30.0/1440 AND julianday(x.observed_at)<=julianday(a.observed_at)+90.0/1440 AND json_extract(x.payload_json,'$.priceUsd')>0 ORDER BY x.observed_at LIMIT 1)
 WHERE json_extract(a.payload_json,'$.priceUsd')>0 AND NOT EXISTS(SELECT 1 FROM candidate_evaluations e WHERE e.candidate_id=c.id) LIMIT 200`).run();
 return {status:'COMPLETED',inserted:result.meta?.changes||0};
}
