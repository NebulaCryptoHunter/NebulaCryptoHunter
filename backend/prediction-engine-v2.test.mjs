import assert from 'node:assert/strict';
import { evaluatePrediction } from './prediction-engine-v2.mjs';
const ca='So11111111111111111111111111111111111111112';
const v={token_ca:ca,entry_price:0.01,liquidity_usd:50000,holder_count:200,rug_status:'SAFE',mint_authority_enabled:false,freeze_authority_enabled:false,dex_verified:true,helius_verified:true,rug_verified:true,quality_score:80,security_score:85,confidence_score:80,ai_score:94};
assert.equal(evaluatePrediction(v).decision,'STRONG_BUY');
assert.equal(evaluatePrediction({...v,ai_score:82}).decision,'BUY');
assert.equal(evaluatePrediction({...v,ai_score:70}).decision,'WATCH');
for(const patch of [{token_ca:'0'+ca.slice(1)},{entry_price:0},{holder_count:null},{rug_status:'UNKNOWN'},{dex_verified:false},{mint_authority_enabled:true},{mint_authority_enabled:undefined},{freeze_authority_enabled:undefined},{liquidity_usd:0},{security_score:40}]){const x=evaluatePrediction({...v,...patch});assert.equal(x.passed_gate,false);assert.equal(x.decision,'WATCH');}
assert.equal(evaluatePrediction(v).probability_of_profit,null);
console.log('V2 policy tests passed');
