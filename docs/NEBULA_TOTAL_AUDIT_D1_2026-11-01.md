# NEBULA Crypto Hunter — Total Audit 2026-11-01 (D1 Quota Critical)
Status: confirmed production incident and code remediation PR. No D1 data deleted or credentials changed.

## Runtime findings
- Production Cloudflare D1 `nebula-db` query returned HTTP 400 / code 7500: **Your account has exceeded D1's free tier daily row read limit**.
- Six key Workers have active versions and expected service/D1 bindings: frontend, API, scanner, AI Engine, evaluation, and auth.
- Scanner and evaluation have cron `*/30 * * * *`; this means scheduled invocations exist, **not proof of successful execution** while D1 is over quota.
- Historical data has not been reset. Current D1 counts, active evaluation runs and provider outcomes cannot be read reliably until quota resets.
- GitHub regression CI main passed before audit; earlier frontend-only tests do not prove real browser interactions with an authenticated Admin.

## Heavy read sources identified in code
1. `/api/research/latest` performs 5 queries in a D1 batch including counts over legacy predictions + scanner tables, and historical unique-mint UNION.
2. Frontend autoScan was fetching /latest every minute; an additional independent serverRefresh was fetching the same data every minute.
3. `loadHistoricalSummary()` fetched /latest on startup and every five minutes, duplicating count reads.
4. Hunter companion refreshed /latest plus a paginated UNION history endpoint every minute.
5. Prior to remediation all public GET routes returned browser `Cache-Control: no-store` without an edge-cache layer; concurrent visitors multiply read work.

## Remediation
- New `backend/workers/research-cache.mjs` caches only public anonymous D1 research GET JSON in the Cloudflare Cache API, normalized to avoid arbitrary latest querystring bypass. Latest TTL 3 minutes; paginated history 10 minutes; max retained stale cache 24 hours, always explicit `dataStatus: STALE`.
- Public responses still use `no-store` in browser; no auth tokens, sessions or private writes go into this cache.
- Per-isolate concurrent request coalescing; on D1 read quota error stop repeating doomed DB queries for remainder of UTC day. If no cache exists, return explicit HTTP 503 `D1_DAILY_READ_LIMIT`, reset timestamp at midnight UTC and Retry-After.
- On a successful Admin manual SCAN, invalidate the latest plus first history page cache so new scans are not falsely hidden.
- Frontend drops redundant serverRefresh and archive requests, shares counts from one response, changes background auto refresh to every 3 minutes and honours AUTO OFF.
- Do not label stale cached values `LIVE`. No scientific metric or fake AI outcomes are created.

## Next checks when Cloudflare resets
1. Check that D1 queries work after 00:00 UTC (07:00 Asia/Jakarta next calendar day).
2. Compare actual rows_read/rows_written in Cloudflare D1 metrics; confirm budget is sustainable.
3. Read scanner_runs statuses and diagnostics only after quota recovers; resolve true upstream provider rate limits distinctly.
4. Exercise Admin SCAN and SINKRON in authenticated browser; verify true incremental snapshots vs provider 429.
5. Check `/api/research/latest` reports LIVE/CACHED/STALE correctly; ensure all UI indicators, token actions and exports work across desktop/Android.
6. Consider targeted D1 indexes and query EXPLAIN for legacy evaluation worker when DB is available. Do not create indexes blindly during quota incident.

## Operational reality
Free-tier D1 usage enforcement is performed server side. Changing client code cannot immediately reset the daily quota. Official Cloudflare changelog confirms queries fail until **midnight UTC**, stored data remains unaffected. If operational uptime is essential, moving the Cloudflare account to paid Workers is an optional billing decision for the owner, not something the assistant should do without authorization.
