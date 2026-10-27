# NEBULA frontend staging gateway

Do not attach staging D1 or the staging scanner to the production `nebulacryptohunter` Worker without a separate rollout approval. Its deployed settings currently expose no bindings and its active implementation must not be assumed to match `backend/workers/frontend-gateway.mjs`.

For an isolated gateway, bind `RESEARCH_DB` (D1 `nebula-scanner-stage`, ID `0d565690-e6c0-4aa8-a8d4-17b91edc81dc`) and `SCANNER` (service `nebula-scanner-stage`). The existing gateway additionally requires `AUTH_DB`, `API`, `ASSETS` and `INTERNAL_TOKEN` for the full experience. Do not expose an internal token to the browser or copy production secrets into staging. Since authentication is deferred, leave `/api/research/scan` protected; expose only sanitized read-only snapshots. Confirm the service worker entrypoint, assets, and auth dependencies before any deployment.

Validation: GET `/api/research/latest` should report real snapshots and `automaticScanning:false`; POST `/api/research/scan` without authorization must fail; no live buy action should be possible; staging writes must not appear in production D1.
