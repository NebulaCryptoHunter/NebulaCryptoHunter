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
- Frontend: labels occupy existing badge/provenance/detail/catalog slots. The visible decision badge combines state and pattern, for example `DIPANTAU · TANGGA NAIK`, because the old auxiliary data chip is intentionally hidden. Stale vertical patterns retain `POLA LAMA`. No CSS or static layout changes.

## Resource constraint

The Cloudflare R2 API currently returns code 10042: “Please enable R2 through the Cloudflare Dashboard.” No account activation, billing change or subscription was attempted. Optional ARCHIVE binding support is prepared for candle objects and latest snapshot recovery, but cannot be claimed active until R2 is enabled and a bucket is bound. D1 plus bounded Cache API fallback remains usable; complete protection against D1 exhaustion requires the separate durable archive.

## Verification/deployment

PR #64 was merged as `085ecf8`; visible badge follow-up `cb12e5f` is deployed. The additive D1 migration, API, scanner, evaluation worker, frontend and independent monitor are live. At 04:41:10 UTC on 2026-11-03 the monitor had completed eleven scheduled runs, reported RUNNING with no error, and recorded no tracked candidate yet. Public tracking status and unified history both returned HTTP 200. No synthetic candidate was inserted into production.

Algorithm/integration checks passed 155/155, including seventeen new tracking behavior tests. The local full suite had 287 passes, six existing UI contract failures and two browser skips. GitHub CI ran the real-browser tests and had 288 passes/seven failures: the same six UI contracts plus an existing header Y-centering assertion (about 1.17px), also present before the badge follow-up. The complete suite is not green.

CSS and static markup match `23fb89f` exactly; CSS SHA-256 is `fb9c3c2d324df922f070f75199bad9ddee361fb631f88051bf611bf5e4602765`. Inline scripts parse and git diff whitespace checks pass. Badge labels fit without wrapping/overflow in isolated 320x640, 360x640 and 390x844 browser simulations. The existing 360/390 header clips a small amount of outer padding equally with the original WATCH label; text fits and header/card dimensions remain unchanged. This is UI verification, not evidence of live pattern success.

R2 remains inactive under the provider's code 10042. Runtime CPU telemetry could not be measured because the account's observability query returned HTTP 403; upload startup time is not claimed as CPU performance. Exact version IDs, schedule evidence, test counts and limitations are in `NEBULA_PERSISTENT_RADAR_DEPLOYMENT.json`.
