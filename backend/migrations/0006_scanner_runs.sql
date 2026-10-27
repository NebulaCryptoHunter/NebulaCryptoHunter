CREATE TABLE IF NOT EXISTS scanner_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, schedule_key TEXT NOT NULL UNIQUE, started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL, selected_count INTEGER NOT NULL DEFAULT 0, snapshot_count INTEGER NOT NULL DEFAULT 0, results_json TEXT NOT NULL DEFAULT '[]', error TEXT);
CREATE TABLE IF NOT EXISTS scanner_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS scanner_latest_pair ON scanner_snapshots(mint,pair_address,id);
CREATE INDEX IF NOT EXISTS engine_snapshot_identity ON engine_scores(mint,pair_address,observed_at,id);
