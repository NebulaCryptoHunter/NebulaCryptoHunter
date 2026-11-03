# Persistent radar and versioned research outcomes

This change keeps eligible Solana tokens in server-side tracking when discovery/feed batches change. It preserves the existing HUD/CSS, fonts, graphics, animations, score model and research-only behavior.

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
- Frontend: labels occupy existing badge/provenance/detail/catalog slots. No CSS or static layout changes.

## Resource constraint

The Cloudflare R2 API currently returns code 10042: “Please enable R2 through the Cloudflare Dashboard.” No account activation, billing change or subscription was attempted. Optional ARCHIVE binding support is prepared for candle objects and latest snapshot recovery, but cannot be claimed active until R2 is enabled and a bucket is bound. D1 plus bounded Cache API fallback remains usable; complete protection against D1 exhaustion requires the separate durable archive.

## Verification/deployment

Implementation and verification are in progress. No production migration or deployment has been performed at the time of this initial record. The pre-change repository suite has six documented unrelated UI contract failures and two browser skips. New behavioral tests use isolated local SQLite; no synthetic candidate is inserted into production.
