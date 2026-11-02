# NEBULA scoring V4 — 3 November 2026 (WIB)

Model: `heuristic-v4.0.0`. This fixes the V3 audit findings. It is a fixed research ranking policy, not a trained model, calibrated probability, trading recommendation or demonstrated improvement in returns.

## Main score

| Component | Weight | Indicator (0–100) |
| --- | ---: | --- |
| Liquidity | 20% | `100 / (1 + 50000 / liquidityUsd)` |
| Activity | 25% | `clamp(100 * log1p(volumeH1 / liquidityUsd) / log(2))` |
| Momentum | 30% | 60% hourly + 40% recent, using the smooth curve below |
| Buy pressure | 25% | Lower of shrunk hourly and five-minute transaction-count buy shares when both exist |

Momentum uses `50 + 50 * returnPct / (abs(returnPct) + scale)`, with scale 10 for 1h and 3 for 5m. Effective main-score weights are 18% hourly and 12% recent momentum. Positive returns approach 100 gradually instead of tying at +25%/hour or +8.33%/5m. Missing fields remain missing and never earn free points.

Liquidity's influence between $50k and $1m falls from about 19.52 to 9.05 points with other normalized features held equal. Liquidity below $50k still blocks REVIEW and now caps the final score at 59. This reduces capital bias while retaining the depth check.

Positive 1h and 5m returns can qualify as `RECOVERY_SETUP` when the day is modestly negative. A drawdown of 50% or more remains a blocking risk with a daily penalty. A negative hour, recent reversal, sell pressure, tiny sample, overheating, inconsistent windows, suspicious microtrade counts and excessive turnover retain their guards. Data freshness and quarantine rules remain in force.

All weights, thresholds and scales are provisional manual policy. They have not been optimized against future outcomes.

## Evidence affects the final score

`risk-assessment.mjs` reads evidence already collected by the central API; scoring makes no upstream calls. It checks exact, case-sensitive mint identity, explicit identity confirmation, capture time, source timestamps where available and a maximum evidence age of 15 minutes. Future/invalid/stale or mismatched evidence cannot pass. HTTP capture time is a retrieval bound, not proof of the provider's internal report age or an on-chain block timestamp.

Five limited checks are required for `CHECKS_PASSED`:

1. Mint authority disabled in parsed RPC mint state.
2. Freeze authority disabled in parsed RPC mint state.
3. Standard SPL Token Program owner. Token-2022 remains unverified until extension checks exist.
4. Jupiter-reported top holder concentration at or below 20%, using an exact-mint response. This is a provider-reported aggregate, not a unique-wallet or adjusted LP-owner audit.
5. An exact-mint Rugcheck report with an explicit empty risk list and zero reported score. Missing fields and unexplained nonzero scores stay unverified.

A contradictory current authority source blocks rather than silently overriding a warning. Active authorities, a reported rug or a danger alert cap the score at 20. Report warnings, excessive concentration or Jupiter's explicit suspicious flag cap it at 39. Missing/unverified checks cap it at 69. All existing stricter market caps still apply. These are ceilings, never minimum scores.

Passing these checks is not a safety guarantee. The engine ignores legacy `risk: {rugCheck:'SAFE', whaleConcentration:'SAFE'}` strings as clearance. It emits `CHECKS_PASSED`, `UNVERIFIED` or `RISK_DETECTED` plus individual check statuses. The provider's risk list is truncated only for display; danger detection inspects the complete returned list.

REVIEW means a market setup passes the existing market gates and the five limited checks; it is a research/manual-review state. WATCH remains the default. `autoTrade=false`, confidence, predicted multiplier and probability of profit remain unset. Existing conservative D1 candidate history and `risk_verified=0` are unchanged; this implementation does not assert comprehensive verification.

## Traceable arithmetic and UI

Every scored record includes `scoreBreakdown`: weight, indicator, weighted points, base score, each penalty, each cap and its actual reduction, range adjustment and final score. Weighted contributions are allocated in hundredths so they sum exactly to the base shown in the UI.

`baseScore - penaltyTotal - capReduction + rangeAdjustment = finalScore`.

The existing XAI details panel renders those weighted points. It also shows the individual security checks, setup status and research validation state. Card badges distinguish CHECKED (limited checks), RISK and UNVERIFIED without presenting a confidence percentage. The existing HUD layout/styles are preserved. Descending final-score ranking and deterministic tie ordering are retained. Historical records retain their original model and score; they are not rescored or rewritten.

## Prospective validation, without extra SQL queries

The research API derives `scoreValidation` from its existing latest-50 candidate query. It groups only this model's original scores, de-duplicates candidate IDs and accepts measured returns only from completed same-pool follow-ups 30–90 minutes later. Future, malformed, inconsistent or missing measurements and other model versions do not count.

The response exposes candidate count, measured count and mean observed point return per score band. Empty bands remain null. It is a bounded recent sample with variable follow-up horizons, not a full-history backtest, win rate, execution P&L or calibration. It cannot establish predictive performance; `calibrated=false` remains explicit. Collect outcomes prospectively and use a separate time-held-out analysis before fitting weights or making performance claims.

## Validation

- 108 targeted algorithm, provider, persistence, D1-budget and scanner checks pass, including 19 new V4 tests.
- New tests cover exact contribution reconciliation across adverse inputs, reduced liquidity influence, smooth momentum, recovery handling, old SAFE strings, each missing/stale/wrong-mint evidence path, conflicting authorities, Token-2022, report truncation, real upstream-to-scoring integration, real SQLite research SELECTs and executing the actual frontend detail renderer.
- Full local suite: 259 tests, 251 passed, 6 failed, 2 skipped. The six failing UI contracts and two skipped browser geometry tests are the same baseline issues recorded before this change; this is not a fully green repository suite.
- No additional upstream calls, SQL queries, schema migrations, subscriptions or purchased API plans were introduced.

Controlled fixture examples (not live market signals or a backtest):

| Scenario | Main score | State |
| --- | ---: | --- |
| Baseline, all limited checks pass | 66.04 | REVIEW |
| Same baseline, 24h return −1%, 1h/5m positive | 66.04 | REVIEW / RECOVERY_SETUP |
| Same baseline, evidence missing | 66.04 | WATCH / UNVERIFIED |
| Same baseline, active/conflicting mint authority | 20.00 | WATCH / RISK_BLOCKED |
| Same baseline, concentration 60% | 39.00 | WATCH / RISK_BLOCKED |
| $50k liquidity, other normalized features equal | 57.86 | WATCH |
| $1m liquidity, other normalized features equal | 66.91 | REVIEW |

## API references checked during implementation

- [Jupiter Tokens V2 response schema](https://developers.jup.ag/docs/api-reference/tokens/search)
- [Rugcheck API schema](https://api.rugcheck.xyz/swagger/doc.json)
- [Solana authority semantics](https://solana.com/docs/tokens/basics/set-authority)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)

Production versions and read-only live verification are recorded separately after deployment.
