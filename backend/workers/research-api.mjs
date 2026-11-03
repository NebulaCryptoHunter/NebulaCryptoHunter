import {modelValidation} from './model-validation.mjs';
// Cache aggregate scans separately: exact totals need not rescan legacy tables every HUD refresh.
async function aggregateCache(key,produce){
 const url='https://nebula.internal/canonical-d1-aggregate-v2/'+key;
 try{const r=await globalThis.caches?.default?.match(url);if(r){const saved=await r.json();if(Array.isArray(saved.results))return saved}}catch{}
 // Six-hour aggregate TTL reduces table-count scans across globally distributed POPs; countsAsOf remains explicit.
 const result={...await produce(),countsAsOf:new Date().toISOString()};
 try{await globalThis.caches?.default?.put(url,Response.json(result,{headers:{'Cache-Control':'public,max-age=21600'}}))}catch{}
 return result;
}
export async function researchData(db){
 const queries=[
 `SELECT s.id,s.mint,s.pair_address,s.observed_at,s.liquidity_usd,s.volume_24h,s.change_24h,json_extract(s.payload_json,'$.priceUsd') price_usd,json_extract(s.payload_json,'$.base.symbol') symbol,json_extract(s.payload_json,'$.source') source,json_extract(s.payload_json,'$.sourceAsOf') source_as_of,e.decision,e.score,e.model,json_extract(e.payload_json,'$.reasons') reasons,json_extract(e.payload_json,'$.components') components,json_extract(e.payload_json,'$.metrics') metrics,json_extract(e.payload_json,'$.dataCoverage') dataCoverage,json_extract(s.payload_json,'$.timeframes') timeframes,json_extract(e.payload_json,'$.riskFlags') riskFlags,json_extract(e.payload_json,'$.setupStage') setupStage,json_extract(e.payload_json,'$.scoreBreakdown') scoreBreakdown,json_extract(e.payload_json,'$.riskAssessment') riskAssessment,json_extract(s.payload_json,'$.tokenMetadata') tokenMetadata,json_extract(s.payload_json,'$.verificationEvidence') verificationEvidence
 FROM (SELECT * FROM scanner_snapshots ORDER BY id DESC LIMIT 800) s
 LEFT JOIN engine_scores e ON e.id=(SELECT x.id FROM engine_scores x
 WHERE x.mint=s.mint AND x.pair_address=s.pair_address AND x.observed_at=s.observed_at
 ORDER BY x.id DESC LIMIT 1)
 ORDER BY s.id DESC`,
 `SELECT id,started_at,completed_at,status,selected_count,snapshot_count,error FROM scanner_runs ORDER BY started_at DESC,id DESC LIMIT 10`,
 `SELECT (SELECT COUNT(*) FROM scanner_snapshots) snapshots,(SELECT COUNT(DISTINCT mint) FROM scanner_snapshots) tokens,(SELECT COUNT(*) FROM engine_scores) scores,(SELECT COUNT(*) FROM prediction_candidates) candidates,(SELECT COUNT(*) FROM candidate_evaluations) evaluations,(SELECT COUNT(*) FROM predictions) legacy_predictions,(SELECT COUNT(*) FROM evaluations) legacy_evaluations,(SELECT COUNT(*) FROM predictions)+(SELECT COUNT(*) FROM prediction_candidates) total_records,(SELECT COUNT(*) FROM predictions)+(SELECT COUNT(*) FROM prediction_candidates)+(SELECT COUNT(*) FROM scanner_snapshots)+(SELECT COUNT(*) FROM engine_scores)+(SELECT COUNT(*) FROM evaluations)+(SELECT COUNT(*) FROM candidate_evaluations)+(SELECT COUNT(*) FROM scanner_runs) AS database_records,(SELECT COUNT(*) FROM evaluations)+(SELECT COUNT(*) FROM candidate_evaluations) total_evaluations,(SELECT COUNT(*) FROM (SELECT token_ca AS mint FROM predictions UNION SELECT mint FROM prediction_candidates)) unique_mints`,
 `SELECT c.id,c.mint,c.pair_address,c.observed_at,c.decision,c.ai_score,c.model,c.risk_verified,c.reason,e.entry_price,e.exit_price,e.roi_pct,e.observed_at evaluation_observed_at,e.evaluated_at,e.window_seconds,CASE WHEN e.id IS NOT NULL THEN e.status WHEN julianday('now')>julianday(c.observed_at)+90.0/1440 THEN 'MISSING_OBSERVATION' ELSE 'PENDING' END evaluation_status FROM prediction_candidates c LEFT JOIN candidate_evaluations e ON e.candidate_id=c.id ORDER BY c.observed_at DESC,c.id DESC LIMIT 50`,
 `SELECT e.*,c.mint,c.pair_address FROM candidate_evaluations e JOIN prediction_candidates c ON c.id=e.candidate_id ORDER BY e.evaluated_at DESC,e.id DESC LIMIT 50`
 ];
 const aggregate=await aggregateCache('research-counts',async()=>{const [counts]=await db.batch([db.prepare(queries[2])]);return counts});
 const rest=await db.batch(queries.filter((_,i)=>i!==2).map(q=>db.prepare(q)));
 const rows=[rest[0],rest[1],aggregate,rest[2],rest[3]];
 // De-duplicate the bounded recent snapshot window in memory; do not execute a correlated MAX() against the entire D1 table for each row.
 const seen=new Set(),items=[];
 for(const row of rows[0].results||[]){
  const key=JSON.stringify([row.mint,row.pair_address]);
  if(seen.has(key))continue;
  seen.add(key);items.push(row);
  if(items.length>=50)break;
 }
 items.sort((a,b)=>String(b.observed_at||'').localeCompare(String(a.observed_at||''))||Number(b.id||0)-Number(a.id||0));
 return {items,scoreValidation:modelValidation(rows[3].results),runs:rows[1].results,counts:rows[2].results[0],candidates:rows[3].results,evaluations:rows[4].results,modelCalibrated:false,countsAsOf:aggregate.countsAsOf||null,evaluationDefinition:'First same-pool price observed 30–90 minutes after candidate; point-in-time return, not trade P&L or win rate',source:'research-d1',generatedAt:new Date().toISOString()};
}

