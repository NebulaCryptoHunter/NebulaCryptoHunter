# NEBULA audit evidence — 2026-10-27

Read-only Cloudflare checks verified: `nebula-scanner` has cron `*/30 * * * *` and service binding to `nebula-ai-engine`; `nebula-scanner-stage` has no cron and service binding to `nebula-ai-engine-stage`. Both scanner variants currently point at the SAME staging D1 database (`0d565690-e6c0-4aa8-a8d4-17b91edc81dc`), so this is NOT isolated testing. `nebula-monitor-stage` reads that database and binds to `nebula-scanner-stage`.

D1 scanner run #12 completed at 2026-10-27T12:09:56.815Z: 5 selected, 1 snapshot, all 5 pipeline calls HTTP 200; totals after run: 138 snapshots, 138 scores, 0 prediction candidates, 12 runs. Runs #10 and #11 were RATE_LIMITED (DexScreener HTTP 429 / cooldown).

Immediate release blockers: separate stage D1, verify prediction_candidates insert on real scored items, validate gateway/asset bindings, test live HTTP and safe scanner health, and ensure no frontend trading until risk gating is verified. Do not delete historical data or expose secrets. Do not claim the existing monitor is a full application frontend.
