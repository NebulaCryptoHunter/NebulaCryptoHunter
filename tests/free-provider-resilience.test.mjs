import test from 'node:test';
import assert from 'node:assert/strict';
import {providerJSON,rpcFallback,retryDeadline} from '../backend/workers/provider-runtime.mjs';
import {geckoPairs,marketPairs} from '../backend/workers/market-sources.mjs';
import {providerHealth} from '../backend/workers/provider-health.mjs';
import {tokenSource} from '../backend/workers/provider-routes.mjs';
import gateway from '../backend/workers/frontend-gateway.mjs';
import scanner from '../backend/workers/nebula-scanner.mjs';
const A='So11111111111111111111111111111111111111112',B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const dexPair={chainId:'solana',pairAddress:B,baseToken:{address:A,symbol:'SOL'},quoteToken:{address:B},priceUsd:'100',liquidity:{usd:50000}};
function memoryCache(){const entries=new Map();return {match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,value)=>{entries.set(typeof key==='string'?key:key.url,value.clone())}}}
async function withFetch(mock,fn){const old=globalThis.fetch;globalThis.fetch=mock;try{await fn()}finally{globalThis.fetch=old}}
test('429 Retry-After supports seconds and HTTP-date',()=>{const now=Date.now();assert.equal(retryDeadline('120',now),now+120000);assert.ok(retryDeadline(new Date(now+180000).toUTCString(),now)>now+170000)});
test('limited provider is skipped, cache is credential-safe, other providers continue',async()=>{
 const old=globalThis.caches,keys=[],mem=memoryCache();globalThis.caches={default:{...mem,put:async(key,value)=>{keys.push(key);await mem.put(key,value)}}};let firstCalls=0;
 try{await withFetch(async url=>String(url).includes('first')?(firstCalls++,new Response('',{status:429,headers:{'Retry-After':'120'}})):Response.json({value:2}),async()=>{
  assert.equal((await providerJSON('first','https://first.test/?api-key=secret')).error,'RATE_LIMIT');
  assert.equal((await providerJSON('first','https://first.test/other?api-key=secret')).error,'RATE_LIMIT');
  assert.equal(firstCalls,1);assert.equal((await providerJSON('second','https://second.test/')).ok,true);assert.ok(keys.every(k=>!k.includes('secret')));
 })}finally{globalThis.caches=old}
});
test('timeout of one source does not stop a healthy source',async()=>{
 await withFetch(async(url,options)=>String(url).includes('slow')?new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')))):Response.json({ok:true}),async()=>{
  assert.equal((await providerJSON('slow','https://slow.test',{}, {timeout:10})).error,'TIMEOUT');
  assert.equal((await providerJSON('fast','https://fast.test')).ok,true);
 });
});
test('HTTP 200 JSON-RPC rate errors fall back to public Solana without D1',async()=>{
 const calls=[];await withFetch(async url=>{calls.push(String(url));return String(url).includes('helius')?Response.json({error:{code:-32005,message:'limited'}}):Response.json({jsonrpc:'2.0',id:1,result:{value:123}})},async()=>{
  const r=await rpcFallback({jsonrpc:'2.0',id:1,method:'getBalance',params:[A]},{HELIUS_API_KEY:'key'});assert.equal(r.ok,true);assert.equal(r.provider,'solana_rpc');assert.equal(calls.length,2);
 });
});
test('Gecko does not substitute quote-token price or alter Solana mint case',()=>{
 const payload={data:[{id:'solana_'+B,type:'pool',attributes:{address:B,base_token_price_usd:'2',quote_token_price_usd:'100',reserve_in_usd:'20000'},relationships:{base_token:{data:{id:'solana_'+A}},quote_token:{data:{id:'solana_'+B}}}}]};
 const pairs=geckoPairs(payload,'2026-11-01T00:00:00.000Z');assert.equal(pairs[0].priceUsd,'2');assert.equal(pairs[0].baseToken.address,A);
 payload.data[0].relationships.base_token.data.id='ethereum_'+A;assert.deepEqual(geckoPairs(payload),[]);
});
test('CoinGecko rejects a differently cased Solana mint',async()=>{
 await withFetch(async()=>Response.json({[A.toLowerCase()]:{usd:50}}),async()=>assert.equal((await tokenSource('coingecko',A)).ok,false));
});
test('all twelve provider statuses survive an isolated 429, auth failure, 402 and missing key',async()=>{
 await withFetch(async url=>{
  const u=String(url);if(u.includes('pumpportal'))return new Response('',{status:403});
  if(u.includes('geckoterminal'))return new Response('',{status:429});
  if(u.includes('jup.ag'))return new Response('',{status:401});
  if(u.includes('coinpaprika'))return new Response('',{status:402});
  if(u.includes('dexscreener'))return Response.json([dexPair]);
  if(u.includes('coingecko'))return Response.json({solana:{usd:100}});
  if(u.includes('rugcheck'))return Response.json({token:{}});
  if(u.includes('pump.fun'))return Response.json([]);
  return Response.json({result:'ok'});
 },async()=>{const data=await (await providerHealth(new Request('https://test'),{},'resilience-test')).json();assert.equal(data.providers.length,12);assert.equal(data.providers.find(p=>p.name==='DexScreener').status,'HEALTHY');assert.equal(data.providers.find(p=>p.name==='GeckoTerminal').status,'RATE_LIMITED');assert.equal(data.providers.find(p=>p.name==='Ankr').status,'CONFIG_ERROR');assert.equal(data.providers.find(p=>p.name==='CoinPaprika').status,'FREE_PLAN_UNAVAILABLE')});
});
test('D1 quota exhausted: public feed still responds with real, unsaved observations',async()=>{
 const DB={prepare(){return {}},batch:async()=>{throw Error("Your account has exceeded D1's free tier daily row read limit")}};
 let called=false;
 const r=await gateway.fetch(new Request('https://test/api/research/latest'),{RESEARCH_DB:DB,API:{fetch:async()=>{called=true;return Response.json({items:[{mint:A,price_usd:100}],dataStatus:'LIVE_ONLY',persisted:false})}}});
 const body=await r.json();assert.equal(r.status,200);assert.equal(called,true);assert.equal(body.persisted,false);assert.equal(body.warning,'D1_DAILY_READ_LIMIT');assert.equal(body.counts,null);
});
test('D1 quota exhausted: scanner returns LIVE_ONLY and never claims persisted snapshots',async()=>{
 const STAGE_DB={prepare(){throw Error('D1_DAILY_READ_LIMIT')}};
 await withFetch(async url=>String(url).includes('token-profiles')?Response.json([{chainId:'solana',tokenAddress:A}]):String(url).includes('dexscreener')?Response.json([dexPair]):Response.json({data:[]}),async()=>{
  const r=await scanner.fetch(new Request('https://test/run',{method:'POST',headers:{Authorization:'Bearer private'}}),{INTERNAL_TOKEN:'private',STAGE_DB,AI_ENGINE:{}});
  const body=await r.json();assert.equal(r.status,200);assert.equal(body.status,'LIVE_ONLY');assert.equal(body.snapshotCount,0);assert.equal(body.items.length,1);assert.equal(body.persisted,false);
 });
});
test('pool API limits still permit Jupiter price feed without invented liquidity or scores',async()=>{
 const {marketFeed}=await import('../backend/workers/market-sources.mjs');
 await withFetch(async url=>{
  const u=String(url);if(u.includes('token-profiles'))return Response.json([{chainId:'solana',tokenAddress:A}]);
  if(u.includes('jup.ag'))return Response.json([{id:A,symbol:'SOL',usdPrice:100}]);
  return new Response('',{status:429});
 },async()=>{const data=await marketFeed();assert.equal(data.items.length,1);assert.equal(data.items[0].source,'jupiter');assert.equal(data.items[0].liquidity_usd,null);assert.equal(data.items[0].pair_address,null);assert.equal(data.items[0].score,null);assert.equal(data.persisted,false)});
});
test('paid-only endpoint 402 never disables a free endpoint at the same provider',async()=>{
 const old=globalThis.caches;globalThis.caches={default:memoryCache()};let blockedCalls=0;
 try{await withFetch(async url=>String(url).includes('/premium')?(blockedCalls++,new Response('',{status:402})):Response.json({price:100}),async()=>{
  assert.equal((await providerJSON('quotes','https://quotes.test/premium')).error,'FREE_PLAN_UNAVAILABLE');
  assert.equal((await providerJSON('quotes','https://quotes.test/free')).ok,true);
  assert.equal((await providerJSON('quotes','https://quotes.test/premium')).error,'FREE_PLAN_UNAVAILABLE');assert.equal(blockedCalls,1);
 })}finally{globalThis.caches=old}
});
