import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduledScan} from '../workers/nebula-scanner/worker.mjs';
const MINT='So11111111111111111111111111111111111111112';
const pair={chainId:'solana',pairAddress:'pair-test',baseToken:{address:MINT,symbol:'SOL'},quoteToken:{address:MINT,symbol:'SOL'},liquidity:{usd:50000},volume:{h24:250000},priceChange:{h24:12},txns:{h24:{buys:60,sells:40}}};
function fakeDb(){
 const rows={runs:[],snapshots:[],scores:[],candidates:[],diagnostics:[],state:{}};
 const db={prepare(sql){let args=[];const stmt={bind(...v){args=v;return stmt},async first(){if(sql.includes('scanner_state'))return sql.includes('discovery_cooldown_until')&&rows.state.cooldown_until?{value:rows.state.cooldown_until}:null;return null},async all(){if(sql.includes('scanner_snapshots GROUP BY'))return {results:[{mint:MINT}]};return {results:[]}},async run(){if(sql.includes('INSERT OR IGNORE INTO scanner_runs')){rows.runs.push({id:rows.runs.length+1});return {meta:{changes:1,last_row_id:rows.runs.length}}}if(sql.includes('UPDATE scanner_runs SET completed_at')){Object.assign(rows.runs[args[6]-1],{status:args[1],selected_count:args[2],snapshot_count:args[3],error:args[5]})}if(sql.includes('scanner_state'))rows.state.cooldown_until=args[0];if(sql.includes('scanner_diagnostics'))rows.diagnostics.push(args);if(sql.includes('scanner_snapshots ('))rows.snapshots.push(args);if(sql.includes('engine_scores ('))rows.scores.push(args);if(sql.includes('prediction_candidates ('))rows.candidates.push(args);return {meta:{changes:1}}}};return stmt},async batch(stmts){for(const stmt of stmts)await stmt.run()}};
 return {db,rows};
}
test('429 discovery falls back to tracked mint and persists scan and score',async()=>{
 const original=globalThis.fetch;const {db,rows}=fakeDb();let discoveryCalls=0,pairCalls=0;
 globalThis.fetch=async url=>{const u=String(url);if(u.includes('token-profiles')){discoveryCalls++;return new Response('',{status:429})}if(u.includes('token-pairs')){pairCalls++;return Response.json([pair])}throw Error('Unexpected fetch '+u)};
 const env={STAGE_DB:db,INTERNAL_TOKEN:'test-secret',AI_ENGINE:{fetch:async()=>Response.json({results:[{mint:MINT,pairAddress:'pair-test',model:'test',decision:'WATCH',score:35}]})}};
 try{await runScheduledScan({scheduledTime:1800000000000},env);assert.equal(rows.runs[0].status,'RATE_LIMITED');assert.equal(rows.runs[0].snapshot_count,1);assert.equal(rows.snapshots.length,1);assert.equal(rows.scores.length,1);assert.equal(rows.candidates.length,0,'candidates are created by the tested database trigger');assert.equal(discoveryCalls,1);assert.equal(pairCalls,1);
 await runScheduledScan({scheduledTime:1800001800000},env);assert.equal(discoveryCalls,1,'cooldown must skip discovery');assert.equal(rows.snapshots.length,2,'tracked mint still rescanned during cooldown');assert.equal(rows.scores.length,2);assert.equal(rows.candidates.length,0)}finally{globalThis.fetch=original}
});
