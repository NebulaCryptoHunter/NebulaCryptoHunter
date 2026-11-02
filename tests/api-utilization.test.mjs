import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {providerJSON,createProviderContext,retryDeadline} from '../backend/workers/provider-runtime.mjs';
import {freeQuotes,marketFeed,marketPairs,discoverMints,scannerMarket} from '../backend/workers/market-sources.mjs';
import {providerRoute,tokenSource} from '../backend/workers/provider-routes.mjs';
import {tokenEvidence,mintAccountBatch} from '../backend/workers/token-evidence.mjs';
import {runScheduledScan,liveOnlyScan} from '../backend/workers/nebula-scanner.mjs';
import {getTokenPrice} from '../backend/workers/nebula-evaluation.mjs';
import engine from '../backend/workers/nebula-ai-engine.mjs';
import api from '../backend/workers/nebula-api.mjs';
const A='So11111111111111111111111111111111111111112',B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',C='11111111111111111111111111111111';
const pair=(mint=A)=>({chainId:'solana',pairAddress:B,baseToken:{address:mint,symbol:'TEST'},quoteToken:{address:C},priceUsd:'1',liquidity:{usd:500000},volume:{h24:2500000,h1:150000,m5:20000},priceChange:{h24:24,h1:8,m5:2},txns:{h24:{buys:700,sells:300},h1:{buys:80,sells:20},m5:{buys:24,sells:6}},_observedAt:new Date().toISOString()});
function memCache(){const rows=new Map();return {match:async k=>rows.get(typeof k==='string'?k:k.url)?.clone(),put:async(k,v)=>{rows.set(typeof k==='string'?k:k.url,v.clone());}};}
async function mocked(fetcher,fn,{cache=false}={}){const f=globalThis.fetch,c=globalThis.caches;globalThis.fetch=fetcher;if(cache)globalThis.caches={default:memCache()};try{return await fn();}finally{globalThis.fetch=f;globalThis.caches=c;}}
function realDb(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync('backend/migrations/0008_unified_scanner_schema.sql','utf8'));
 const db={prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return sqlite.prepare(sql).get(...values);},async all(){return {results:sqlite.prepare(sql).all(...values)};},async run(){const r=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {sqlite,db};
}
test('identical requests share one in-flight call inside an invocation',async()=>{
 let calls=0;await mocked(async()=>{calls++;return Response.json({price:1});},async()=>{
  const context=createProviderContext();const rows=await Promise.all(Array.from({length:8},()=>providerJSON('same','https://same.test/quote',{}, {context})));
  assert.equal(calls,1);assert.equal(context.attempts,1);assert.ok(rows.every(x=>x.ok));
 });
});
test('header casing and order do not duplicate credential-scoped cache entries',async()=>{
 let calls=0;await mocked(async()=>{calls++;return Response.json({price:1});},async()=>{
  await providerJSON('same','https://same.test/quote',{headers:{'X-API-Key':'secret',Accept:'application/json'}});
  const r=await providerJSON('same','https://same.test/quote',{headers:new Headers({accept:'application/json','x-api-key':'secret'})});
  assert.equal(calls,1);assert.equal(r.cached,true);
 },{cache:true});
});
test('upstream budget stops extra calls while existing cache hits remain usable',async()=>{
 let calls=0;await mocked(async()=>{calls++;return Response.json({price:1});},async()=>{
  const context=createProviderContext({maxRequests:1});assert.equal((await providerJSON('budget','https://budget.test/one',{}, {context})).ok,true);
  assert.equal((await providerJSON('budget','https://budget.test/two',{}, {context})).error,'REQUEST_BUDGET_EXHAUSTED');
  assert.equal((await providerJSON('budget','https://budget.test/one',{}, {context:createProviderContext({maxRequests:0})})).cached,true);assert.equal(calls,1);
 },{cache:true});
});
test('an expired request deadline never starts another upstream call',async()=>{
 let calls=0;await mocked(async()=>{calls++;return Response.json({});},async()=>{
  const context=createProviderContext();context.deadlineAt=Date.now()-1;
  assert.equal((await providerJSON('deadline','https://deadline.test',{}, {context})).error,'REQUEST_BUDGET_EXHAUSTED');assert.equal(calls,0);
 });
});
test('Dex discovery throttling does not poison its separately documented market family',async()=>{
 let calls=0;await mocked(async url=>{calls++;return String(url).includes('profiles')?new Response('',{status:429,headers:{'Retry-After':'120'}}):Response.json([pair()]);},async()=>{
  assert.equal((await providerJSON('dexscreener','https://api.dexscreener.com/token-profiles/latest/v1')).error,'RATE_LIMIT');
  assert.equal((await providerJSON('dexscreener','https://api.dexscreener.com/tokens/v1/solana/'+A)).ok,true);assert.equal(calls,2);
 },{cache:true});
});
test('a single failed endpoint does not disable a healthy sibling endpoint',async()=>{
 await mocked(async url=>String(url).includes('/broken')?new Response('',{status:503}):Response.json({value:1}),async()=>{
  assert.equal((await providerJSON('same','https://same.test/broken')).error,'HTTP_503');
  assert.equal((await providerJSON('same','https://same.test/healthy')).ok,true);
 },{cache:true});
});
test('short Retry-After values are honored rather than becoming a compulsory one-minute pause',()=>{
 const now=Date.now();assert.equal(retryDeadline('3',now),now+3000);assert.equal(retryDeadline(null,now),now+60000);
});
test('partial Jupiter results are filled by CoinGecko and then by the configured Birdeye key',async()=>{
 const calls=[];await mocked(async(url,options)=>{
  calls.push(String(url));if(String(url).includes('jup.ag'))return Response.json([{id:A,usdPrice:1}]);
  if(String(url).includes('coingecko'))return Response.json({[B]:{usd:2}});
  if(String(url).includes('birdeye')){assert.equal(options.headers['x-api-key'],'bird-secret');return Response.json({success:true,data:{value:3}});}
  throw Error('Unexpected request');
 },async()=>{
  const r=await freeQuotes([A,B,C],{BIRDEYE_API_KEY:'bird-secret'});
  assert.equal(r.items.length,3);assert.deepEqual(new Set(r.items.map(x=>x.source)),new Set(['jupiter','coingecko','birdeye']));
  assert.ok(r.items.every(x=>x.score===null&&x.pair_address===null&&x.liquidity_usd===null));assert.equal(calls.length,3);
 });
});
test('price-only fallbacks reject boolean prices and mismatched Solana mint case',async()=>{
 await mocked(async url=>String(url).includes('jup.ag')?Response.json([{id:A,usdPrice:true}]):Response.json({[A.toLowerCase()]:{usd:5}}),async()=>{
  assert.equal((await freeQuotes([A])).items.length,0);
  assert.equal((await tokenSource('jupiter',A)).ok,false);
 });
});
test('a pool for one token never suppresses price fallback for another token',async()=>{
 await mocked(async url=>{
  const u=String(url);if(u.includes('tokens/v1'))return Response.json([pair(A)]);
  if(u.includes('jup.ag'))return Response.json([{id:A,usdPrice:1,holderCount:30},{id:B,usdPrice:2,holderCount:40,liquidity:500000}]);
  if(u.includes('geckoterminal'))return Response.json({data:[]});
  if(u.includes('rugcheck'))return Response.json({mint:A,score:0,risks:[]});return Response.json({});
 },async()=>{
  const r=await marketFeed({}, {mints:[A,B],includeObservations:true});
  assert.equal(r.items.length,2);assert.equal(r.observations.length,1);
  const quote=r.items.find(x=>x.mint===B);assert.equal(quote.source,'jupiter');assert.equal(quote.score,null);assert.equal(quote.liquidity_usd,null);
  assert.equal(quote.tokenMetadata.liquidityUsd,500000);assert.equal(quote.tokenMetadata.scope,'TOKEN_AGGREGATE');
  assert.equal(r.observations[0].risk.rugCheck,'UNKNOWN');assert.equal(r.items.find(x=>x.mint===A).decision,'WATCH');
 });
});
test('dust-pool responses do not prevent trying an independent pool source',async()=>{
 let gecko=0;await mocked(async url=>String(url).includes('dexscreener')?Response.json([{...pair(),liquidity:{usd:.1}}]):(gecko++,Response.json({data:[]})),async()=>{
  await marketPairs([A]);assert.equal(gecko,1);
 });
});
test('the scanner bridge preserves multiple genuine pools while the public feed shows one token',async()=>{
 await mocked(async url=>{
  const u=String(url);if(u.includes('/tokens/v1/'))return Response.json([pair(),{...pair(),pairAddress:C,liquidity:{usd:200000}}]);
  if(u.includes('jup.ag'))return Response.json([{id:A,usdPrice:1}]);return Response.json({});
 },async()=>{
  const r=await marketFeed({}, {mints:[A],includeObservations:true});assert.equal(r.items.length,1);assert.equal(r.observations.length,2);
  assert.equal(r.items[0].pair_address,B);assert.deepEqual(new Set(r.observations.map(x=>x.pairAddress)),new Set([B,C]));
 });
});
test('limited Dex batch is not retried while a bounded documented token-pairs fallback may succeed',async()=>{
 let batches=0,singles=0;await mocked(async url=>{
  if(String(url).includes('/tokens/v1/')){batches++;return new Response('',{status:429,headers:{'Retry-After':'120'}});}
  if(String(url).includes('/token-pairs/v1/')){singles++;return Response.json([pair()]);}
  throw Error('Unexpected source');
 },async()=>{
  const context=createProviderContext(),r=await marketPairs([A],{context});assert.equal(r.pairs.length,1);assert.equal(batches,1);assert.equal(singles,1);
  await marketPairs([A],{context});assert.equal(batches,1);assert.equal(singles,1);
 },{cache:true});
});
test('a rate-limited token-pairs fallback stops immediately instead of looping across the token list',async()=>{
 let singles=0;await mocked(async url=>{if(String(url).includes('/token-pairs/'))singles++;return new Response('',{status:429});},async()=>{
  await marketPairs([A,B,C]);assert.equal(singles,1);
 });
});
test('discovery merges independent mint identities and reuses discovered pools',async()=>{
 let dexBatches=0;await mocked(async url=>{
  const u=String(url);if(u.includes('profiles'))return Response.json([{chainId:'solana',tokenAddress:A}]);
  if(u.includes('geckoterminal'))return Response.json({data:[{type:'pool',id:'solana_'+B,attributes:{address:B,base_token_price_usd:'1',reserve_in_usd:'500000',volume_usd:{h24:'1000'},price_change_percentage:{h24:'1'}},relationships:{base_token:{data:{id:'solana_'+A}},quote_token:{data:{id:'solana_'+C}}}}]});
  dexBatches++;return Response.json([]);
 },async()=>{
  const context=createProviderContext(),discovery=await discoverMints({context});
  const r=await marketPairs(discovery.mints,{seedPairs:discovery.pairs,context});assert.equal(r.pairs.length,1);assert.equal(dexBatches,0);
 });
});
test('market-feed query rejects invalid or oversized batches before any provider call',async()=>{
 let calls=0;await mocked(async()=>{calls++;return Response.json({});},async()=>{
  for(const mints of ['bad',Array(13).fill(A).join(','),''])assert.equal((await providerRoute('/api/v1/market-feed',{},new Request('https://api/api/v1/market-feed?mints='+mints))).status,400);
  assert.equal(calls,0);
 });
});
test('scanner uses the central service binding and does not require copied API credentials',async()=>{
 let remote=0,external=0;await mocked(async()=>{external++;return Response.json([]);},async()=>{
  const {scanPairs}=await import('../backend/workers/market-observation.mjs');const observations=scanPairs([pair()]);
  const MARKET_API={fetch:async url=>{remote++;assert.match(String(url),/mints=/);return Response.json({observations,items:[],providerAttempts:[]});}};
  const r=await scannerMarket([A],{MARKET_API});assert.equal(r.bridge,true);assert.equal(r.observations[0].base.mint,A);assert.equal(remote,1);assert.equal(external,0);
 });
});
test('a malformed bridge response falls back independently instead of persisting the wrong mint',async()=>{
 let external=0;await mocked(async()=>{external++;return Response.json([pair()]);},async()=>{
  const r=await scannerMarket([A],{MARKET_API:{fetch:async()=>Response.json({observations:[{chain:'solana',base:{mint:B}}]})}});
  assert.ok(r.pairs.length>0);assert.equal(r.observations,undefined);assert.ok(external>0);
 });
});
test('D1 quota fallback can use central provider credentials without claiming persistence',async()=>{
 const r=await liveOnlyScan({MARKET_API:{fetch:async()=>Response.json({items:[{mint:A,price_usd:1,score:null}],providerAttempts:[]})}});
 assert.equal(r.status,'LIVE_ONLY');assert.equal(r.persisted,false);assert.equal(r.snapshotCount,0);assert.equal(r.items.length,1);
});
test('evaluation obtains and coalesces real quotes from the shared API service',async()=>{
 let calls=0;const budget={remaining:1,pending:new Map(),marketAPI:{fetch:async()=>{calls++;return Response.json({success:true,data:{token_ca:A,price_usd:2,provider:'birdeye',checked_at:new Date().toISOString()}});}}};
 const [a,b]=await Promise.all([getTokenPrice(A,budget),getTokenPrice(A,budget)]);assert.equal(a.price,2);assert.equal(b.source,'birdeye');assert.equal(calls,1);assert.equal(await getTokenPrice(B,budget),null);
});
test('Rugcheck and mint-account responses are evidence, never fabricated SAFE flags',async()=>{
 await mocked(async url=>String(url).includes('rugcheck')?Response.json({mint:A,score:0,risks:[]}):Response.json({result:{value:{data:{parsed:{type:'mint',info:{supply:'10000',decimals:6,mintAuthority:null,freezeAuthority:null}}}}}}),async()=>{
  const r=await tokenEvidence(A,{HELIUS_API_KEY:'key'},createProviderContext());assert.equal(r.evidence.rugcheck.status,'EVIDENCE_ONLY');assert.equal(r.evidence.mintAccount.mintAuthorityDisabled,true);assert.equal(r.evidence.rugcheck.rugCheck,undefined);
 });
});
test('one RPC batch preserves account-to-mint order and validates missing accounts',async()=>{
 let calls=0;await mocked(async(url,options)=>{
  calls++;const body=JSON.parse(options.body);assert.equal(body.method,'getMultipleAccounts');assert.equal(body.params[0].length,3);
  return Response.json({result:{value:body.params[0].map((mint,i)=>i===1?null:{data:{parsed:{type:'mint',info:{supply:mint,decimals:6,mintAuthority:null,freezeAuthority:null}}}})}});
 },async()=>{
  const r=await mintAccountBatch([B,A,C],{HELIUS_API_KEY:'key'},createProviderContext());assert.equal(calls,1);assert.equal(r.evidence.size,2);
  for(const [mint,row] of r.evidence)assert.equal(row.supply,mint);
 });
});
test('actual scanner -> API binding -> upstreams -> AI -> SQLite persists one genuine pool',async()=>{
 const {sqlite,db}=realDb();
 await mocked(async url=>{
  const u=String(url);if(u.includes('profiles'))return Response.json([{chainId:'solana',tokenAddress:A}]);
  if(u.includes('geckoterminal'))return Response.json({data:[]});if(u.includes('tokens/v1'))return Response.json([pair()]);
  if(u.includes('jup.ag'))return Response.json([{id:A,usdPrice:1,holderCount:30}]);if(u.includes('rugcheck'))return Response.json({mint:A,score:0,risks:[]});return Response.json({});
 },async()=>{
  try{
   const env={STAGE_DB:db,INTERNAL_TOKEN:'test',AI_ENGINE:{fetch:(url,init)=>engine.fetch(new Request(url,init),{INTERNAL_TOKEN:'test'})},MARKET_API:{fetch:(url,init)=>api.fetch(new Request(url,init),{}, {})}};
   const result=await runScheduledScan({scheduledTime:Date.now()},env);assert.equal(result.status,'COMPLETED');assert.equal(result.snapshotCount,1);
   const saved=JSON.parse(sqlite.prepare('SELECT payload_json FROM scanner_snapshots').get().payload_json);assert.equal(saved.tokenMetadata.holderCount,30);assert.equal(saved.risk.rugCheck,'UNKNOWN');
   assert.equal(sqlite.prepare('SELECT model FROM engine_scores').get().model,'heuristic-v3.0.0');
  }finally{sqlite.close();}
 });
});
test('scanner rate backoff follows server retry time instead of an hour-long minimum',async()=>{
 const {sqlite,db}=realDb();
 await mocked(async url=>String(url).includes('profiles')?Response.json([{chainId:'solana',tokenAddress:A}]):new Response('',{status:429,headers:{'Retry-After':'120'}}),async()=>{
  try{
   const result=await runScheduledScan({scheduledTime:Date.now()},{STAGE_DB:db,INTERNAL_TOKEN:'test',AI_ENGINE:{}});assert.equal(result.status,'RATE_LIMITED');
   const until=Number(sqlite.prepare("SELECT value FROM scanner_state WHERE key='cooldown_until'").get().value)-Date.now();assert.ok(until>110000&&until<130000,'Expected about two minutes, got '+until);
  }finally{sqlite.close();}
 });
});
