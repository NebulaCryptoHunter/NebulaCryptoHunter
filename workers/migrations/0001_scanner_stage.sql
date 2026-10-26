-- Staging only: nebula-scanner-stage. Never apply directly to nebula-db production.
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
CREATE INDEX IF NOT EXISTS idx_scanner_snapshots_mint_time ON scanner_snapshots(mint,observed_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_engine_scores_mint_time ON engine_scores(mint,observed_at DESC);
