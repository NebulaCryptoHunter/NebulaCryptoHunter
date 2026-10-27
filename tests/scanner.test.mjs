import test from 'node:test';
import assert from 'node:assert/strict';
import {scanPairs} from '../workers/nebula-scanner/worker.mjs';
const SOL='So11111111111111111111111111111111111111112';
const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pair={chainId:'solana',pairAddress:'pair-1',baseToken:{address:SOL,symbol:'SOL'},quoteToken:{address:USDC,symbol:'USDC'},liquidity:{usd:50000},volume:{h24:250000},priceChange:{h24:12},txns:{h24:{buys:60,sells:40}}};
test('filters non-Solana and low-liquidity pools',()=>{assert.equal(scanPairs([{...pair,chainId:'ethereum'},{...pair,liquidity:{usd:9999}}]).length,0)});
test('preserves UNKNOWN risk until independent verification',()=>{const [x]=scanPairs([pair]);assert.equal(x.risk.rugCheck,'UNKNOWN');assert.equal(x.risk.whaleConcentration,'UNKNOWN');assert.equal(x.momentum.transactionBuyRatio,0.6);assert.equal(x.momentum.volumeLiquidityRatio,5)});
test('does not fabricate missing volume or change',()=>{const [x]=scanPairs([{...pair,volume:{},priceChange:{}}]);assert.equal(x.volume24h,null);assert.equal(x.change24h,null)});
