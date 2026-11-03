# Persistent radar and versioned research outcomes

This change keeps eligible Solana tokens in server-side tracking when discovery/feed batches change. It preserves the existing HUD design, fonts, graphics, animations, score model and research-only behavior.

## Policy

- V4 entry: score at least 60, complete/current market data, liquidity at least USD 50,000, positive 1h/5m momentum, no detected security risk or other market flags. An otherwise eligible overheated candidate may enter from base score >=60 and final score >=40, with the risk warning retained. These are provisional research filters.
- Initial targets: ten strongest tracked tokens every minute, next twenty every five minutes, other tracked tokens every thirty minutes. All stay recorded. Actual frequency is constrained by provider availability and a per-monitor D1 budget.
- Missing data, provider limits, repeated cache responses and elapsed token age do not archive a token. Critical current risk exits immediately. Other weakness requires three independent samples spaced at least five minutes, spanning at least ten minutes, with negative momentum below entry or confirmed liquidity collapse. An exit reason is retained.
- Prices remain tied to the original mint/pool. A different pool cannot silently replace the reference series.
- Market checkpoints reuse scanner_snapshots, enabling same-pool research follow-ups. Hot tokens checkpoint at five minutes; other tokens at fifteen minutes. One-minute refreshes do not create new prediction candidates.
- Historical mint rotation uses a registry seeded once from real snapshots, avoiding a full snapshot GROUP BY every scan. Research evaluation examines a bounded recent pending cohort and restricts same-pool exits using the indexed timestamp range; it is not an exhaustive historical backfill.
- When tracking is active, public feed reads use the one-row monitor snapshot. Legacy context is refreshed centrally at most every thirty minutes, so more browser viewers do not cause more provider calls or aggregate scans.

## Pattern rules

Only closed, timestamped, contiguous, exact-token OHLCV candles from the original pool qualify. At least twenty candles and observed trade activity are required. Open candles, gaps, stale series, invalid OHLC and unidentified token orientation remain unmeasured.

- Staircase: at least three confirmed higher swing highs and lows, with two subsequent closed candles confirming each pivot.
- Vertical: last-three-minute return at least 10% and six times median prior absolute minute return, plus at least twice prior comparable volume.
- Consolidation: constrained recent range after an earlier rise with moderated volume.

All thresholds are uncalibrated research rules. Detection time is the time the pattern is actually confirmed, never backdated to an earlier pivot. Pattern-input evidence is stored for new pattern signals. These detectors do not establish future profitability.

## Outcomes

Each admission/pattern transition records an algorithm version, original price, detection time and separate 30m/2h/6h/24h horizons. The declared initial paper target is +10% point return with fifteen minutes of observation tolerance. SUCCESS means the target was met at that observation; FAILED_TARGET means an observed return missed it. Missing valid observations are INDETERMINATE, not losses. Different horizons are not merged into a trading win rate. UI analytics explicitly show their bounded latest-2,000 signal/horizon scope.

## Components

- Additive migration: 0011_persistent_radar.sql.
- nebula-monitor: independent scheduled worker, cheap market updates with bounded candle requests and staggered evidence refresh.
- API: private service-binding market route; existing credentials are reused inside their original Worker, never copied.
- Scanner: admits real eligible observations after normal snapshot persistence.
- Frontend gateway: merges retained candidates, suppresses archived ones and reads the monitor snapshot. Existing history includes tracking entries through an additive v2 view.
- Frontend: labels occupy existing badge/provenance/detail/catalog slots. The visible decision badge combines state and pattern, for example `DIPANTAU · TANGGA NAIK`, because the old auxiliary data chip is intentionally hidden. Stale vertical patterns retain `POLA LAMA`. The layout and assets remain intact; the mobile title anchor is corrected from 49% to 50% to keep its frame centered.

## Durable snapshot backup

R2 still requires account activation (provider code 10042). No account activation, billing change or subscription was attempted. A private Workers KV namespace now supplies independent durable snapshot recovery through SNAPSHOT_BACKUP. The monitor writes at most once every five minutes (288 snapshot writes/day); it records the attempt before writing, so retries and provider failures cannot multiply writes each minute. Readback confirmed the actual stored snapshot at 12:17:10 WIB on 2026-11-03. The frontend catalog shows KV · TERSIMPAN.

This backup preserves the latest radar snapshot, last known prices, original timestamps, bounded algorithm aggregates and legacy feed context. It is not a complete D1 history backup or a candle-object archive. D1 remains the event/evidence system of record. Cache API is a fast fallback; KV supplies durable recovery when D1 is unavailable. Recovery never makes old observations fresh. A failed KV write does not abort token updates. Optional ARCHIVE/R2 candle support remains prepared but inactive.

## Verification/deployment

PR #64 introduced persistent radar. Follow-up `22233bb` finishes regression repair, centered mobile title geometry, bounded KV recovery and compact public metadata (legacy feed context is no longer duplicated inside radarTracking). Frontend, scanner and monitor are deployed at 100%; prior API/evaluation deployments remain active.

The GitHub full regression run passed **299/299, zero failures and zero skips**, including real-browser geometry tests. The algorithm CI also passed. Local tests passed 297/299 with only the two browser tests skipped because no local Chrome was installed; all ran in CI. The tracking suite now has 21 behavior tests, including KV cadence, provider failure isolation, stale-price recovery during D1 outage and invalid backup rejection.

The six former UI failures were obsolete assertions that the page must contain exactly one script. The shared contract now requires at least one executable block, matching opening/closing tags and valid syntax for every script. UI/control/asset/detail assertions remain. The browser failure was repaired by centering the mobile title anchor and enforcing the existing inclusive 40px mobile minimum in the test. No script-count assertion was used to remove UI functionality.

The only CSS difference is the mobile title anchor 49% → 50%; static markup, graphics, colors, fonts, card layout and animations remain unchanged. Current CSS SHA-256: `57af6b02ef4de5b52ebaf8e805759bc02e7545e70cffa2b1e91c3e36fcb43ef0`. Live 360x640 production inspection found zero horizontal overflow, header center error X=0 / Y=0.5px, and the saved KV status in the existing indicator catalog.

Workers CPU telemetry is now available through the GraphQL Analytics API despite the earlier Workers Observability HTTP 403. For nebula-monitor, the 11:20–12:00 WIB window on 2026-11-03 had 431 invocations, zero errors, CPU p50=3.240ms and p99=18.235ms. The API schema explicitly defines these source values in microseconds. The sample mixes scheduled and feed/status invocations and predates the final follow-up; it is a measurement, not a throughput benchmark or an accuracy claim. Wall time includes upstream waiting and is not CPU time.

At the latest live check the monitor reported RUNNING, no error and KV READY. The new tracking table remained empty; no synthetic candidate was inserted to create a badge or apparent success. Actual pattern/outcome evidence still requires eligible market observations and elapsed horizons. Exact versions, CI links, snapshot readback and telemetry are recorded in `NEBULA_PERSISTENT_RADAR_DEPLOYMENT.json`.
