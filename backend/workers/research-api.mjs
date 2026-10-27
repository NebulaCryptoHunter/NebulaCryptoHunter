export async function researchData(db){
 const queries=[
 `SELECT s.id,s.mint,s.pair_address,s.observed_at,s.liquidity_usd,s.volume_24h,s.change_24h,json_extract(s.payload_json,'$.priceUsd') price_usd,json_extract(s.payload_json,'$.base.symbol') symbol,json_extract(s.payload_json,'$.source') source,e.decision,e.score,e.model,json_extract(e.payload_json,'$.reasons') reasons FROM scanner_snapshots s LEFT JOIN engine_scores e ON e.id=(SELECT MAX(x.id) FROM engine_scores x WHERE x.mint=s.mint AND x.pair_address=s.pair_address AND x.observed_at=s.observed_at) WHERE s.id=(SELECT MAX(x.id) FROM scanner_snapshots x WHERE x.mint=s.mint AND x.pair_address=s.pair_address) ORDER BY s.id DESC LIMIT 50`,
 `SELECT id,started_at,completed_at,status,selected_count,snapshot_count,error FROM scanner_runs ORDER BY id DESC LIMIT 10`,
 `SELECT (SELECT COUNT(*) FROM scanner_snapshots) snapshots,(SELECT COUNT(DISTINCT mint) FROM scanner_snapshots) tokens,(SELECT COUNT(*) FROM engine_scores) scores,(SELECT COUNT(*) FROM prediction_candidates) candidates,(SELECT COUNT(*) FROM candidate_evaluations) evaluations`,
 `SELECT c.id,c.mint,c.pair_address,c.observed_at,c.decision,c.ai_score,c.model,c.risk_verified,c.reason,e.entry_price,e.exit_price,e.roi_pct,e.observed_at evaluation_observed_at,e.evaluated_at,e.window_seconds,CASE WHEN e.id IS NOT NULL THEN e.status WHEN julianday('now')>julianday(c.observed_at)+90.0/1440 THEN 'MISSING_OBSERVATION' ELSE 'PENDING' END evaluation_status FROM prediction_candidates c LEFT JOIN candidate_evaluations e ON e.candidate_id=c.id ORDER BY c.id DESC LIMIT 50`,
 `SELECT e.*,c.mint,c.pair_address FROM candidate_evaluations e JOIN prediction_candidates c ON c.id=e.candidate_id ORDER BY e.id DESC LIMIT 50`
 ];
 const rows=await db.batch(queries.map(q=>db.prepare(q)));
 return {items:rows[0].results,runs:rows[1].results,counts:rows[2].results[0],candidates:rows[3].results,evaluations:rows[4].results,modelCalibrated:false,evaluationDefinition:'First same-pool price observed 30–90 minutes after candidate; point-in-time return, not trade P&L or win rate',source:'research-d1',generatedAt:new Date().toISOString()};
}
