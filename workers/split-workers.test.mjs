import assert from 'node:assert/strict';
import {scanPairs} from './nebula-scanner/src/index.mjs';
import {scoreCandidate} from './nebula-ai-engine/src/index.mjs';
const pairs=[{chainId:'solana',pairAddress:'POOL1',dexId:'raydium',
 baseToken:{address:'AhBidGAgv6QbKSWfrSCegGrzFLcBx4E5FNYTKHNQQj6C',symbol:'LAUNCH'},quoteToken:{address:'6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx',symbol:'STONK'},
 priceUsd:'0.002588',liquidity:{usd:172000},volume:{h24:6200000},
 priceChange:{h24:6199},txns:{h24:{buys:47260,sells:35552}}}];
const [c]=scanPairs(pairs);
assert.equal(c.base.mint,'AhBidGAgv6QbKSWfrSCegGrzFLcBx4E5FNYTKHNQQj6C');
assert.equal(c.quote.mint,'6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx');
assert.equal(c.change24h,6199);
assert.equal(c.risk.rugCheck,'UNKNOWN');
assert.equal(scoreCandidate(c).decision,'WATCH');
assert.equal(scoreCandidate({...c,liquidityUsd:null}).decision,'INSUFFICIENT_DATA');
assert.equal(scanPairs([{...pairs[0],chainId:'ethereum'}]).length,0);
assert.equal(scanPairs([{...pairs[0],baseToken:{address:'FAKE',symbol:'LAUNCH'}}]).length,0);
assert.equal(scoreCandidate(c).confidence,null);
console.log('Split scanner/engine tests passed');
