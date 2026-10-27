# NEBULA Backend V1 — Baseline dan Scope (2026-10-27)

Status: **Tahap 01 — baseline tercatat; belum ada deploy**.

## Scope V1 (LOCK)
Discovery Solana -> Scanner -> Risk verification (UNKNOWN tetap UNKNOWN) -> heuristic scoring WATCH/REVIEW -> D1 snapshot -> Evaluation -> Dashboard. Tidak ada auto-trading. Tidak mengklaim model AI terlatih atau win rate yang belum tervalidasi.

## Source of truth
- Repo: NebulaCryptoHunter/NebulaCryptoHunter.
- Default branch main: frontend index.html, blob SHA ac446f04b16ab5320ae649f3a037ef4109ae2cf5.
- Patch review branch: fix/nebula-api-auth-hardening-20261027, PR #2 (DRAFT). Jangan merge/deploy sebelum tes.
- Worker produksi yang saat ini berjalan di Cloudflare adalah baseline operasional; salinan kode GitHub di PR bukan bukti deploy.

## Cloudflare Workers (read-only inventory)
| Worker | Binding utama | Cron |
| --- | --- | --- |
| nebula-api | DB=nebula-db; API_KEY dan provider secrets | tidak ada |
| nebula-scanner | STAGE_DB=nebula-scanner-stage; AI_ENGINE service; INTERNAL_TOKEN | */30 * * * * |
| nebula-ai-engine | STAGE_DB=nebula-scanner-stage; INTERNAL_TOKEN | tidak ada |
| nebula-evaluation | DB=nebula-db | */30 * * * * |
| nebulacryptohunter | static assets | tidak ada |
| nebula-auth-stage | DB=nebula-auth-stage | tidak ada |
| nebula-api-adapters-stage | DB=nebula-auth-stage; provider secrets | tidak ada |

D1 IDs (metadata only): nebula-db=6eeadd5e-5e58-4a8c-90d9-92d039438a8f; scanner-stage=0d565690-e6c0-4aa8-a8d4-17b91edc81dc; auth-stage=9b09e549-5532-4019-ac72-a0a0f6c755be.

## Endpoint contracts (source audit, not live-tested)
- nebula-api: GET /health; GET/POST /api/v1/predictions; GET/POST /api/v1/evaluations; GET /api/v1/stats, /heroes, /watchlist, /learning.
- nebula-scanner: GET /health, GET /discover, GET /pipeline?mint=..., POST /run, POST /scan. Internal token required except health.
- nebula-ai-engine: GET /health, POST /score (internal token).
- nebula-auth-stage: /api/auth/login, /api/auth/me, /api/auth/logout, /api/auth/users, /api/auth/activate (not activated in production).

## Known issues, accepted limitations
1. Browser currently calls protected API GET without a server-side session; don't deploy blanket GET auth until frontend proxy/session is fixed.
2. Scanner returns UNKNOWN for rug and whale risk; all 133 recorded scores were WATCH at inspection. Never fake SAFE.
3. DexScreener discovery rate-limited (429); cooldown and retry behavior needs tests.
4. Scanner-stage and production evaluation use separate D1 DBs; end-to-end promotion and lineage must be designed and tested.
5. Adapter staging binds to auth-stage D1; verify intent before integration.
6. Baseline source integrity hashes, restore procedures and live endpoint smoke tests still pending. No secrets are included here.

## Stage gates
01 baseline documented; 02 API/session; 03 scanner; 04 risk verification; 05 scoring; 06 D1/evaluation; 07 frontend; 08 tests; 09 controlled deploy; 10 handover.

## Rollback rule
Before production deployment, export exact Worker scripts/config and D1 backup, record version identifiers, verify rollback steps. Never assume a GitHub commit matches a deployed Worker without comparing artifacts.
