# NEBULA — Dual SCAN / SINKRON controls (1 November 2026)

## Purpose
Restore the green primary HUD **SCAN** button to initiate a genuine server-side batch scan, while adding cyan **SINKRON** to refresh only persisted research data. Preserve the purple **AUTO** frontend refresh toggle; Cloudflare scanner cron remains `*/30 * * * *`.

## Paths
- `SCAN` invokes `POST /api/research/scan-now` with JSON `{}`. Endpoint requires same-origin Origin, authenticated `SUPER_ADMIN`, and a completed first-login password change. It calls `SCANNER` service binding `POST https://scanner.internal/run` with the private `MANUAL_SCAN_TOKEN`.
- Scanner `/run` accepts `INTERNAL_TOKEN` as before, or the separate `MANUAL_SCAN_TOKEN`; it does **not** expose those values to the browser. Scanner runs the existing `runScheduledScan` batch logic (discovery/cached watchlist selection, DexScreener, AI scores, D1 snapshots), not a UI-only sync.
- Manual key `manual:<15-min bucket>` prevents repeated scans within a 15-minute interval. Scheduled cron keeps its existing `cron:<30-min bucket>` key. Provider cooldown and dedup return HTTP 429, not success. HTTP 502 marks scanner failure.
- Successful response reports `selectedCount`, `snapshotCount`, and `COMPLETED` or `EMPTY` status. HUD then reads back persisted data (same as SINKRON).
- `SINKRON` reuses existing read-only `Scanner.requestScan` logic, unchanged except button target `syncBtn`.
- Existing `SCAN MANUAL · ADMIN` detail remains available for targeted Solana mint scans (up to 5 mints). This is separate from the new one-click batch SCAN.
- `AUTO` continues to control frontend refresh only; does not affect Cloudflare cron or trigger new server scans.

## Safety and rollout
No DB migrations, new secrets, wallets, auto-trading or cron changes. Preserve `nebula-db`, `nebula-auth-stage`, current Worker bindings, and historical predictions. GitHub CI must pass before merge. Frontend deploy follows merge through the existing GitHub pipeline; scanner Worker must be separately bundled and deployed to Cloudflare after review, retaining `STAGE_DB`, `AI_ENGINE`, `INTERNAL_TOKEN`, and `MANUAL_SCAN_TOKEN` bindings. Validate Worker versions, cron, DB counts. Do not claim end-to-end user-authenticated scan success until a real Admin session has been exercised.

## Rollback
If deployment fails, redeploy preceding verified Worker version without changing D1. The unchanged AUTO cron must continue independently.
