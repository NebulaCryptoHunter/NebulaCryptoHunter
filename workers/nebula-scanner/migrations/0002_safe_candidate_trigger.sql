-- STAGING D1 ONLY. Never apply to production without separate review.
-- Compatible with older scheduled scanner which writes engine_scores but not prediction_candidates.
-- All auto-created candidates are WATCH and RISK_UNVERIFIED; no trading authorization.
CREATE TRIGGER IF NOT EXISTS trg_engine_scores_candidate_safe
AFTER INSERT ON engine_scores
WHEN NEW.pair_address IS NOT NULL AND NEW.score IS NOT NULL
BEGIN
 INSERT OR IGNORE INTO prediction_candidates
 (mint,pair_address,observed_at,decision,raw_decision,ai_score,model,risk_verified,reason,source,payload_json)
 VALUES
 (NEW.mint,NEW.pair_address,NEW.observed_at,'WATCH',NEW.decision,NEW.score,NEW.model,0,'RISK_UNVERIFIED','scanner-db-trigger',json_object('score_id',NEW.id,'raw_decision',NEW.decision,'score',NEW.score,'risk_verified',0));
END;
