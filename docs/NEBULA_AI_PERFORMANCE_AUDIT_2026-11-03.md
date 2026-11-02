# AI Performance audit — 3 November 2026 (WIB)

The original panel mixed market-field coverage with four permanently empty classification/trading bars. V4 produces WATCH/REVIEW research scores, not a binary trading classifier. The replacement retains eight colored bars, the HUD, fonts and decorative model orbit while reporting measured data quality, readiness and descriptive follow-ups.

## Corrected indicator mapping

| Instrument | Numerator | Denominator | Limits |
| --- | --- | --- | --- |
| DATA POOL | Visible unique mints with a pool address, positive numeric price and liquidity | Visible unique mints | A pool is not a security verdict |
| HARGA | Visible unique mints with positive numeric prices | Visible unique mints | Freshness is reported separately |
| SKOR V4 | Visible unique mints with a numeric 0–100 score from the active model | Visible unique mints | Score zero counts; other models do not count as V4 |
| API AKTIF | Current HEALTHY responses for configured provider identities | All 12 configured connections | Missing/duplicate providers do not count; old probes expire after 15 minutes; disabled connections remain in the explicit denominator |
| DATA SEGAR | Valid prices whose capture and available source timestamps are within 15 minutes | Visible unique mints | Invalid/future/stale times fail; cached upstream data is not refreshed by download time |
| CEK RISIKO | Current PASS, FAIL or CONFLICT results from five limited checks | Five checks per visible V4-scored mint | Completeness, not safety; detected-risk token count is displayed too |
| EVALUASI V4 | Valid measured same-pool follow-ups 30–90 minutes later | V4 candidates aged at least 30 minutes in the latest 50 candidates | Candidates below 30 minutes are pending; missing follow-ups after 90 minutes are counted separately |
| RETURN POSITIF | Positive measured V4 point returns | All valid measured V4 point returns | Flat returns are separate; this is not strategy win rate, realized P&L or calibrated predictive performance |

Each population follows the radar's first canonical row per mint. Duplicate pool rows no longer inflate counters. No observations means unavailable (`—`), not an invented 0%. Genuine measured zero remains 0%.

`performance-metrics.mjs` owns the server definitions. Both persisted research and live-only fallback responses receive the same versioned `aiPerformance` contract. Original historical scores/models are retained. Evidence strings from D1 and live evidence objects are normalized consistently, and limited checks are assessed again at the current time rather than trusting a stale stored PASS label.

Timestamp expiry descriptors let the open frontend expire fresh-price and risk-check coverage locally, without adding polling. Provider indicators also stop displaying old green status after their evidence expires. FREE_PLAN_UNAVAILABLE and CONFIG_ERROR are distinguished from an intentionally disabled provider.

## Panel and related views

- Main subtitle now identifies DATA QUALITY & MODEL READINESS.
- EVAL V4 shows measured outcomes for the current model, rather than the all-model database total.
- The decorative orbit displays V4 and an explicit uncalibrated state. Rotation is not a validation percentage.
- The main token risk caption uses the same limited-check status as the AI panel and details; a detected risk is no longer labeled only unverified.
- The snapshot time is visible in WIB. Captions wrap instead of truncating the numerator/denominator or risk warning.
- DETAIL, AUDIT, DBG, advanced telemetry and the exported AI report use the same data definitions. They do not reuse legacy in-browser learning accuracy or classify every WATCH as a negative trade.
- Precision/Recall/F1 and trading win rate are explained as unavailable/not applicable in the detailed catalogue instead of occupying four empty primary instruments.

## Confirmed runtime failure and repair

During the live audit, the research read failed with HTTP 500/503. Cloudflare logs recorded `Body has already been used. It can only be used once. Use tee() first if you need to read it twice.`

`research-cache.mjs` stored an in-flight promise returning the same Response for concurrent requests. This shared the response stream across requests. It now creates an independent response per request and keeps caching serialized research payloads through the Cache API. No request-scoped promise or stream is kept at module scope. The concurrency regression consumes every returned response and verifies subsequent reads reuse the cache.

The gateway also attempts the independent market service on a non-quota research-read failure. A transport/read error is no longer mislabeled as an exhausted D1 quota. A stale market observation is assessed against the same 15-minute policy as scoring; if live fallback is available, history candidates/evaluations remain available for model-scoped follow-up metrics. If fallback is unavailable, archived data is explicitly stale.

The 10-minute research cache, 30-minute history cache and six-hour aggregate cache remain. No schema migration, extra SQL query per request, paid provider, trading action or new subscription is introduced. Simultaneous cold cache misses can independently read D1; this avoids sharing request I/O across Worker invocations. Existing browser request coalescing and server payload caching continue to limit repeated reads.

## Verification

- 19 new performance tests cover unique-mint denominators, strict numeric fields, model isolation, timestamp/evidence expiration, risk completeness versus safety, evaluation eligibility, positive/flat/negative observations, bounded samples, actual frontend rendering and non-quota fallback.
- Cache concurrency regression now reads all concurrent bodies, detecting the actual observed failure instead of checking only response status.
- Relevant existing frontend contracts were updated for the intentionally changed indicator semantics and the shared debug/audit handler. Unrelated assertions remain intact.
- Local targeted suite: 138 passing checks.
- Full local suite: 278 tests, 270 passed, the same six pre-existing UI-contract failures and two pre-existing browser-test skips. No claim that the repository is fully green.
- Production versions, live response checks and browser visual verification are recorded after deployment.

The V4 ranking weights and risk ceilings themselves are unchanged. These indicators make the system's actual data and validation state visible; they do not demonstrate predictive profitability.
