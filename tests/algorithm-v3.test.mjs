import {scoringEvidence} from './fixtures/scoring-evidence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCandidate, MODEL, SCORING_POLICY} from '../backend/workers/scoring-v2.mjs';
import {upstreamTiming, providerJSON} from '../backend/workers/provider-runtime.mjs';
import {scanPairs} from '../backend/workers/market-observation.mjs';
import {marketPairs, geckoPairs} from '../backend/workers/market-sources.mjs';
import engine from '../backend/workers/nebula-ai-engine.mjs';
const now = Date.parse('2026-11-02T15:00:00Z');
const A = 'So11111111111111111111111111111111111111112', B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const candidate = (patch = {}) => ({
  ...scoringEvidence(A, new Date(now).toISOString()), base: {mint: A}, pairAddress: B, priceUsd: 1, liquidityUsd: 500000, volume24h: 2500000, change24h: 24,
  observedAt: new Date(now).toISOString(), poolCreatedAt: new Date(now - 2 * 3600000).toISOString(),
  buys24h: 700, sells24h: 300,
  timeframes: {h1: {changePct: 8, volumeUsd: 150000, buys: 80, sells: 20}, m5: {changePct: 2, volumeUsd: 20000, buys: 24, sells: 6}},
  risk: {rugCheck: 'SAFE', whaleConcentration: 'SAFE'}, ...patch,
});
const score = c => scoreCandidate(c, {now});
function withFive(patch) { const c = candidate(); c.timeframes.m5 = {...c.timeframes.m5, ...patch}; return c; }
test('V3 requires recent confirmation and preserves the research-only contract', () => {
  const r = score(candidate());
  assert.equal(r.model, 'heuristic-v4.0.0'); assert.equal(r.model, MODEL); assert.equal(r.decision, 'REVIEW');
  assert.equal(r.setupStage, 'CONFIRMED_MARKET_SETUP'); assert.equal(r.metrics.buyPressureWindow, 'm5+h1');
  assert.equal(r.confidence, null); assert.equal(r.probabilityOfProfit, null); assert.equal(r.predictedMultiplier, null);
  assert.equal(r.autoTrade, false); assert.equal(r.modelCalibrated, false); assert.ok(Object.isFrozen(SCORING_POLICY));
});
test('a green hour cannot mask a red five minutes or recent selling', () => {
  const healthy = score(candidate()), reversal = score(withFive({changePct: -8})), selling = score(withFive({buys: 2, sells: 18}));
  for (const r of [reversal, selling]) { assert.equal(r.decision, 'WATCH'); assert.equal(r.setupStage, 'COOLING'); assert.ok(r.score < healthy.score); }
  assert.ok(reversal.riskFlags.includes('RECENT_REVERSAL')); assert.ok(selling.riskFlags.includes('RECENT_SELL_PRESSURE'));
  assert.equal(selling.components.buyPressure, selling.metrics.buyPressureM5);
});
test('day-only counts never satisfy hourly confirmation even with very strong old demand', () => {
  const c = candidate(); delete c.timeframes.h1.buys; delete c.timeframes.h1.sells;
  const r = score(c); assert.equal(r.decision, 'WATCH'); assert.ok(r.riskFlags.includes('HOURLY_PRESSURE_UNCONFIRMED'));
  assert.equal(r.metrics.buyPressureWindow, 'h24'); assert.ok(r.dataCoverage < 100); assert.ok(r.score < 60);
});
test('missing recent fields cannot silently get full coverage or REVIEW', () => {
  for (const field of ['changePct', 'volumeUsd', 'buys', 'sells']) {
    const c = candidate(); delete c.timeframes.m5[field]; const r = score(c);
    assert.equal(r.decision, 'WATCH'); assert.ok(r.dataCoverage < 100); assert.ok(r.score < 60);
  }
});
test('tiny transaction samples shrink toward neutral and cannot qualify', () => {
  const r = score(withFive({buys: 1, sells: 0}));
  assert.equal(r.decision, 'WATCH'); assert.ok(r.metrics.buyPressureM5 < 55);
  assert.ok(r.riskFlags.includes('INSUFFICIENT_RECENT_TRANSACTION_SAMPLE'));
});
test('volume pace compares disjoint five-minute and fifty-five-minute intervals', () => {
  const r = score(candidate());
  assert.equal(r.metrics.volumePace5mVsPrior55m, 1.69); // 11 * 20000 / 130000
  assert.equal(r.metrics.transactionPace5mVsPrior55m, 4.71); // 11 * 30 / 70
  assert.equal(r.metrics.paceBaseline, 'FULL_HOUR_SAME_POOL');
});
test('an infant or unknown-age pool does not receive a fabricated 55-minute baseline', () => {
  for (const poolCreatedAt of [null, new Date(now - 20 * 60000).toISOString()]) {
    const r = score(candidate({poolCreatedAt}));
    assert.equal(r.metrics.volumePace5mVsPrior55m, null); assert.equal(r.metrics.transactionPace5mVsPrior55m, null);
    assert.equal(r.metrics.averageTradeUsdPrior55m, null); assert.equal(r.metrics.paceBaseline, 'UNAVAILABLE');
  }
});
test('a transaction count spike made of much smaller trades is flagged without declaring wash trading', () => {
  const r = score(withFive({buys: 24, sells: 6, volumeUsd: 50}));
  assert.equal(r.decision, 'WATCH'); assert.ok(r.riskFlags.includes('SMALL_TRADE_COUNT_SPIKE'));
  assert.ok(r.metrics.relativeTradeSize < .25); assert.match(r.reasons.join(' '), /not proof of wash trading/);
});
test('impossible rolling volumes or counts quarantine the price reference', () => {
  for (const patch of [{volumeUsd: 200000}, {buys: 101, sells: 0}]) {
    const r = score(withFive(patch)); assert.equal(r.decision, 'WATCH'); assert.ok(r.riskFlags.includes('INCONSISTENT_TIME_WINDOWS'));
    assert.equal(r.setupStage, 'QUARANTINED'); assert.equal(r.metrics.referencePriceUsable, false); assert.ok(r.score <= 20);
  }
});
test('nonzero volume with zero trades and trades with zero volume are inconsistent', () => {
  for (const patch of [{buys: 0, sells: 0}, {volumeUsd: 0}]) {
    const r = score(withFive(patch)); assert.ok(r.riskFlags.includes('VOLUME_TRANSACTION_MISMATCH')); assert.equal(r.setupStage, 'QUARANTINED');
  }
});
test('buy and sell subcounts must agree even when their totals look consistent', () => {
  for (const patch of [{buys: 81, sells: 0}, {buys: 0, sells: 21}]) {
    const r = score(withFive(patch)); assert.ok(r.riskFlags.includes('INCONSISTENT_TIME_WINDOWS')); assert.equal(r.setupStage, 'QUARANTINED');
  }
});
test('extreme liquidity-volume discordance quarantines instead of becoming an attractive high-activity pool', () => {
  const r = score(candidate({volume24h: 100000000, liquidityUsd: 100000}));
  assert.equal(r.setupStage, 'QUARANTINED'); assert.ok(r.riskFlags.includes('EXTREME_TURNOVER'));
  assert.equal(r.metrics.referencePriceUsable, false); assert.ok(r.score <= 20);
});
test('invalid direct-call short-window numbers remain missing, not coerced valid inputs', () => {
  for (const patch of [{changePct: -101}, {changePct: true}, {volumeUsd: '20000'}, {buys: true}, {sells: Infinity}]) {
    const r = score(withFive(patch)); assert.equal(r.decision, 'WATCH'); assert.ok(r.dataCoverage < 100);
  }
});
test('unknown security stays WATCH even when the market setup is confirmed', () => {
  const r = score(candidate({risk: {}, verificationEvidence: null, tokenMetadata: null})); assert.equal(r.setupStage, 'CONFIRMED_MARKET_SETUP'); assert.equal(r.decision, 'WATCH');
  assert.ok(r.reasons.some(s => s.includes('unverified')));
});
test('fresh retrieval cannot disguise stale, future or invalid upstream response timing', () => {
  for (const sourceAsOf of [new Date(now - 16 * 60000).toISOString(), new Date(now + 2 * 60000).toISOString(), 'broken']) {
    const r = score(candidate({sourceAsOf})); assert.equal(r.decision, 'WATCH'); assert.equal(r.setupStage, 'STALE');
    assert.ok(r.score <= 30); assert.equal(r.metrics.referencePriceUsable, false);
  }
});
test('HTTP Age and Date use the older bound without double-subtracting cache age', () => {
  const h = new Headers({Date: new Date(now - 3600000).toUTCString(), Age: '3600'}), r = upstreamTiming(h, now);
  assert.equal(r.sourceAsOf, new Date(now - 3600000).toISOString()); assert.equal(r.sourceTimeBasis, 'HTTP_CACHE_AGE');
  assert.equal(upstreamTiming(new Headers({Age: '1200'}), now).sourceAsOf, new Date(now - 1200000).toISOString());
  assert.equal(upstreamTiming(new Headers(), now).sourceAsOf, null);
});
test('transport cache preserves original capture and source times on a hit', async () => {
  const oldFetch = globalThis.fetch, oldCaches = globalThis.caches, entries = new Map(); let calls = 0;
  globalThis.caches = {default: {match: async k => entries.get(k)?.clone(), put: async (k, v) => {entries.set(k, v.clone());}}};
  globalThis.fetch = async () => {calls++; return Response.json({value: 1}, {headers: {Age: '3600'}});};
  try {
    const first = await providerJSON('age-test', 'https://age.test/pairs'), second = await providerJSON('age-test', 'https://age.test/pairs');
    assert.equal(calls, 1); assert.equal(second.cached, true); assert.equal(second.fetchedAt, first.fetchedAt); assert.equal(second.sourceAsOf, first.sourceAsOf);
    assert.ok(Date.parse(first.fetchedAt) - Date.parse(first.sourceAsOf) >= 3600000);
  } finally {globalThis.fetch = oldFetch; globalThis.caches = oldCaches;}
});
test('Dex cache timing survives transport, pair conversion, normalization and scoring', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{chainId: 'solana', pairAddress: B, baseToken: {address: A}, quoteToken: {address: B},
    priceUsd: '1', liquidity: {usd: 500000}, volume: {h24: 2500000, h1: 150000, m5: 20000}, priceChange: {h24: 24, h1: 8, m5: 2},
    txns: {h24: {buys: 700, sells: 300}, h1: {buys: 80, sells: 20}, m5: {buys: 24, sells: 6}}}], {headers: {Age: '3600'}});
  try {
    const market = await marketPairs([A]), [c] = scanPairs(market.pairs), r = scoreCandidate(c);
    assert.equal(c.sourceTimeBasis, 'HTTP_CACHE_AGE'); assert.ok(r.riskFlags.includes('STALE_SOURCE_DATA')); assert.equal(r.decision, 'WATCH');
  } finally {globalThis.fetch = oldFetch;}
});
test('Gecko retains pool age and timing instead of assuming a full hour of history', () => {
  const observedAt = new Date(now).toISOString(), poolCreatedAt = new Date(now - 20 * 60000).toISOString();
  const rows = geckoPairs({data: [{id: 'solana_' + B, type: 'pool', attributes: {address: B, base_token_price_usd: '1', reserve_in_usd: '500000', pool_created_at: poolCreatedAt},
    relationships: {base_token: {data: {id: 'solana_' + A}}, quote_token: {data: {id: 'solana_' + B}}}}]}, observedAt, {sourceAsOf: observedAt, sourceTimeBasis: 'HTTP_RESPONSE_DATE'});
  const [c] = scanPairs(rows); assert.equal(c.poolCreatedAt, poolCreatedAt); assert.equal(c.sourceAsOf, observedAt);
});
test('normalization of an undated raw payload does not invent a fresh observation time', () => {
  const [c] = scanPairs([{chainId: 'solana', pairAddress: B, baseToken: {address: A}, quoteToken: {address: B}, priceUsd: '1', liquidity: {usd: 500000}}]);
  assert.equal(c.observedAt, null);
});
test('finite extreme inputs remain JSON-safe with bounded scores', () => {
  const r = score(candidate({volume24h: 1e307, liquidityUsd: 1}));
  assert.ok(r.score >= 0 && r.score <= 100); assert.equal(r.metrics.volumeLiquidityRatio, 1e307);
  assert.ok(Number.isFinite(r.metrics.volumeLiquidityRatio)); assert.doesNotMatch(JSON.stringify(r), /Infinity|NaN/);
});
test('future outcomes cannot change V3 feature values or decisions', () => {
  const c = candidate(); assert.deepEqual(score(c), score({...c, futurePrice: 99999, roi_pct: 9999, outcome: 'WIN', modelWeights: [1, 0, 0]}));
});
test('AI Worker health advertises V3 and unauthenticated scoring stays private', async () => {
  const health = await (await engine.fetch(new Request('https://engine/health'), {})).json(); assert.equal(health.model, MODEL);
  const r = await engine.fetch(new Request('https://engine/score', {method: 'POST', body: JSON.stringify({items: [candidate()]})}), {INTERNAL_TOKEN: 'private'});
  assert.equal(r.status, 401);
});
