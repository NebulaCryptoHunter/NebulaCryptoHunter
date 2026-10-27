import {test} from 'node:test';
import assert from 'node:assert/strict';
import api from '../workers/nebula-api.mjs';
import engine,{scoreCandidate} from '../workers/nebula-ai-engine.mjs';
import scanner from '../workers/nebula-scanner.mjs';
const req=(path,body,token)=>new Request('https://test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
const noDB={prepare(){throw new Error('Unexpected DB access')}};
for(const path of ['/api/v1/predictions/bulk','/api/v1/evaluations/bulk']){
 test(path+' rejects anonymous writes before touching DB',async()=>{
  assert.equal((await api.fetch(req(path,{}),{DB:noDB,API_KEY:'test'},{})).status,401);
 });
 test(path+' limits authenticated batches',async()=>{
  const field=path.includes('predictions')?'predictions':'evaluations';
  assert.equal((await api.fetch(req(path,{[field]:Array(101).fill({})},'test'),{DB:noDB,API_KEY:'test'},{})).status,400);
 });
}
test('missing server credential fails closed',async()=>assert.equal((await api.fetch(req('/api/v1/predictions',{}),{DB:noDB},{})).status,401));
test('negative pagination cannot request all rows',async()=>{
 let args;const DB={prepare(){return {bind(...v){args=v;return this},async all(){return {results:[]}}}}};
 assert.equal((await api.fetch(new Request('https://test/api/v1/predictions?limit=-1&offset=-20'),{DB},{})).status,200);
 assert.deepEqual(args,[1,0]);
});
test('absent or risky whale verification cannot produce REVIEW',()=>{
 for(const whaleConcentration of [undefined,null,'UNKNOWN','HIGH','RISK']){
  const r=scoreCandidate({liquidityUsd:100000,volume24h:1e9,change24h:150,risk:{rugCheck:'SAFE',whaleConcentration}});
  assert.equal(r.decision,'WATCH');assert.equal(r.autoTrade,false);
 }
});
test('null score item returns validation error, not runtime crash',async()=>assert.equal((await engine.fetch(req('/score',{items:[null]},'test'),{INTERNAL_TOKEN:'test'})).status,400));
const mint='AhBidGAgv6QbKSWfrSCegGrzFLcBx4E5FNYTKHNQQj6C';
const pair={chainId:'solana',pairAddress:'pair',baseToken:{address:mint},quoteToken:{address:'So11111111111111111111111111111111111111112'},liquidity:{usd:100000},volume:{h24:1000},priceChange:{h24:1}};
test('scanner propagates upstream rate limit',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async()=>new Response('',{status:429});
 try{assert.equal((await scanner.fetch(new Request('https://test/pipeline?mint='+mint,{headers:{Authorization:'Bearer test'}}),{INTERNAL_TOKEN:'test',AI_ENGINE:{}})).status,429)}finally{globalThis.fetch=saved}
});
test('scanner validates every identity before any persistence',async()=>{
 const saved=globalThis.fetch;globalThis.fetch=async()=>Response.json([pair,{...pair,pairAddress:'pair2'}]);
 try{const r=await scanner.fetch(new Request('https://test/pipeline?mint='+mint+'&persist=1',{headers:{Authorization:'Bearer test'}}),{INTERNAL_TOKEN:'test',STAGE_DB:{prepare(sql){if(sql.includes('SELECT value FROM scanner_state'))return {first:async()=>null};throw Error('Unexpected DB write')}},AI_ENGINE:{fetch:async()=>Response.json({results:[{mint,pairAddress:'pair'}, {mint:'wrong',pairAddress:'pair2'}]})}});assert.equal(r.status,502);assert.equal((await r.json()).error,'IDENTITY_MISMATCH')}finally{globalThis.fetch=saved}
});
test('duplicate scheduled slot does not fetch or write again',async()=>{
 let pending;await scanner.scheduled({scheduledTime:1800000}, {STAGE_DB:{prepare(){return {bind(){return this},async run(){return {meta:{changes:0}}}}}}}, {waitUntil(p){pending=p}});await pending;
});
