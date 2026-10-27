-- NEBULA scanner-stage only; apply to scanner-stage D1, NEVER production without review.
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
CREATE INDEX IF NOT EXISTS idx_prediction_candidates_observed ON prediction_candidates(observed_at DESC);
