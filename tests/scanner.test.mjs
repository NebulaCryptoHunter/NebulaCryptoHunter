import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {scanPairs} from '../workers/nebula-scanner/worker.mjs';
const SOL='So11111111111111111111111111111111111111112';
const USDC='So11111111111111111111111111111111111111112';
const pair={chainId:'solana',pairAddress:'pair-1',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{address:USDC,symbol:'USDC'},liquidity:{usd:50000},volume:{h24:250000},priceChange:{h24:12},txns:{h24:{buys:60,sells:40}}};
test('filters non-Solana and low-liquidity pools',()=>{assert.equal(scanPairs([{...pair,chainId:'ethereum'},{...pair,liquidity:{usd:9999}}]).length,0)});
test('preserves UNKNOWN risk until independent verification',()=>{const [x]=scanPairs([pair]);assert.equal(x.risk.rugCheck,'UNKNOWN');assert.equal(x.risk.whaleConcentration,'UNKNOWN');assert.equal(x.momentum.transactionBuyRatio,0.6);assert.equal(x.momentum.volumeLiquidityRatio,5)});
test('does not fabricate missing volume or change',()=>{const [x]=scanPairs([{...pair,volume:{},priceChange:{}}]);assert.equal(x.volume24h,null);assert.equal(x.change24h,null)});

test('scheduled scanner keeps tracked-token fallback when discovery is rate-limited',()=>{
 const fs=requireSource();
 assert.match(fs,/let profiles=\[\]/);
 assert.match(fs,/if\(Number\(state\?\.value\)>Date\.now\(\)\)\{status='RATE_LIMITED'/);
 assert.match(fs,/SELECT mint,MAX\(observed_at\) last_seen FROM scanner_snapshots/);
 assert.match(fs,/selected=\[\.\.\.new Set\(\[\.\.\.discovered\.slice\(0,3\),\.\.\.tracked\.map/);
});
function requireSource(){return readFileSync(new URL('../workers/nebula-scanner/worker.mjs',import.meta.url),'utf8')}
