# NEBULA split workers (staging-first)

- `nebula-scanner`: Solana token discovery and pair normalization. Mint address is the canonical identity; pool address is not a token ID. Track base and quote mint separately. Never infer quote-token 24h gains from base-token change.
- `nebula-ai-engine`: deterministic explainable ranking and safety gating. Whale and rug status remain UNKNOWN until independently verified. Never advertise calibrated AI confidence or x-multipliers.
- `nebula-api`: existing frontend read/API gateway; unchanged.
- `nebula-evaluation`: existing historical evaluation; unchanged.
- `nebula-db`: production D1 remains untouched. Add dedicated staging DB, then versioned migrations and service bindings only after tests.

These are source-only Worker projects. No production deploy, cron activation, API keys, database binding, or wallet execution. Authentication UI is out of scope.
