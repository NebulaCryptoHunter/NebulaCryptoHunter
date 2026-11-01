# NEBULA Unified Database — 1 November 2026

## Canonical data

- Production research, scanner, AI scores and legacy predictions: **Cloudflare D1 `nebula-db`** (`6eeadd5e-5e58-4a8c-90d9-92d039438a8f`).
- Authentication: separate `nebula-auth-stage` (`9b09e549-5532-4019-ac72-a0a0f6c755be`). Deliberately isolated to preserve logins.
- Former scanner staging: `nebula-scanner-stage` (`0d565690-e6c0-4aa8-a8d4-17b91edc81dc`) — **retained for rollback**.
- Former research testing: `nebula-research-test` (`1ca8e43b-e9fc-466f-9ec8-9fe9b755e671`) — **retained for rollback**.

## Migration audit (point-in-time, before next live scan)

| Entity | Count in canonical D1 |
| --- | ---: |
| Legacy predictions | 6,952 |
| Legacy evaluations | 86 |
| Scanner snapshots | 197 |
| Distinct scanner token mints | 66 |
| Scanner AI scores | 197 |
| Prediction candidates | 197 |
| Candidate evaluations (30–90m same-pool observed return) | 56 |
| Scanner runs | 251 |
| Scanner diagnostics | 328 |
| Orphan candidate evaluations | 0 |

The original two staging datasets were merged using mint + pair + observed timestamp identity; overlapping research rows were deduplicated. Source D1 databases were **not deleted**. Scanner cooldown state was intentionally not migrated to avoid carrying over obsolete provider throttling. Existing production predictions and evaluations were not modified. A D1 Time Travel bookmark was captured before the additive migration.

## Scanner v2 (merged to main in PR #12)

- DexScreener `/tokens/v1/solana/{addresses}`: up to **12 token addresses in one batch HTTP request** per run, rather than one request per token.
- Source discovery: `/token-profiles/latest/v1` at most every 6h; cache plus existing snapshot mints, watchlist and historical predictions.
- Candidate rotation in `scanner_state`; base-token mint must match each returned pool; no quote-token attribution.
- Exponential HTTP 429 cooldown: 60m, 120m, 240m... up to 12h; no additional provider requests during cooldown.
- Scanner Cron: `*/30 * * * *`, activated only after GitHub regression tests passed. First subsequent live invocation requires verification.
- AI Engine currently `heuristic-v1`, not calibrated ML; UNKNOWN security/holder verification means `WATCH`. No auto-trading is implemented or authorized.

## Production bindings (verified)

- `nebula-api.DB` → `nebula-db`
- `nebula-scanner.STAGE_DB` → `nebula-db` (binding retains historical variable name, not a staging database)
- `nebula-ai-engine.STAGE_DB` → `nebula-db`
- `nebula-evaluation.DB` and `nebula-evaluation.RESEARCH_DB` → `nebula-db`
- `nebulacryptohunter.RESEARCH_DB` → `nebula-db`
- `nebulacryptohunter.AUTH_DB` → separate authentication DB.

## Rollback / safety

Do not delete source databases, overwrite historical rows, or reset production for troubleshooting. To roll back, stop scanner Cron, deploy the previously known-good Worker version and restore the required D1 bindings; only consider D1 Time Travel restore after impact analysis because restoring would overwrite post-migration changes. Always verify the active **deployed version's bindings**, not just GET /settings (which may refer to the latest uploaded draft). Stage scanner Cron is disabled.
