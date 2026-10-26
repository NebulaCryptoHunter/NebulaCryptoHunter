/**
 * NEBULA Prediction Engine V2 — deterministic decision policy.
 * Server-side module for integration into nebula-api.
 * Heuristic scores are ranking signals, NOT calibrated probabilities.
 */
export const ENGINE_VERSION = '2.0.0';
const validMint = ca => typeof ca === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
const finitePositive = x => typeof x === 'number' && Number.isFinite(x) && x > 0;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export function evaluatePrediction(input, policy = {}) {
  const p = { minLiquidityUSD: 1000, minQuality: 60, minSecurity: 65, minHolders: 20, minConfidence: 65, buyScore: 75, strongBuyScore: 90, ...policy };
  const reasons = [];
  if (!validMint(input?.token_ca)) reasons.push('INVALID_MINT');
  if (!finitePositive(input?.entry_price)) reasons.push('MISSING_VALID_PRICE');
  if (!finitePositive(input?.liquidity_usd) || input.liquidity_usd < p.minLiquidityUSD) reasons.push('INSUFFICIENT_LIQUIDITY');
  if (!Number.isInteger(input?.holder_count) || input.holder_count < p.minHolders) reasons.push('UNVERIFIED_HOLDERS');
  if (input?.rug_status !== 'SAFE' || input?.mint_authority_enabled !== false || input?.freeze_authority_enabled !== false) reasons.push('SECURITY_NOT_VERIFIED');
  if (input?.dex_verified !== true || input?.helius_verified !== true || input?.rug_verified !== true) reasons.push('DATA_NOT_VERIFIED');
  const quality = Number(input?.quality_score), security = Number(input?.security_score), confidence = Number(input?.confidence_score), score = Number(input?.ai_score);
  if (!Number.isFinite(quality) || quality < p.minQuality) reasons.push('LOW_QUALITY');
  if (!Number.isFinite(security) || security < p.minSecurity) reasons.push('LOW_SECURITY');
  if (!Number.isFinite(confidence) || confidence < p.minConfidence) reasons.push('LOW_CONFIDENCE');
  if (!Number.isFinite(score)) reasons.push('MISSING_SCORE');
  const passedGate = reasons.length === 0;
  const decision = !passedGate ? 'WATCH' : score >= p.strongBuyScore ? 'STRONG_BUY' : score >= p.buyScore ? 'BUY' : 'WATCH';
  return { engine_version: ENGINE_VERSION, token_ca: input?.token_ca ?? null, decision, passed_gate: passedGate, reasons, ranking_score: Number.isFinite(score) ? clamp(score, 0, 100) : null, confidence_is_calibrated: false, predicted_multiplier: null, probability_of_profit: null, evaluation_status: 'PENDING' };
}
