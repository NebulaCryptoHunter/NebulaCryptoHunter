-- NEBULA unified read model: single database (nebula-db), no copied data.
-- Legacy predictions and new prediction_candidates remain in their original tables.
-- Each source_id is namespaced in record_key to avoid collisions; snapshots are
-- supporting observations, not separately counted as prediction records.
CREATE VIEW IF NOT EXISTS nebula_unified_records_v1 AS
SELECT
 'legacy:' || CAST(p.id AS TEXT) AS record_key,
 'LEGACY' AS record_source,
 p.id AS source_id,
 p.token_ca AS mint,
 COALESCE(NULLIF(p.token_symbol,''),NULLIF(p.token_name,''),substr(p.token_ca,1,12)) AS symbol,
 p.decision AS decision,
 p.ai_score AS ai_score,
 p.created_at AS observed_at,
 NULL AS pair_address,
 p.version AS model,
 CASE WHEN p.learning_status='EVALUATED' THEN 'EVALUATED' ELSE 'PENDING' END AS evaluation_status,
 NULL AS roi_pct
FROM predictions p
UNION ALL
SELECT
 'scanner:' || CAST(c.id AS TEXT) AS record_key,
 'SCANNER' AS record_source,
 c.id AS source_id,
 c.mint AS mint,
 COALESCE(NULLIF(json_extract(s.payload_json,'$.base.symbol'),''),substr(c.mint,1,12)) AS symbol,
 c.decision AS decision,
 c.ai_score AS ai_score,
 c.observed_at AS observed_at,
 c.pair_address AS pair_address,
 c.model AS model,
 COALESCE(e.status,'PENDING') AS evaluation_status,
 e.roi_pct AS roi_pct
FROM prediction_candidates c
LEFT JOIN scanner_snapshots s ON s.mint=c.mint AND s.pair_address=c.pair_address AND s.observed_at=c.observed_at
LEFT JOIN candidate_evaluations e ON e.candidate_id=c.id;
