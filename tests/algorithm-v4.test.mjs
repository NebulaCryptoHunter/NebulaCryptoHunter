import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {scoreCandidate, MODEL, SCORE_WEIGHTS} from '../backend/workers/scoring-v2.mjs';
import {assessRisk, TOKEN_PROGRAM, TOKEN_2022_PROGRAM} from '../backend/workers/risk-assessment.mjs';
import {modelValidation} from '../backend/workers/model-validation.mjs';
import {researchData} from '../backend/workers/research-api.mjs';
import {marketFeed} from '../backend/workers/market-sources.mjs';
import {tokenEvidence} from '../backend/workers/token-evidence.mjs';
import {scoringEvidence} from './fixtures/scoring-evidence.mjs';
const now = Date.parse('2026-11-03T01:00:00Z'), at = new Date(now).toISOString();
const A = 'So11111111111111111111111111111111111111112', B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const candidate = (patch = {}) => ({base: {mint: A}, pairAddress: B, priceUsd: 1, liquidityUsd: 500000, volume24h: 2500000, change24h: 24,
  observedAt: at, poolCreatedAt: new Date(now - 7200000).toISOString(), buys24h: 700, sells24h: 300,
  timeframes: {h1: {changePct: 8, volumeUsd: 150000, buys: 80, sells: 20}, m5: {changePct: 2, volumeUsd: 20000, buys: 24, sells: 6}},
  ...scoringEvidence(A, at), ...patch});
const score = c => scoreCandidate(c, {now});
const sum = xs => xs.reduce((a, b) => a + b, 0), cents = x => Math.round(x * 100);
test('V4 uses one fixed market weighting policy, independent of caller mode or future outcomes', () => {
  assert.equal(MODEL, 'heuristic-v4.0.0'); assert.equal(sum(Object.values(SCORE_WEIGHTS)), 1);
  assert.deepEqual(SCORE_WEIGHTS, {liquidity: .20, activity: .25, momentum: .30, buyPressure: .25});
  const c = candidate(), r = score(c); assert.equal(r.decision, 'REVIEW');
  assert.deepEqual(r, score({...c, mode: 'sniper', risk: {rugCheck: 'SAFE'}, futurePrice: 500, roi_pct: 999, modelWeights: [1, 0, 0]}));
  assert.equal(r.modelCalibrated, false); assert.equal(r.autoTrade, false); assert.equal(r.confidence, null);
});
test('liquidity no longer dominates otherwise equal normalized market activity', () => {
  const rows = [50000, 100000, 500000, 1000000].map(liquidityUsd => {
    const c = candidate({liquidityUsd, volume24h: liquidityUsd * 5}); c.timeframes.h1.volumeUsd = liquidityUsd * .3; c.timeframes.m5.volumeUsd = liquidityUsd * .04;
    return score(c);
  });
  assert.ok(rows.every(r => r.riskAssessment.allChecksPassed && !r.riskFlags.includes('THIN_LIQUIDITY'))); assert.equal(rows[3].decision, 'REVIEW');
  assert.ok(rows[3].score > rows[0].score); assert.ok(rows[3].score - rows[0].score < 10, 'Previously about 19.52 points');
  assert.equal(score(candidate({liquidityUsd: 49000})).decision, 'WATCH');
  assert.ok(score(candidate({liquidityUsd: 49000})).score <= 59);
});
test('momentum keeps distinguishing strong returns without a hard +25% or +8.33% plateau', () => {
  const momentum = (h1, m5) => {const c = candidate(); c.timeframes.h1.changePct = h1; c.timeframes.m5.changePct = m5; return score(c).components.momentum;};
  assert.ok(momentum(50, 15) > momentum(25, 15)); assert.ok(momentum(25, 15) > momentum(25, 8.34));
  assert.ok(momentum(100, 30) < 100); assert.ok(momentum(-20, -5) < momentum(0, 0));
});
test('a modest red day allows a confirmed short-term recovery; a deep drawdown still blocks review', () => {
  const r = score(candidate({change24h: -1})); assert.equal(r.decision, 'REVIEW'); assert.equal(r.setupStage, 'RECOVERY_SETUP');
  assert.equal(r.score, score(candidate()).score); assert.ok(!r.riskFlags.includes('DOWNSIDE_MOMENTUM'));
  const deep = score(candidate({change24h: -60})); assert.equal(deep.decision, 'WATCH'); assert.ok(deep.riskFlags.includes('DEEP_DAILY_DRAWDOWN'));
  const c = candidate({change24h: -1}); c.timeframes.m5.changePct = -2; assert.equal(score(c).setupStage, 'COOLING');
});
test('the point ledger exactly reconciles the final score across losses, caps and missing evidence', () => {
  for (const liquidityUsd of [1, 10000, 50000, 500000, 1e307]) for (const changePct of [-100, -5, 2, 35]) {
    const c = candidate({liquidityUsd, tokenMetadata: null, verificationEvidence: null}); c.timeframes.m5.changePct = changePct;
    const r = score(c), b = r.scoreBreakdown;
    assert.equal(sum(b.contributions.map(c => cents(c.points))), cents(b.baseScore));
    assert.equal(cents(b.baseScore) - cents(b.penaltyTotal) - cents(b.capReduction) + cents(b.rangeAdjustment), cents(r.score));
    assert.equal(b.finalScore, r.score); assert.ok(r.score >= 0 && r.score <= 100);
    assert.doesNotMatch(JSON.stringify(r), /NaN|Infinity/);
  }
});
test('legacy SAFE strings cannot clear missing security evidence or permit a near-100 ranking', () => {
  const c = candidate({risk: {rugCheck: 'SAFE', whaleConcentration: 'SAFE'}, verificationEvidence: null, tokenMetadata: null});
  c.timeframes.h1 = {changePct: 30, volumeUsd: 500000, buys: 1000, sells: 10}; c.timeframes.m5 = {changePct: 15, volumeUsd: 100000, buys: 100, sells: 1};
  c.buys24h = 5000; c.sells24h = 500;
  const r = score(c); assert.ok(r.scoreBreakdown.marketScore > 90); assert.equal(r.score, 69); assert.equal(r.decision, 'WATCH');
  assert.equal(r.riskAssessment.coverage, 0); assert.equal(r.riskAssessment.status, 'UNVERIFIED');
});
test('each required piece of evidence is necessary for the limited checks to pass', () => {
  for (const part of ['mintAccount', 'rugcheck', 'metadata']) {
    const c = candidate(); if (part === 'metadata') c.tokenMetadata = null; else delete c.verificationEvidence[part];
    const r = score(c); assert.equal(r.decision, 'WATCH'); assert.ok(r.score <= 69); assert.equal(r.riskAssessment.allChecksPassed, false);
  }
});
test('wrong mint, missing identity, invalid source times and stale evidence never pass', () => {
  for (const part of ['mintAccount', 'rugcheck', 'metadata']) for (const patch of [
    {mint: B}, {identityVerified: false}, {observedAt: null}, {sourceAsOf: 'bad'},
    {sourceAsOf: new Date(now - 16 * 60000).toISOString()}, {observedAt: new Date(now + 120000).toISOString()},
  ]) {
    const c = candidate(), target = part === 'metadata' ? c.tokenMetadata : c.verificationEvidence[part]; Object.assign(target, patch);
    assert.equal(score(c).decision, 'WATCH'); assert.equal(assessRisk(c, {now}).allChecksPassed, false);
  }
});
test('fresh HTTP capture cannot refresh an outdated Jupiter provider timestamp', () => {
  const c = candidate(); c.tokenMetadata.sourceUpdatedAt = new Date(now - 3600000).toISOString();
  const r = score(c); assert.equal(r.riskAssessment.checks.holderConcentration.status, 'STALE'); assert.equal(r.decision, 'WATCH');
});
test('active or contradictory mint and freeze authorities block the score at 20', () => {
  for (const key of ['mintAuthorityDisabled', 'freezeAuthorityDisabled']) {
    const c = candidate(); c.verificationEvidence.mintAccount[key] = false;
    const r = score(c); assert.ok(r.score <= 20); assert.equal(r.setupStage, 'RISK_BLOCKED'); assert.equal(r.riskAssessment.critical, true);
    assert.ok(r.riskFlags.some(f => f.endsWith('_CONFLICT')));
    c.tokenMetadata[key] = false; assert.ok(score(c).score <= 20);
  }
});
test('Token-2022 is explicitly left unverified until extension checks exist', () => {
  const c = candidate(); c.verificationEvidence.mintAccount.tokenProgram = TOKEN_2022_PROGRAM;
  const r = score(c); assert.equal(r.decision, 'WATCH'); assert.equal(r.riskAssessment.checks.tokenProgram.status, 'UNKNOWN');
  c.verificationEvidence.mintAccount.freezeAuthorityDisabled = false; assert.ok(score(c).score <= 20);
});
test('concentrated holders, report warnings and suspicious metadata apply a 39-point ceiling', () => {
  for (const change of [c => {c.tokenMetadata.topHoldersPercentage = 60;}, c => {c.verificationEvidence.rugcheck.riskCount = 1;}, c => {c.tokenMetadata.isSus = true;}]) {
    const c = candidate(); change(c); const r = score(c); assert.ok(r.score <= 39); assert.equal(r.riskAssessment.status, 'RISK_DETECTED'); assert.equal(r.decision, 'WATCH');
  }
});
test('Rugcheck danger or reported rug applies the critical ceiling even when the rest of its report is incomplete', () => {
  for (const patch of [{hasDanger: true, score: null}, {rugged: true, riskCount: null}]) {
    const c = candidate(); Object.assign(c.verificationEvidence.rugcheck, patch); const r = score(c); assert.ok(r.score <= 20); assert.equal(r.riskAssessment.critical, true);
  }
});
test('malformed concentration and unexplained positive report scores are not positive verdicts', () => {
  for (const value of [null, '15', true, NaN, -1, 101]) {
    const c = candidate(); c.tokenMetadata.topHoldersPercentage = value; assert.equal(score(c).decision, 'WATCH');
  }
  const c = candidate(); c.verificationEvidence.rugcheck.score = 1000; assert.equal(score(c).decision, 'WATCH');
});
test('danger alerts beyond the display truncation remain effective in scoring', async () => {
  const old = globalThis.fetch; globalThis.fetch = async () => Response.json({mint: A, score: 1000, risks: [...Array(12).fill({name: 'Info', level: 'info', score: 1}), {name: 'Critical', level: 'danger', score: 999}]});
  try {
    const e = await tokenEvidence(A, {}, undefined, {includeRpc: false}); assert.equal(e.evidence.rugcheck.risks.length, 12); assert.equal(e.evidence.rugcheck.hasDanger, true);
    assert.ok(scoreCandidate(candidate({observedAt: new Date().toISOString(), verificationEvidence: {...e.evidence}})).score <= 20);
  } finally {globalThis.fetch = old;}
});
test('actual API enrichment can pass limited checks without setting fabricated SAFE fields', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('tokens/v1')) return Response.json([{chainId: 'solana', pairAddress: B, baseToken: {address: A}, quoteToken: {address: B}, priceUsd: '1', liquidity: {usd: 500000},
      volume: {h24: 2500000, h1: 150000, m5: 20000}, priceChange: {h24: 24, h1: 8, m5: 2}, txns: {h24: {buys: 700, sells: 300}, h1: {buys: 80, sells: 20}, m5: {buys: 24, sells: 6}}}]);
    if (u.includes('jup.ag')) return Response.json([{id: A, updatedAt: new Date().toISOString(), audit: {mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 15}}]);
    if (u.includes('rugcheck')) return Response.json({mint: A, score: 0, risks: [], rugged: false});
    if (u.includes('helius')) return Response.json({result: {value: JSON.parse(init.body).params[0].map(() => ({owner: TOKEN_PROGRAM, data: {parsed: {type: 'mint', info: {mintAuthority: null, freezeAuthority: null, supply: '10000', decimals: 6}}}}))}});
    throw Error('Unexpected upstream');
  };
  try {
    const r = await marketFeed({HELIUS_API_KEY: 'test'}, {mints: [A], includeObservations: true}), item = r.items[0];
    assert.equal(item.decision, 'REVIEW'); assert.equal(item.riskAssessment.status, 'CHECKS_PASSED'); assert.equal(item.model, MODEL);
    assert.equal(r.observations[0].risk.rugCheck, 'UNKNOWN'); assert.equal(item.autoTrade, false); assert.ok(r.requestBudget.upstreamRequests <= 4);
  } finally {globalThis.fetch = old;}
});
test('original model and score remain attached to measured outcomes; duplicates, other models and future prices are excluded', () => {
  const c = {id: 1, model: MODEL, ai_score: 68, observed_at: new Date(now - 3600000).toISOString(), evaluation_observed_at: at,
    evaluation_status: 'COMPLETED', entry_price: 1, exit_price: 1.2, roi_pct: 20};
  const r = modelValidation([c, c, {...c, id: 2, model: 'heuristic-v3.0.0'}, {...c, id: 3, evaluation_observed_at: new Date(now + 60000).toISOString()}, {...c, id: 4, roi_pct: 999}, {...c, id: 5, evaluation_status: 'PENDING'}], {now});
  assert.equal(r.candidates, 4); assert.equal(r.measured, 1); assert.equal(r.bands[3].measured, 1); assert.ok(Math.abs(r.bands[3].meanObservedReturnPct - 20) < 1e-9);
  assert.equal(r.calibrated, false); assert.equal(modelValidation([], {now}).status, 'PENDING_PROSPECTIVE_OUTCOMES');
});
test('persisted score explanations and risk evidence survive the real research SELECT without changing old records', async () => {
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync('backend/migrations/0008_unified_scanner_schema.sql', 'utf8'));
  db.exec('CREATE TABLE predictions(id INTEGER,token_ca TEXT); CREATE TABLE evaluations(id INTEGER);');
  const c = candidate(), r = score(c);
  db.prepare('INSERT INTO scanner_snapshots(mint,pair_address,observed_at,payload_json) VALUES(?,?,?,?)').run(A, B, at, JSON.stringify(c));
  db.prepare('INSERT INTO engine_scores(mint,pair_address,observed_at,model,decision,score,payload_json) VALUES(?,?,?,?,?,?,?)').run(A, B, at, MODEL, r.decision, r.score, JSON.stringify(r));
  const adapter = {prepare(sql) {return {sql};}, async batch(ss) {return ss.map(s => ({results: db.prepare(s.sql).all()}));}};
  try {const data = await researchData(adapter); assert.deepEqual(JSON.parse(data.items[0].scoreBreakdown), r.scoreBreakdown); assert.deepEqual(JSON.parse(data.items[0].riskAssessment), r.riskAssessment);
    assert.equal(JSON.parse(data.items[0].verificationEvidence).mintAccount.mint, A); assert.equal(data.scoreValidation.calibrated, false);
    assert.equal(db.prepare('SELECT risk_verified FROM prediction_candidates').get().risk_verified, 0, 'Existing conservative history trigger stays intact');
  } finally {db.close();}
});
test('the actual frontend renders weighted points, penalties and risk status, while escaping server text', () => {
  const html = readFileSync('index.html', 'utf8');
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) if (script.trim()) new vm.Script(script);
  const source = html.slice(html.indexOf('  function renderDetail(t){'), html.indexOf('  function patchCard('));
  const label = html.slice(html.indexOf('function researchRiskLabel('), html.indexOf('function recordObject('));
  const ctx = vm.createContext({escapeHTML: x => String(x).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'), fmtNum: String, fmtPrice: String});
  vm.runInContext(label + source, ctx); const r = score(candidate());
  const result = ctx.renderDetail({_serverObservation: true, ca: A, _finalAIScore: r.score, serverComponents: r.components, serverBreakdown: r.scoreBreakdown, serverRisk: r.riskAssessment, serverReasons: ['<script>evil</script>'], model: MODEL});
  assert.match(result, /LIKUIDITAS · 20%/); assert.match(result, /AKTIVITAS · 25%/); assert.match(result, /MOMENTUM · 30%/); assert.match(result, /SKOR UTAMA/); assert.match(result, /LOLOS PEMERIKSAAN TERBATAS/);
  assert.doesNotMatch(result, /<script>evil/); assert.match(result, /&lt;script&gt;evil/);
});