/**
 * Single read source for all historical and scanner research records.
 * The view lives in canonical D1 nebula-db; the source tables remain intact.
 * Pagination uses a prefixed record key and ISO-normalized observed times.
 */
export async function unifiedHistory(db,{limit=25,offset=0}={}){
 const lm=Math.min(100,Math.max(1,Number.isInteger(limit)?limit:25));
 const of=Math.min(1000000,Math.max(0,Number.isInteger(offset)?offset:0));
 const [page]=await db.batch([
  db.prepare(`SELECT record_key,record_source,source_id,mint,symbol,decision,ai_score,observed_at,pair_address,model,evaluation_status,roi_pct
   FROM nebula_unified_records_v1
   ORDER BY REPLACE(observed_at,' ','T') DESC,record_key DESC LIMIT ? OFFSET ?`).bind(lm,of)
 ]);
 const total=await aggregateCache('unified-total',async()=>{const [result]=await db.batch([db.prepare('SELECT COUNT(*) AS total FROM nebula_unified_records_v1')]);return result});
 return {items:page.results||[],total:Number(total.results?.[0]?.total||0),limit:lm,offset:of,countsAsOf:total.countsAsOf||null,source:'nebula-db',recordModel:'legacy-plus-scanner-v1'};
}
export async function unifiedRadarHistory(db,{limit=25,offset=0}={}){
 const lm=Math.min(100,Math.max(1,Number.isInteger(limit)?limit:25)),of=Math.min(1000000,Math.max(0,Number.isInteger(offset)?offset:0));
 const [page]=await db.batch([db.prepare(`SELECT * FROM nebula_unified_records_v2
  ORDER BY REPLACE(observed_at,' ','T') DESC,record_key DESC LIMIT ? OFFSET ?`).bind(lm,of)]);
 const total=await aggregateCache('unified-total-with-tracking-v2',async()=>{const [result]=await db.batch([db.prepare('SELECT COUNT(*) AS total FROM nebula_unified_records_v2')]);return result});
 return {items:page.results||[],total:Number(total.results?.[0]?.total||0),limit:lm,offset:of,countsAsOf:total.countsAsOf||null,source:'nebula-db',recordModel:'legacy-plus-scanner-plus-tracking-v2'};
}
