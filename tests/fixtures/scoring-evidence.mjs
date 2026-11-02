import {TOKEN_PROGRAM} from '../../backend/workers/risk-assessment.mjs';
export function scoringEvidence(mint, observedAt) {
  return {
    tokenMetadata: {mint, identityVerified: true, source: 'jupiter', observedAt, topHoldersPercentage: 15, mintAuthorityDisabled: true, freezeAuthorityDisabled: true},
    verificationEvidence: {
      mintAccount: {mint, identityVerified: true, source: 'helius', observedAt, tokenProgram: TOKEN_PROGRAM, mintAuthorityDisabled: true, freezeAuthorityDisabled: true},
      rugcheck: {mint, identityVerified: true, source: 'rugcheck', observedAt, score: 0, riskCount: 0, hasDanger: false, rugged: false},
    },
  };
}
