# NEBULA — API utilization and limits

Date: 2 November 2026 (WIB). Scope: maximize useful data from the existing providers within available access and rate limits. No subscription upgrade, new paid stream, trade, fabricated market field, or model recalibration.

## What changed

- One request context coalesces identical concurrent calls, normalizes header order/case, and limits a feed to 12 external HTTP attempts and a 12-second start budget. Cache hits do not consume that external-attempt budget. Requests, promises and credentials are never kept in a global mutable request map. Cache operations and service-binding calls are separate from the external-attempt counter.
- Successful response timestamps survive local cache reuse. Missing fields stay missing. HTTP cache timing and available provider price timestamps are retained when evaluating point-in-time returns.
- Rate/auth cooldowns are scoped by provider family. Dex discovery and market endpoints have different documented rates; batch and token-pair routes keep their own cooldowns. A maximum of two token-pair fallbacks can serve missing mints after the batch route is limited; any 429 on that fallback stops it immediately. The limited batch route is never retried within its cooldown. This is best-effort routing, not a guarantee of independent quotas at the upstream edge.
- A transient failure or unavailable paid endpoint only cools that endpoint. It cannot disable a working sibling endpoint. All 429 Retry-After values remain authoritative for their route; no retry loops, proxy rotation or credential rotation are added.
- Scanner retry backoff now starts at one minute and caps its own exponential component at 15 minutes, while preserving a longer explicit server retry time. Previously its minimum was one hour and its maximum twelve hours. Discovery refreshes once per existing 30-minute scanner interval rather than once per six hours.
- Discovery merges Dex profiles and Gecko new-pool results. Real discovered pools are reused by the same feed. Dust/incomplete pool responses do not suppress independent fallback. Pump.fun HTTP discovery is tried only when primary discovery is empty.
- A partial pool feed or partial Jupiter result no longer ends coverage. Missing prices continue through CoinGecko, then up to two configured Birdeye requests. Price-only rows retain null score, pool address and pool liquidity.
- Jupiter metadata is fetched in one mint batch. Holder count, authority indicators, organic score and aggregate liquidity remain source-labelled token metadata; aggregate liquidity is never relabelled as single-pool depth.
- Helius account metadata uses one getMultipleAccounts call for up to 12 mints, with exact response-order mapping and null-account checks. Rugcheck evidence is sampled for one priority mint and cached. Raw evidence never assigns SAFE or bypasses V3's risk gate.
- Missing prices take priority over optional evidence within the shared HTTP budget. Expired deadlines or empty budgets abstain without more upstream calls.
- Scanner and evaluator use MARKET_API service bindings to the existing nebula-api Worker, which already owns the configured Helius/Birdeye/CoinGecko credentials. Secrets are not copied to scanner, evaluator or browser. The existing read-only market-feed route accepts at most 12 validated mints and optionally returns genuine normalized observations; it does not accept client-supplied market data.
- Health checks can reuse successful transport cache entries instead of forcing cache bypass. Their existing ten-minute aggregate cache and independent-provider failure handling remain.

## Provider roles and observed limits

Read-only production health audit at 22:54 WIB (15:54 UTC), before these changes:

| Provider | Observed status | Role / handling |
| --- | --- | --- |
| DexScreener | HEALTHY on token-pairs probe | Batched pool data, with bounded documented-route fallback. Rate-limited routes retain their own cooldown. |
| GeckoTerminal | RATE_LIMITED | Independent pool data and discovery, versioned Accept header, maximum three token-pool fallbacks; stop immediately on rate/auth failure. |
| Jupiter | HEALTHY | One batched token lookup, missing-price coverage and source-labelled metadata. Keyless access is usable, with lower published limits. |
| Birdeye | HEALTHY | Configured central key; up to two remaining-price requests, no plan change. |
| CoinGecko | HEALTHY | Batched missing token prices with available last-updated timestamps and existing Demo key. |
| Helius | HEALTHY | Batched mint-account evidence and existing RPC fallback. |
| Rugcheck | HEALTHY | Cached, identity-checked evidence for one priority token; no invented risk clearance. |
| Solana public RPC | AUTH_ERROR (403) | Existing independent RPC fallback remains; Helius takes priority when configured. |
| Ankr | CONFIG_ERROR | Endpoint/credential absent; no invented credential or account signup. |
| Pump.fun HTTP | AUTH_ERROR (403) | Bounded discovery fallback; rejection is not repeatedly retried. |
| PumpPortal WebSocket | HEALTHY subscription acknowledgement | Existing short health probe for the free discovery stream remains. This change does not create a continuous collector or subscribe to metered trade streams. |
| CoinPaprika | FREE_PLAN_UNAVAILABLE (402) on health ticker | Existing optional metadata adapter remains; unavailable endpoints are cooled, never promoted as a working token-price source. |

These are timestamped probe results, not an assertion that every endpoint or token is covered. Cache and throttling are colo-local best efforts. There is no distributed global quota coordinator, no claim that all 12 sources can be used continuously, and no automatic plan purchase. Continuous PumpPortal discovery needs a separately coordinated socket lifecycle; short probes are not a continuous discovery feed.

## Validation

- 88 relevant tests pass, including 23 API-utilization tests and the existing scoring, source, evaluator, scanner, SQLite persistence and read-budget cases.
- Full suite: 239 tests; 231 pass, the same 6 pre-existing UI contract tests fail, and 2 Chrome-dependent tests are skipped. No new failure relative to the recorded V3 baseline.
- Tests cover in-flight coalescing, credential-safe cache reuse, bounded deadlines/budgets, isolated provider failures, partial quote coverage, price-vs-pool separation, bounded route fallback, batched RPC order, identity mismatch, quota fallback, server Retry-After and an actual scanner -> API binding -> AI -> SQLite flow.
- No schema migration, extra scanner D1 query or historical-data rewrite is required. Existing scanner/evaluator cron intervals remain 30 minutes.
- On-platform deployment and current feed observations are recorded in the companion API-utilization deployment record. Technical checks do not establish pump-prediction accuracy.

Primary references checked during implementation:

- https://docs.dexscreener.com/api/reference
- https://api.geckoterminal.com/docs/index.html
- https://developers.jup.ag/docs/api-reference/tokens/search
- https://developers.jup.ag/pricing
- https://developers.jup.ag/changelog/developer-platform
- https://docs.birdeye.so/docs/pricing
- https://docs.coingecko.com/reference/simple-token-price
- https://solana.com/docs/rpc/http/getmultipleaccounts
- https://pumpportal.fun/data-api/real-time/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
