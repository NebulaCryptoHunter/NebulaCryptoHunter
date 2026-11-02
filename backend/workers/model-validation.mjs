import {MODEL} from './scoring-v2.mjs';
const number = x => typeof x === 'number' && Number.isFinite(x);
// Existing bounded read only; no additional DB scan, fitted weights or invented outcomes.
export function modelValidation(candidates, {now = Date.now()} = {}) {
  const bands = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 101]].map(([min, max]) => ({min, maxExclusive: max, candidates: 0, measured: 0, meanObservedReturnPct: null}));
  const seen = new Set(), returns = bands.map(() => []); let selected = 0, measured = 0;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (c?.model !== MODEL || c.id == null || seen.has(c.id) || !number(c.ai_score) || c.ai_score < 0 || c.ai_score > 100) continue;
    const observed = Date.parse(c.observed_at);
    if (!Number.isFinite(observed) || observed > now) continue;
    seen.add(c.id); selected++;
    const i = bands.findIndex(b => c.ai_score >= b.min && c.ai_score < b.maxExclusive); bands[i].candidates++;
    const exitTime = Date.parse(c.evaluation_observed_at), elapsed = (exitTime - observed) / 1000;
    if (c.evaluation_status !== 'COMPLETED' || elapsed < 1800 || elapsed > 5400 || !Number.isFinite(elapsed) || exitTime > now
      || !number(c.entry_price) || c.entry_price <= 0 || !number(c.exit_price) || c.exit_price <= 0 || !number(c.roi_pct)) continue;
    const roi = (c.exit_price / c.entry_price - 1) * 100;
    if (!Number.isFinite(roi) || Math.abs(roi - c.roi_pct) > .01) continue;
    returns[i].push(roi); bands[i].measured++; measured++;
  }
  bands.forEach((b, i) => {if (returns[i].length) b.meanObservedReturnPct = returns[i].reduce((sum, n) => sum + n / returns[i].length, 0);});
  return {model: MODEL, status: measured ? 'OBSERVED_NOT_CALIBRATED' : 'PENDING_PROSPECTIVE_OUTCOMES', calibrated: false,
    sampleScope: 'LATEST_50_CANDIDATES', candidates: selected, measured, bands,
    definition: 'Descriptive same-pool point returns observed 30–90 minutes later, grouped by original model and score. Bounded recent sample, variable horizon, no trade P&L, probability calibration or performance claim'};
}
