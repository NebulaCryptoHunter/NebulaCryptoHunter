# NEBULA split Worker architecture (development only)

- `nebula-scanner`: pool-aware token discovery and momentum measurements.
- `nebula-ai-engine`: conservative explainable heuristic scoring and fail-closed risk gate.
- `nebula-api`: remains dashboard gateway; no changes deployed.
- `nebula-evaluation`: remains historical evaluation/learning service.

These are source prototypes, **not deployed**, not trained ML, and do not fetch external provider feeds yet.
Do not infer that the quote token's USD price/24h change equals the base token's.
Both /scan and /score require a private INTERNAL_TOKEN; configure as a Worker secret.
Prefer Cloudflare service bindings and separate staging D1 before integrating. Never store tokens in frontend.
No user/admin login integration is planned in this phase. No automated trades.
