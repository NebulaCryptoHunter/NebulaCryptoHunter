import test from 'node:test';
import assert from 'node:assert/strict';
import {runScheduledScan} from '../workers/nebula-scanner/worker.mjs';

const A='So11111111111111111111111111111111111111112';
const B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const pair=mint=>({chainId:'solana',pairAddress:'pair-'+mint.slice(0,5),baseToken:{address:mint,symbol:'TEST'},quoteToken:{address:A,symbol:'SOL'},liquidity:{usd:60000},volume:{h24:210000},priceChange:{h24:11},txns:{h24:{buys:60,sells:40}}});
export function fakeDb(){
 const rows={runs:[],snapshots:[],scores:[],diagnostics:[],state:{},batchCalls:0};
 const db={
  prepare(sql){
   let args=[];
   const stmt={
    bind(...values){args=values;return stmt},
    async first(){
     if(sql.includes('scanner_state WHERE key=?'))return rows.state[args[0]]===undefined?null:{value:rows.state[args[0]]};
     return null;
    },
    async all(){
     if(sql.includes('scanner_snapshots GROUP BY'))return {results:[{mint:A},{mint:B}]};
     return {results:[]};
    },
    async run(){
     if(sql.includes('INSERT OR IGNORE INTO scanner_runs')){
      rows.runs.push({id:rows.runs.length+1,status:'RUNNING',key:args[0]});
      return {meta:{changes:1,last_row_id:rows.runs.length}};
     }
     if(sql.includes('UPDATE scanner_runs SET completed_at')){
      Object.assign(rows.runs[args[6]-1],{status:args[1],selected_count:args[2],snapshot_count:args[3],error:args[5]});
     }
     if(sql.includes('INSERT INTO scanner_state'))rows.state[args[0]]=args[1];
     if(sql.includes('scanner_diagnostics'))rows.diagnostics.push(args);
     if(sql.includes('scanner_snapshots('))rows.snapshots.push(args);
     if(sql.includes('engine_scores('))rows.scores.push(args);
     return {meta:{changes:1}};
    }
   };
   return stmt;
  },
  async batch(statements){rows.batchCalls++;const results=[];for(const stmt of statements)results.push(await stmt.run());return results;}
 };
 return {db,rows};
}
const engine={fetch:async (_url,init)=>{
 const body=JSON.parse(init.body);
 return Response.json({results:body.items.map(c=>({mint:c.base.mint,pairAddress:c.pairAddress,model:'heuristic-v1',decision:'WATCH',score:35}))});
}};
test('12-token-capable batch persists multiple Solana tokens using one pairs request',async()=>{
 const original=globalThis.fetch,{db,rows}=fakeDb();let profiles=0,batches=0;
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('token-profiles')){profiles++;return Response.json([{chainId:'solana',tokenAddress:A},{chainId:'solana',tokenAddress:B}]);}
  if(u.includes('/tokens/v1/solana/')){batches++;assert.match(u,/,/);return Response.json([pair(A),pair(B)]);}
  throw Error('unexpected '+u);
 };
 try{
  const env={STAGE_DB:db,INTERNAL_TOKEN:'secret',AI_ENGINE:engine};
  const first=await runScheduledScan({scheduledTime:1800000000000},env);
  assert.equal(first.status,'COMPLETED');assert.equal(first.snapshotCount,2);
  assert.equal(rows.snapshots.length,2);assert.equal(rows.scores.length,2);
  assert.equal(profiles,1);assert.equal(batches,1);
  const second=await runScheduledScan({scheduledTime:1800001800000},env);
  assert.equal(second.status,'COMPLETED');assert.equal(profiles,1,'discovery cached for six hours');assert.equal(batches,2);
 }finally{globalThis.fetch=original;}
});
test('429 discovery uses historical mints without repeated discovery requests',async()=>{
 const original=globalThis.fetch,{db,rows}=fakeDb();let profiles=0,batches=0;
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('token-profiles')){profiles++;return new Response('',{status:429});}
  if(u.includes('/tokens/v1/solana/')){batches++;return Response.json([pair(A)]);}
  throw Error('unexpected '+u);
 };
 try{
  const env={STAGE_DB:db,INTERNAL_TOKEN:'secret',AI_ENGINE:engine};
  const first=await runScheduledScan({scheduledTime:1800000000000},env);
  assert.equal(first.status,'COMPLETED');assert.equal(first.snapshotCount,1);
  assert.match(first.error,/Discovery HTTP 429/);
  await runScheduledScan({scheduledTime:1800001800000},env);
  assert.equal(profiles,1);assert.equal(batches,2);
  assert.equal(rows.state.discovery_backoff_level,'1');
 }finally{globalThis.fetch=original;}
});
test('Dex 429 pauses only Dex; Gecko keeps scanning and persisting',async()=>{
 const original=globalThis.fetch,{db,rows}=fakeDb();let dexCalls=0,geckoCalls=0;
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('token-profiles'))return Response.json([{chainId:'solana',tokenAddress:A}]);
  if(u.includes('/tokens/v1/solana/')){dexCalls++;return new Response('',{status:429});}
  if(u.includes('geckoterminal')){geckoCalls++;return Response.json({data:[{id:'solana_'+B,type:'pool',attributes:{address:B,base_token_price_usd:'1.25',reserve_in_usd:'60000',volume_usd:{h24:'250000'},transactions:{h24:{buys:12,sells:4}}},relationships:{base_token:{data:{id:'solana_'+A}},quote_token:{data:{id:'solana_'+B}}}}]});}
  throw Error('unexpected '+u);
 };
 try{
  const env={STAGE_DB:db,INTERNAL_TOKEN:'secret',AI_ENGINE:engine};
  const first=await runScheduledScan({scheduledTime:1800000000000},env);
  assert.equal(first.status,'COMPLETED');assert.equal(first.snapshotCount,1);
  assert.equal(JSON.parse(rows.snapshots[0][6]).source,'geckoterminal');
  assert.ok(Number(rows.state.cooldown_until)>Date.now());
  const second=await runScheduledScan({scheduledTime:1800001800000},env);
  assert.equal(second.status,'COMPLETED');assert.equal(dexCalls,1,'limited Dex is not retried');assert.ok(geckoCalls>=2,'independent Gecko still runs');
 }finally{globalThis.fetch=original;}
});
