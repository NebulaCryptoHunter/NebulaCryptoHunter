import assert from 'node:assert/strict';
import {scanPairs} from './nebula-scanner/src/index.mjs';
import {scoreCandidate} from './nebula-ai-engine/src/index.mjs';
const pairs=[{chainId:'solana',pairAddress:'POOL1',dexId:'raydium',
 baseToken:{address:'LAUNCH_MINT',symbol:'LAUNCH'},quoteToken:{address:'STONK_MINT',symbol:'STONK'},
 priceUsd:'0.002588',liquidity:{usd:172000},volume:{h24:6200000},
 priceChange:{h24:6199},txns:{h24:{buys:47260,sells:35552}}}];
const [c]=scanPairs(pairs);
assert.equal(c.base.mint,'LAUNCH_MINT');
assert.equal(c.quote.mint,'STONK_MINT');
assert.equal(c.change24h,6199);
assert.equal(c.risk.rugCheck,'UNKNOWN');
assert.equal(scoreCandidate(c).decision,'WATCH');
assert.equal(scoreCandidate({...c,liquidityUsd:null}).decision,'INSUFFICIENT_DATA');
assert.equal(scanPairs([{...pairs[0],chainId:'ethereum'}]).length,0);
console.log('Split scanner/engine tests passed');
