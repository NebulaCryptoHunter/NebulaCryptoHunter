# NEBULA deployment verification (2026-10-26)

Production Worker versions at audit:
- nebula-api: dbd72b10-a5eb-4f47-8329-fa8b97bddf80
- nebulacryptohunter: 9888d197-eaa9-491c-819f-46db530a7ff1
- nebula-evaluation: 9e8bc45e-aff4-48e1-9d3e-72f434060e4a
- staging: nebula-api-adapters-stage (Helius and CoinGecko secrets, no D1)

## Release gates
1. Back up production Worker versions and D1 before any release; never delete D1 data.
2. Keep SERVER_GATE_V3_FAIL_CLOSED; test AVOID/UNKNOWN/WAIT cannot become BUY via UI or API.
3. Stage all backend routes with real upstream responses, including 403/429/timeouts and token identity checks.
4. Add COINGECKO_API_KEY securely to production backend **before** activating the CoinGecko route. Never commit secrets.
5. Test browser CORS and API contracts. Frontend health must target the intended backend and must never report green for missing/invalid responses.
6. Deploy static assets with Wrangler/assets workflow (not replacing the assets Worker with raw HTML).
7. Smoke test: load dashboard, read existing historical DB, verify stats/predictions, provider health, disabled BUY, and evaluation cron. Confirm rollback deployment versions remain available.
8. Promote backend and frontend only after the above gates pass; record version IDs. Roll back both on regressions.

## Confirmed
- Solana RPC staging via Helius returned {success:true, verified:true}.
- CoinGecko staging returned a positive price for Wrapped SOL.
- CoinPaprika, Ankr, PumpPortal WS, and other providers are not fully validated.
- Frontend index.html in GitHub disables the BUY action; deployment to Cloudflare assets is not yet verified.

## Security follow-up
The frontend currently includes an API credential in client-side source. Treat it as public/exposed and migrate to a non-secret public-read auth model or a dedicated restricted token before rotating backend credentials. Do not put secret backend keys in HTML.
