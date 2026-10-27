import test from 'node:test';
import assert from 'node:assert/strict';
import {toPredictionCandidates} from '../workers/nebula-scanner/prediction-adapter.mjs';
const mint='So11111111111111111111111111111111111111112';
const item={base:{mint},pairAddress:'pair-test',observedAt:'2026-10-27T00:00:00Z',risk:{rugCheck:'UNKNOWN',whaleConcentration:'UNKNOWN'}};
test('unverified risk cannot produce BUY candidate',()=>{const [p]=toPredictionCandidates([item],[{mint,pairAddress:'pair-test',decision:'BUY',score:85}]);assert.equal(p.decision,'WATCH');assert.equal(p.raw_decision,'BUY');assert.equal(p.risk_verified,false)});
test('verified risk retains BUY candidate',()=>{const [p]=toPredictionCandidates([{...item,risk:{rugCheck:'SAFE',whaleConcentration:'SAFE'}}],[{mint,pairAddress:'pair-test',decision:'BUY',score:85}]);assert.equal(p.decision,'BUY')});
test('mismatched identity and missing scores fail closed',()=>{assert.throws(()=>toPredictionCandidates([item],[]),/SCORE_COUNT_MISMATCH/);assert.throws(()=>toPredictionCandidates([item],[{mint:'other',pairAddress:'pair-test',decision:'BUY',score:85}]),/SCORE_IDENTITY_MISMATCH/)});
