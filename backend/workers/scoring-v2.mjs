import {assessRisk} from './risk-assessment.mjs';
// The entry path is retained for existing Workers. V4 is an uncalibrated research ranker.
// Every threshold below is provisional policy, not a fitted or proven trading rule.
export const MODEL = 'heuristic-v4.0.0';
export const SCORE_WEIGHTS = Object.freeze({liquidity: .20, activity: .25, momentum: .30, buyPressure: .25});
export const SCORING_POLICY = Object.freeze({
  minReviewLiquidity: 50000, minPressureTransactions: 20, minRecentTransactions: 10,
  maxObservationAgeMs: 15 * 60000, futureToleranceMs: 60000,
  maxTurnover: 100, maxReviewGain24h: 300, maxReviewGain5m: 30,
  minReviewScore: 60, minReviewPressure: 55, pressurePrior: 10,
  microTradePace: 2, microTradeSizeRatio: 0.25,
  liquidityHalfSaturation: 50000, hourlyMomentumScale: 10, recentMomentumScale: 3,
  maxRecoveryDrawdownPct: 50,
});
const clamp = (x, a = 0, b = 100) => Math.min(b, Math.max(a, x));
const number = x => typeof x === 'number' && Number.isFinite(x) ? x : null;
const nonnegative = x => number(x) !== null && x >= 0 ? x : null;
const change = x => number(x) !== null && x >= -100 ? x : null;
const round = x => Number.isFinite(x) ? Math.abs(x) > 1e306 ? x : Math.round(x * 100) / 100 : null;
const timestamp = x => typeof x === 'string' ? Date.parse(x) : NaN;
function transactions(window) {
  const { buys, sells } = window || {};
  return Number.isSafeInteger(buys) && buys >= 0 && Number.isSafeInteger(sells) && sells >= 0 && Number.isSafeInteger(buys + sells)
    ? buys + sells : null;
}
function pressure(window) {
  const count = transactions(window), prior = SCORING_POLICY.pressurePrior;
  // Shrink count share toward neutral. This is not buy volume or independent-wallet evidence.
  return count !== null && count > 0 ? 100 * (window.buys + prior) / (count + 2 * prior) : null;
}

