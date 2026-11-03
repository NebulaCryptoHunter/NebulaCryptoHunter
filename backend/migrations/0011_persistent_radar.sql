-- Additive research tracking. Existing scanner, predictions and history stay intact.
CREATE TABLE IF NOT EXISTS radar_discovery_registry (
 mint TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
 last_scanned_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS radar_discovery_rotation ON radar_discovery_registry(last_scanned_at,mint);
INSERT OR IGNORE INTO radar_discovery_registry(mint,first_seen_at,last_seen_at,last_scanned_at)
 SELECT mint,MIN(observed_at),MAX(observed_at),MAX(observed_at) FROM scanner_snapshots GROUP BY mint;
CREATE TABLE IF NOT EXISTS radar_tracks (
 mint TEXT PRIMARY KEY, pair_address TEXT NOT NULL, episode_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('ACTIVE','WEAK','EXITED')),
 first_seen_at TEXT NOT NULL, first_price REAL NOT NULL CHECK(first_price>0),
 first_score REAL NOT NULL, last_observed_at TEXT NOT NULL,
 last_price REAL NOT NULL CHECK(last_price>0), last_score REAL,
 peak_price REAL NOT NULL, weak_count INTEGER NOT NULL DEFAULT 0,
 weak_since TEXT, next_due_at TEXT NOT NULL, last_checkpoint_at TEXT,
 exit_reason TEXT, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- Avoid rewriting an index on next_due_at for every one-minute price update.
CREATE INDEX IF NOT EXISTS radar_tracks_state ON radar_tracks(state);
CREATE TABLE IF NOT EXISTS radar_pattern_evidence (
 evidence_id TEXT PRIMARY KEY, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
 closed_at TEXT NOT NULL, candles_json TEXT NOT NULL, pattern_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_events (
 event_id TEXT PRIMARY KEY, mint TEXT NOT NULL, episode_id TEXT NOT NULL,
 observed_at TEXT NOT NULL, kind TEXT NOT NULL, detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS radar_events_episode ON radar_events(episode_id,observed_at);
CREATE TABLE IF NOT EXISTS radar_signals (
 signal_id TEXT PRIMARY KEY, mint TEXT NOT NULL, pair_address TEXT NOT NULL,
 episode_id TEXT NOT NULL, algorithm TEXT NOT NULL, version TEXT NOT NULL,
 detected_at TEXT NOT NULL, entry_price REAL NOT NULL CHECK(entry_price>0),
 horizon_seconds INTEGER NOT NULL, target_pct REAL NOT NULL,
 due_at TEXT NOT NULL, deadline_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','SUCCESS','FAILED_TARGET','INDETERMINATE')),
 exit_price REAL, roi_pct REAL, evaluated_at TEXT, detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS radar_signals_due ON radar_signals(status,due_at);
CREATE TABLE IF NOT EXISTS radar_runtime (
 key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE VIEW IF NOT EXISTS nebula_unified_records_v2 AS
SELECT v.*,NULL AS tracking_json FROM nebula_unified_records_v1 v
UNION ALL
SELECT 'tracking:'||t.episode_id,'TRACKING',t.mint,t.mint,
 COALESCE(json_extract(t.payload_json,'$.item.symbol'),substr(t.mint,1,12)),
 'WATCH',t.last_score,t.last_observed_at,t.pair_address,
 json_extract(t.payload_json,'$.item.model'),'TRACKING',
 (t.last_price/t.first_price-1)*100,
 json_object('state',t.state,'pattern',json_extract(t.payload_json,'$.pattern.type'),
 'firstSeenAt',t.first_seen_at,'firstPrice',t.first_price,'firstScore',t.first_score,
 'exitReason',t.exit_reason,'lastObservedAt',t.last_observed_at)
FROM radar_tracks t;
