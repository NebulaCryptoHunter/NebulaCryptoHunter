-- NEBULA unified D1 scanner schema. Additive, idempotent; NEVER drop legacy tables.
-- Canonical production D1: nebula-db. Apply only after backup/bookmark and schema review.

CREATE TABLE IF NOT EXISTS scanner_snapshots (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mint TEXT NOT NULL,
 pair_address TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 liquidity_usd REAL,
 volume_24h REAL,
 change_24h REAL,
 payload_json TEXT NOT NULL,
 UNIQUE(mint,pair_address,observed_at)
);
CREATE TABLE IF NOT EXISTS prediction_candidates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mint TEXT NOT NULL,
 pair_address TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 decision TEXT NOT NULL,
 raw_decision TEXT NOT NULL,
 ai_score REAL NOT NULL,
 model TEXT NOT NULL,
 risk_verified INTEGER NOT NULL DEFAULT 0,
 reason TEXT,
 source TEXT NOT NULL DEFAULT 'scanner-stage',
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(mint,pair_address,observed_at)
);
CREATE TABLE IF NOT EXISTS engine_scores (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 mint TEXT NOT NULL,
 pair_address TEXT,
 observed_at TEXT NOT NULL,
 model TEXT NOT NULL,
 decision TEXT NOT NULL,
 score REAL,
 payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidate_evaluations (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 candidate_id INTEGER NOT NULL UNIQUE REFERENCES prediction_candidates(id),
 entry_snapshot_id INTEGER NOT NULL REFERENCES scanner_snapshots(id),
 exit_snapshot_id INTEGER NOT NULL REFERENCES scanner_snapshots(id),
 entry_price REAL NOT NULL CHECK(entry_price>0),
 exit_price REAL NOT NULL CHECK(exit_price>0),
 roi_pct REAL NOT NULL,
 observed_at TEXT NOT NULL,
 evaluated_at TEXT NOT NULL,
 status TEXT NOT NULL,
 model TEXT NOT NULL,
 window_seconds INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scanner_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 schedule_key TEXT NOT NULL UNIQUE,
 started_at TEXT NOT NULL,
 completed_at TEXT,
 status TEXT NOT NULL,
 selected_count INTEGER NOT NULL DEFAULT 0,
 snapshot_count INTEGER NOT NULL DEFAULT 0,
 results_json TEXT NOT NULL DEFAULT '[]',
 error TEXT
);
CREATE TABLE IF NOT EXISTS scanner_diagnostics (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 observed_at TEXT NOT NULL,
 stage TEXT NOT NULL,
 status TEXT NOT NULL,
 detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scanner_state (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scanner_latest_pair ON scanner_snapshots(mint,pair_address,id);
CREATE INDEX IF NOT EXISTS engine_snapshot_identity ON engine_scores(mint,pair_address,observed_at,id);
CREATE INDEX IF NOT EXISTS idx_engine_scores_mint_time ON engine_scores(mint,observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_candidates_observed ON prediction_candidates(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_snapshots_mint_time ON scanner_snapshots(mint,observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS scanner_score_dedupe ON engine_scores(mint,pair_address,observed_at,model);
CREATE UNIQUE INDEX IF NOT EXISTS scanner_diagnostic_dedupe ON scanner_diagnostics(observed_at,stage,status,detail);
CREATE TRIGGER IF NOT EXISTS trg_engine_scores_candidate_safe AFTER INSERT ON engine_scores
 WHEN NEW.pair_address IS NOT NULL AND NEW.score IS NOT NULL
 BEGIN
  INSERT OR IGNORE INTO prediction_candidates
   (mint,pair_address,observed_at,decision,raw_decision,ai_score,model,risk_verified,reason,source,payload_json)
  VALUES
   (NEW.mint,NEW.pair_address,NEW.observed_at,'WATCH',NEW.decision,NEW.score,NEW.model,0,'RISK_UNVERIFIED','scanner-db-trigger',json_object('score_id',NEW.id,'raw_decision',NEW.decision,'score',NEW.score,'risk_verified',0));
 END;
