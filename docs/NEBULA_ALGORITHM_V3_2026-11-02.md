# NEBULA algorithm upgrade V3

Model: `heuristic-v3.0.0`. Date: 2 November 2026 (WIB).

## Resulting behavior

A positive one-hour return or strong 24-hour buy count no longer establishes a research setup when the latest five-minute window is missing, falling, or dominated by selling. The score remains an explainable research ranking. Outputs are WATCH, REVIEW, or INSUFFICIENT_DATA; REVIEW means human research priority, never a BUY instruction.

The existing `scoring-v2.mjs` import path is retained so existing Worker imports remain compatible. Historical scores are not rewritten. No database migration, additional scanner query, new provider subscription, automatic weight fitting, schedule change, or trading integration is introduced.

## Changes and provisional policy

| Area | V3 behavior |
| --- | --- |
| Buy pressure | Shrunk transaction-count share `(buys + 10) / (buys + sells + 20)` in both h1 and m5. The weaker window determines the pressure component. Counts are not buy/sell USD flow or independent-wallet evidence. |
| Recent confirmation | REVIEW needs valid h1/m5 returns, volumes and transaction counts; at least 20 hourly and 10 recent transactions; positive h1 and m5 return; shrunk pressure >=55%; score >=60; fresh observation; verified existing security flags; no risk flags. |
| Momentum | 60% hourly and 40% recent momentum component, with an additional penalty for a negative m5 return. A positive h1 cannot mask a recent reversal. |
| Activity | Bounded `log(1 + hourlyVolume/liquidity) / log(2)`, rather than treating a large cumulative daily volume as current demand. |
| Disjoint pace | Compare last 5 minutes with preceding 55 minutes: `11 × V5 / (V1 − V5)` and the equivalent transaction-count ratio. No pace is reported without a known pool age of at least one hour, consistent windows, and a positive denominator. |
| Small-trade diagnostic | Flag a recent count pace >=2 combined with average recent trade size <25% of the preceding interval, with >=10 recent transactions. This is a provisional descriptive filter, not proof of wash trading. |
| Pool consistency | Check nested buy and sell counts separately and nested USD volumes (USD1 or 1% tolerance). Nonzero volume with zero transactions, or transactions with zero volume, is quarantined. |
| Liquidity-volume discordance | Current liquidity <=USD1 or daily volume/current liquidity >100 quarantines the price reference. High volume in a depleted pool is not promoted as an opportunity. This operational filter is not a validated dump predictor. |
| Freshness | Retain original fetch time across local cache hits. Propagate HTTP Date/Age as a conservative transport bound; stale upstream timing cannot be refreshed by fetching it again. HTTP timing is not a per-trade/on-chain timestamp. Missing source timing is labelled FETCH_ONLY. |
| Coverage | 50 points for the four required core fields, 10 each for h1/m5 returns and volumes, 5 each for h1/m5 transaction counts. This measures available fields, not accuracy, history duration, risk verification or confidence. Missing fields cannot reach REVIEW. |
| Explainability | Persist setupStage, riskFlags, components and metrics. The existing research API includes the added fields; the dashboard model label follows the returned model version. |

Component weights remain provisional: liquidity 30%, activity 20%, momentum 25%, pressure 25%. Scores are capped for stale (<=30), incomplete (<60) and quarantined (<=20) observations. The limits above are research policy choices and have not been selected by a profit-optimizing backtest.

## Evidence limits

The current R231 summary and report were read before this change. They record zero BUY, zero valid prospective outcomes and undefined precision. H1–H14, MDI and LQS remain blocked by missing synchronized minute data. The four-pool H23 example is descriptive and posthoc. Those records do not establish predictive power for this implementation.

V3 does not call a transaction-count ratio a probability of profit, does not infer independent buyers, does not invent OHLCV history, and does not subtract overlapping percentage returns as if they were independent returns. Confidence, probability of profit and predicted multiplier remain null. Automatic trading remains false. Unknown rug or whale checks remain unverified and block REVIEW. Existing server normalization leaves these checks UNKNOWN; this upgrade does not fabricate verification or add risk-provider calls.

Pool age is required for disjoint pace diagnostics, not for descriptive short-window ranking. Young/unknown-age pools can be observed with pace unavailable. A WATCH with CONFIRMED_MARKET_SETUP still means security verification is pending. Setup status describes these provisional rules, not prospective validation.

The scanner still runs on its existing 30-minute schedule. Five-minute fields are rolling provider measurements at capture time, not continuous five-minute monitoring. The existing 30–90-minute same-pool return evaluator is retained; it cannot establish intraminute pump timing, an executable trade price, ATH, slippage-adjusted P&L, or a validated exit rule.

## Technical validation

- 65 relevant tests pass, including 23 V3 tests, existing scoring, transport, D1-read-budget, evaluator and scanner integration tests.
- Full suite: 216 tests, 208 passed, 6 failed, 2 skipped. A clean checkout of base commit `8ff511c7b7e26d9deacdc697ed840a4e11b24219` has the same 6 UI contract failures (185 passed, 2 skipped out of 193); no new full-suite failure was introduced. Browser-only tests are skipped when Chrome is unavailable.
- V3 tests cover recent selling/reversal, missing windows, individual subcount inconsistency, tiny samples, disjoint denominators, immature pool history, microtrade diagnostics, source-age propagation, cache provenance, overflow, future-outcome leakage and private scoring authorization.
- Existing SQLite integration exercises actual scanner -> AI handler -> score/snapshot persistence -> candidate trigger. The trigger preserves WATCH/risk-unverified research records.

Deployment evidence and any remaining runtime limitations belong in the companion V3 deployment record. Passing technical tests is not a claim of improved pump precision or win rate.

Primary implementation references: https://docs.dexscreener.com/api/reference and https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ .
