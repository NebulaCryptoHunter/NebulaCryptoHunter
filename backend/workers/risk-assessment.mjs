// Limited, time-bound checks for a research ranking. Passing is never a safety guarantee.
export const RISK_POLICY = Object.freeze({
  maxEvidenceAgeMs: 15 * 60000, futureToleranceMs: 60000,
  maxTopHoldersPercentage: 20, unverifiedScoreCap: 69, cautionScoreCap: 39, criticalScoreCap: 20,
});
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const numeric = x => typeof x === 'number' && Number.isFinite(x);
const time = x => typeof x === 'string' ? Date.parse(x) : NaN;

export function assessRisk(candidate, {now = Date.now()} = {}) {
  const mint = candidate?.base?.mint, evidence = candidate?.verificationEvidence || {}, flags = [];
  const fresh = e => {
    if (!e || !mint || e.mint !== mint || e.identityVerified !== true) return 'UNKNOWN';
    const times = [e.observedAt, ...['sourceAsOf', 'sourceUpdatedAt'].filter(k => e[k] != null).map(k => e[k])].map(time);
    return times.every(t => Number.isFinite(now) && Number.isFinite(t) && t <= now + RISK_POLICY.futureToleranceMs && now - t <= RISK_POLICY.maxEvidenceAgeMs) ? 'CURRENT' : 'STALE';
  };
  const rpc = evidence.mintAccount, meta = candidate?.tokenMetadata, rug = evidence.rugcheck;
  const rpcTime = fresh(rpc), metaTime = fresh(meta), rugTime = fresh(rug);
  const check = (status, source = null, value = null) => ({status, source, value});
  const supported = rpcTime === 'CURRENT' && rpc.tokenProgram === TOKEN_PROGRAM;
  const knownProgram = rpcTime === 'CURRENT' && [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(rpc.tokenProgram);
  const authority = key => {
    const a = knownProgram && typeof rpc[key] === 'boolean' ? rpc[key] : null;
    const b = metaTime === 'CURRENT' && typeof meta[key] === 'boolean' ? meta[key] : null;
    // A contradictory fresh source never gets silently overridden by a positive verdict.
    if (a !== null && b !== null && a !== b) return check('CONFLICT', 'rpc+jupiter');
    if (a === false || b === false) return check('FAIL', a === false ? rpc.source : 'jupiter', false);
    if (a === true) return check('PASS', rpc.source, true);
    return check(rpcTime === 'STALE' ? 'STALE' : 'UNKNOWN');
  };
  const checks = {
    mintAuthority: authority('mintAuthorityDisabled'), freezeAuthority: authority('freezeAuthorityDisabled'),
    tokenProgram: supported ? check('PASS', rpc.source, rpc.tokenProgram)
      : check(rpcTime === 'STALE' ? 'STALE' : 'UNKNOWN', rpcTime === 'CURRENT' ? rpc.source : null),
    holderConcentration: check(metaTime === 'STALE' ? 'STALE' : 'UNKNOWN'),
    rugcheck: check(rugTime === 'STALE' ? 'STALE' : 'UNKNOWN'),
  };
  if (metaTime === 'CURRENT' && numeric(meta.topHoldersPercentage) && meta.topHoldersPercentage >= 0 && meta.topHoldersPercentage <= 100)
    checks.holderConcentration = check(meta.topHoldersPercentage <= RISK_POLICY.maxTopHoldersPercentage ? 'PASS' : 'FAIL', 'jupiter', meta.topHoldersPercentage);
  const reportComplete = rugTime === 'CURRENT' && Number.isSafeInteger(rug.riskCount) && rug.riskCount >= 0
    && typeof rug.hasDanger === 'boolean' && numeric(rug.score) && rug.score >= 0;
  if (reportComplete && (rug.riskCount > 0 || rug.rugged === true)) checks.rugcheck = check('FAIL', 'rugcheck', rug.riskCount);
  else if (reportComplete && rug.score === 0) checks.rugcheck = check('PASS', 'rugcheck', 0);
  const critical = ['mintAuthority', 'freezeAuthority'].some(k => ['FAIL', 'CONFLICT'].includes(checks[k].status))
    || (rugTime === 'CURRENT' && (rug.rugged === true || rug.hasDanger === true));
  for (const [k, c] of Object.entries(checks)) if (['FAIL', 'CONFLICT'].includes(c.status)) flags.push('RISK_' + k.replace(/[A-Z]/g, c => '_' + c).toUpperCase() + '_' + c.status);
  if (rugTime === 'CURRENT' && rug.rugged === true) flags.push('RISK_REPORTED_RUGGED');
  if (rugTime === 'CURRENT' && rug.hasDanger === true) flags.push('RISK_RUGCHECK_DANGER');
  if (metaTime === 'CURRENT' && meta.isSus === true) flags.push('RISK_JUPITER_SUSPICIOUS');
  const failed = critical || flags.length > 0;
  const passed = Object.values(checks).filter(c => c.status === 'PASS').length;
  const allChecksPassed = !failed && passed === Object.keys(checks).length;
  return {
    status: failed ? 'RISK_DETECTED' : allChecksPassed ? 'CHECKS_PASSED' : 'UNVERIFIED',
    allChecksPassed, critical, checks, coverage: passed / Object.keys(checks).length * 100,
    scoreCap: critical ? RISK_POLICY.criticalScoreCap : failed ? RISK_POLICY.cautionScoreCap : allChecksPassed ? 100 : RISK_POLICY.unverifiedScoreCap,
    flags, definition: 'Limited current mint/freeze, standard token program, provider-reported holder concentration and Rugcheck checks; not a safety guarantee or unique-wallet audit',
  };
}