export function scoreCandidate(c, { now = Date.now() } = {}) {
  const policy = SCORING_POLICY, reasons = [], risks = [], missing = [];
  const price = number(c?.priceUsd), liq = number(c?.liquidityUsd);
  const vol = nonnegative(c?.volume24h), day = change(c?.change24h);
  for (const [key, valid] of [['priceUsd', price !== null && price > 0], ['liquidityUsd', liq !== null && liq > 0], ['volume24h', vol !== null], ['change24h', day !== null]]) {
    if (!valid) missing.push(key);
  }
  const base = {
    model: MODEL, dataCoverageDefinition: 'Available market fields only; not confidence, source accuracy or security verification',
    confidence: null, confidenceReason: 'NOT_CALIBRATED', probabilityOfProfit: null,
    predictedMultiplier: null, autoTrade: false, modelCalibrated: false,
    validationStatus: 'PENDING_PROSPECTIVE_VALIDATION',
  };
  const incomplete = (reason, flag) => ({ ...base, decision: 'INSUFFICIENT_DATA', score: null,
    reasons: [reason], riskFlags: [flag], dataCoverage: null, components: null, scoreBreakdown: null, riskAssessment: null, setupStage: 'INCOMPLETE' });
  if (missing.length) return incomplete('Missing valid market data: ' + missing.join(', '), 'INCOMPLETE_MARKET_DATA');
  const ratio = vol / liq;
  if (!Number.isFinite(ratio)) return incomplete('Invalid volume/liquidity ratio', 'INVALID_MARKET_RATIO');
  const observed = timestamp(c.observedAt), source = timestamp(c.sourceAsOf);
  const freshTime = t => Number.isFinite(now) && Number.isFinite(t) && t <= now + policy.futureToleranceMs && now - t <= policy.maxObservationAgeMs;
  let fresh = freshTime(observed);
  if (!fresh) risks.push(observed > now + policy.futureToleranceMs ? 'FUTURE_OBSERVATION' : 'STALE_OR_UNTIMED_OBSERVATION');
  // Retrieval time never refreshes an older upstream cache timestamp.
  if (c.sourceAsOf != null && !freshTime(source)) {
    fresh = false;
    risks.push(!Number.isFinite(source) ? 'INVALID_SOURCE_TIME' : source > now + policy.futureToleranceMs ? 'FUTURE_SOURCE_TIME' : 'STALE_SOURCE_DATA');
  }
  const hour = c.timeframes?.h1 || {}, five = c.timeframes?.m5 || {};
  const h1 = change(hour.changePct), m5 = change(five.changePct);
  const v1 = nonnegative(hour.volumeUsd), v5 = nonnegative(five.volumeUsd);
  const t1 = transactions(hour), t5 = transactions(five);
  const dayWindow = { buys: c.buys24h, sells: c.sells24h }, t24 = transactions(dayWindow);
  const p1 = pressure(hour), p5 = pressure(five), p24 = pressure(dayWindow);
  // A strong hour cannot mask a weak last five minutes. Day-only pressure is descriptive.
  const buyPressure = p1 !== null && p5 !== null ? Math.min(p1, p5) : p1 ?? p24;
  const pressureWindow = p1 !== null ? p5 !== null ? 'm5+h1' : 'h1' : p24 !== null ? 'h24' : null;
  const coverage = 50 + (h1 !== null ? 10 : 0) + (m5 !== null ? 10 : 0)
    + (v1 !== null ? 10 : 0) + (v5 !== null ? 10 : 0) + (t1 !== null ? 5 : 0) + (t5 !== null ? 5 : 0);
  // Depth is useful, but a large pool must not dominate four independent market features.
  const liquidity = 100 / (1 + policy.liquidityHalfSaturation / liq);
  const activity = v1 !== null ? clamp(Math.log1p(v1 / liq) / Math.log(2) * 100) : null;
  // Smooth bounded curves distinguish +25% from +50%, without rewarding an unlimited spike.
  const momentumValue = (r, scale) => r !== null ? 50 + 50 * (r / (Math.abs(r) + scale)) : null;
  const hourMomentum = momentumValue(h1, policy.hourlyMomentumScale);
  const recentMomentum = momentumValue(m5, policy.recentMomentumScale);
  const momentum = hourMomentum !== null && recentMomentum !== null ? .6 * hourMomentum + .4 * recentMomentum : hourMomentum;
  const components = { liquidity: round(liquidity), activity: round(activity), momentum: round(momentum), buyPressure: round(buyPressure) };
  const rawComponents = {liquidity, activity, momentum, buyPressure};
  // Allocate integer hundredths once so displayed contributions add exactly to baseScore.
  const terms = Object.entries(SCORE_WEIGHTS).map(([key, weight]) => ({key, weight, raw: weight * (rawComponents[key] ?? 0) * 100}));
  const totalCents = Math.round(terms.reduce((sum, t) => sum + t.raw, 0));
  const cents = terms.map(t => Math.floor(t.raw));
  const order = terms.map((t, i) => ({i, fraction: t.raw - cents[i]})).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0, rest = totalCents - cents.reduce((a, b) => a + b, 0); i < rest; i++) cents[order[i].i]++;
  const contributions = terms.map((t, i) => ({component: t.key, weight: t.weight, value: components[t.key], points: cents[i] / 100}));
  const baseScore = totalCents / 100, penalties = [], caps = [];
  let score = baseScore;
  const penalize = (reason, points) => { const amount = round(points); penalties.push({reason, points: amount}); score = round(score - amount); };
  const cap = (reason, limit) => { const before = score; score = Math.min(score, limit); caps.push({reason, limit, reduction: round(before - score)}); };
  if (liq < policy.minReviewLiquidity) risks.push('THIN_LIQUIDITY');
  if (t1 === null || t1 < policy.minPressureTransactions) risks.push('INSUFFICIENT_TRANSACTION_SAMPLE');
  if (t5 === null || t5 < policy.minRecentTransactions) risks.push('INSUFFICIENT_RECENT_TRANSACTION_SAMPLE');
  if (h1 === null) risks.push('SHORT_TERM_MOMENTUM_MISSING');
  if (m5 === null) risks.push('RECENT_MOMENTUM_MISSING');
  if (v1 === null || v5 === null) risks.push('SHORT_TERM_VOLUME_MISSING');
  if (p1 === null) risks.push('HOURLY_PRESSURE_UNCONFIRMED');
  // Rolling subwindows must agree. Allow minor USD rounding/provider assembly differences.
  const volumeExceeds = (short, long) => short !== null && long !== null && short > long + Math.max(1, long * .01);
  const countsExceed = (short, long) => transactions(short) !== null && transactions(long) !== null
    && (short.buys > long.buys || short.sells > long.sells);
  const inconsistent = volumeExceeds(v5, v1) || volumeExceeds(v1, vol)
    || countsExceed(five, hour) || countsExceed(hour, dayWindow);
  const mismatch = [[v1, t1], [v5, t5]].some(([v, t]) => v !== null && t !== null && ((v === 0 && t > 0) || (v > 0 && t === 0)));
  if (inconsistent) { risks.push('INCONSISTENT_TIME_WINDOWS'); penalize('INCONSISTENT_TIME_WINDOWS', 20); }
  if (mismatch) { risks.push('VOLUME_TRANSACTION_MISMATCH'); penalize('VOLUME_TRANSACTION_MISMATCH', 20); }
  if (h1 !== null && h1 < 0) {
    risks.push('DOWNSIDE_MOMENTUM');
    penalize('DOWNSIDE_MOMENTUM', Math.min(35, Math.abs(h1) * 1.5));
  }
  if (day <= -policy.maxRecoveryDrawdownPct) { risks.push('DEEP_DAILY_DRAWDOWN'); penalize('DEEP_DAILY_DRAWDOWN', Math.min(15, Math.abs(day) * .15)); }
  if (m5 !== null && m5 < 0) { risks.push('RECENT_REVERSAL'); penalize('RECENT_REVERSAL', Math.min(25, Math.abs(m5) * 2)); }
  if (buyPressure !== null && buyPressure < 50) { risks.push('SELL_PRESSURE'); penalize('SELL_PRESSURE', (50 - buyPressure) * .5); }
  if (p5 !== null && p5 < 50) risks.push('RECENT_SELL_PRESSURE');
  const created = timestamp(c.poolCreatedAt);
  const poolAgeMinutes = Number.isFinite(created) && Number.isFinite(observed) ? (observed - created) / 60000 : null;
  const mature = poolAgeMinutes !== null && poolAgeMinutes >= 60;
  if (poolAgeMinutes !== null && poolAgeMinutes < 0) risks.push('INVALID_POOL_CREATION_TIME');
  // Use disjoint intervals (last 5m vs preceding 55m), not 12x overlapping return subtraction.
  // Without a full hour of pool history the denominator is not a 55-minute baseline.
  const disjoint = mature && !inconsistent && !mismatch;
  const volumePace = disjoint && v5 !== null && v1 > v5 ? 11 * v5 / (v1 - v5) : null;
  const transactionPace = disjoint && t5 !== null && t1 > t5 ? 11 * t5 / (t1 - t5) : null;
  const avgRecent = v5 !== null && t5 > 0 ? v5 / t5 : null;
  const avgPrior = disjoint && v1 !== null && v5 !== null && t1 !== null && t5 !== null && t1 > t5 ? (v1 - v5) / (t1 - t5) : null;
  const sizeRatio = avgRecent !== null && avgPrior > 0 ? avgRecent / avgPrior : null;
  const microTrade = t5 >= policy.minRecentTransactions && transactionPace >= policy.microTradePace && sizeRatio !== null && sizeRatio < policy.microTradeSizeRatio;
  if (microTrade) { risks.push('SMALL_TRADE_COUNT_SPIKE'); penalize('SMALL_TRADE_COUNT_SPIKE', 15); }
  if (ratio > policy.maxTurnover) { risks.push('EXTREME_TURNOVER'); penalize('EXTREME_TURNOVER', 20); }
  if (day > policy.maxReviewGain24h || (m5 !== null && m5 > policy.maxReviewGain5m)) { risks.push('OVERHEATED_MOMENTUM'); penalize('OVERHEATED_MOMENTUM', 20); }
  if (vol === 0 || t1 === 0 || t5 === 0) { risks.push('NO_OBSERVED_ACTIVITY'); cap('NO_OBSERVED_ACTIVITY', 20); }
  const quarantined = liq <= 1 || ratio > policy.maxTurnover || inconsistent || mismatch;
  if (quarantined) cap('QUARANTINED', 20);
  if (liq < policy.minReviewLiquidity) cap('THIN_LIQUIDITY', policy.minReviewScore - 1);
  if (coverage < 100) cap('INCOMPLETE_MARKET_DATA', policy.minReviewScore - 1);
  if (!fresh) cap('STALE_MARKET_DATA', 30);
  const marketScore = round(clamp(score));
  const riskAssessment = assessRisk(c, {now}), verified = riskAssessment.allChecksPassed;
  if (!verified) reasons.push(riskAssessment.status === 'RISK_DETECTED' ? 'Security risk detected by limited checks' : 'Security or whale concentration unverified');
  if (!verified) cap(riskAssessment.status, riskAssessment.scoreCap);
  if (poolAgeMinutes === null) reasons.push('Pool age unknown; disjoint pace baseline unavailable');
  else if (!mature && poolAgeMinutes >= 0) reasons.push('Pool younger than one hour; disjoint pace baseline unavailable');
  if (microTrade) reasons.push('Transaction counts rose while average trade size fell; not proof of wash trading');
  reasons.push(...risks);
  const marketReady = fresh && risks.length === 0 && h1 > 0 && m5 > 0 && buyPressure >= policy.minReviewPressure && coverage === 100 && marketScore >= policy.minReviewScore;
  const recovery = marketReady && day < 0;
  if (recovery) reasons.push('Positive 1h and 5m recovery within a negative 24h return; not a confirmed long-term reversal');
  const setupStage = quarantined ? 'QUARANTINED' : !fresh ? 'STALE' : riskAssessment.status === 'RISK_DETECTED' ? 'RISK_BLOCKED' : risks.includes('RECENT_REVERSAL') || risks.includes('RECENT_SELL_PRESSURE') ? 'COOLING' : recovery ? 'RECOVERY_SETUP' : marketReady ? 'CONFIRMED_MARKET_SETUP' : coverage < 100 ? 'INCOMPLETE' : 'OBSERVING';
  reasons.push(...riskAssessment.flags);
  const finalScore = round(clamp(score));
  const scoreBreakdown = {weights: SCORE_WEIGHTS, contributions, baseScore, penalties, caps, marketScore,
    penaltyTotal: round(penalties.reduce((sum, p) => sum + p.points, 0)),
    capReduction: round(caps.reduce((sum, c) => sum + c.reduction, 0)),
    rangeAdjustment: round(finalScore - score), finalScore,
    definition: 'Base points minus penalties minus cap reductions plus range adjustment equals finalScore; component values are 0–100 indicators, not probabilities'};
  return { ...base, decision: marketReady && verified ? 'REVIEW' : 'WATCH', score: round(clamp(score)), reasons,
    riskFlags: [...risks, ...riskAssessment.flags], dataCoverage: coverage, components, setupStage, scoreBreakdown, riskAssessment,
    metrics: {
      volumeLiquidityRatio: round(ratio), pressureTransactions: t1 ?? t24, recentTransactions: t5,
      buyPressureWindow: pressureWindow, buyPressureH1: round(p1), buyPressureM5: round(p5),
      pressureDefinition: 'Shrunk transaction count share, not USD buy flow or unique buyers',
      volumePace5mVsPrior55m: round(volumePace), transactionPace5mVsPrior55m: round(transactionPace),
      averageTradeUsd5m: round(avgRecent), averageTradeUsdPrior55m: round(avgPrior), relativeTradeSize: round(sizeRatio),
      poolAgeMinutes: round(poolAgeMinutes), paceBaseline: disjoint ? 'FULL_HOUR_SAME_POOL' : 'UNAVAILABLE',
      referencePriceUsable: !quarantined && fresh, ageMs: Number.isFinite(observed) ? now - observed : null,
      sourceAgeMs: Number.isFinite(source) ? now - source : null, sourceTimeBasis: c.sourceTimeBasis || 'FETCH_ONLY',
    },
  };
}
