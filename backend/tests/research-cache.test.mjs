import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cachedResearch,invalidateResearchCache,quotaResponse,d1DailyLimitError,resetUTC} from '../workers/research-cache.mjs';

function fakeCache(){
 const map=new Map();
 return {
  map,
  async match(key){return map.get(key.url)?.clone()},
  async put(key,value){map.set(key.url,value.clone())},
  async delete(key){return map.delete(key.url)}
 };
}
const origin='https://nebulacryptohunter.nebula-crypto-proxy.workers.dev';

test('public D1 cache serves repeat requests with no repeated query',async()=>{
 const old=globalThis.caches,cache=fakeCache();
 try{
  globalThis.caches={default:cache};
  let hits=0;
  const request=new Request(origin+'/api/research/latest');
  const produce=async()=>({counts:{total_records:7158},generatedAt:'2026-11-01T10:00:00.000Z',hits:++hits});
  const first=await cachedResearch(request,produce);
  assert.equal(first.headers.get('X-NEBULA-Data-Status'),'LIVE');
  assert.equal((await first.json()).hits,1);
  const second=await cachedResearch(request,produce);
  assert.equal(second.headers.get('X-NEBULA-Data-Status'),'CACHED');
  const body=await second.json();
  assert.equal(body.hits,1);
  assert.equal(body.counts.total_records,7158);
  assert.equal(hits,1);
  assert.equal(second.headers.get('Cache-Control'),'no-store');
  await invalidateResearchCache(origin);
  const third=await cachedResearch(request,produce);
  assert.equal(third.headers.get('X-NEBULA-Data-Status'),'LIVE');
  assert.equal((await third.json()).hits,2);
 }finally{if(old===undefined)delete globalThis.caches;else globalThis.caches=old}
});

test('stale D1 data is labelled and never claimed as live after quota error',async()=>{
 const old=globalThis.caches,cache=fakeCache();
 try{
  globalThis.caches={default:cache};
  const request=new Request(origin+'/api/research/history?limit=10&offset=0');
  const cachedAt=new Date(Date.now()-11*60*1000).toISOString();
  await cache.put(request,new Response(JSON.stringify({total:7158,items:[]}),{
   headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400','X-NEBULA-Cache-Stored-At':cachedAt}
  }));
  let failures=0;
  const result=await cachedResearch(request,async()=>{failures++;throw Error("Your account has exceeded D1's free tier daily row read limit.")},{freshMs:1000});
  assert.equal(result.status,200);
  assert.equal(result.headers.get('X-NEBULA-Data-Status'),'STALE');
  const body=await result.json();
  assert.equal(body.dataStatus,'STALE');
  assert.equal(body.total,7158);
  assert.equal(body.warning,'D1_DAILY_READ_LIMIT');
  assert.equal(failures,1);
  const another=await cachedResearch(request,async()=>{failures++;throw Error('should not query exhausted D1')},{freshMs:1000});
  assert.equal((await another.json()).dataStatus,'STALE');
  assert.equal(failures,1);
 }finally{if(old===undefined)delete globalThis.caches;else globalThis.caches=old}
});

test('D1 exhaustion without cached payload produces honest 503 and UTC reset',()=>{
 const error=Error("Your account has exceeded D1's free tier daily row read limit. Upgrade or wait.");
 assert.equal(d1DailyLimitError(error),true);
 assert.equal(d1DailyLimitError(Error('DexScreener HTTP 429')),false);
 const r=quotaResponse(error);
 assert.equal(r.status,503);
 assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.ok(Number(r.headers.get('Retry-After'))>0);
 const date=resetUTC(Date.now());
 assert.ok(date.endsWith('T00:00:00.000Z'));
 assert.equal(quotaResponse(Error('OTHER_ISSUE')),null);
});

test('concurrent cache requests share one D1 producer per isolate',async()=>{
 const old=globalThis.caches,cache=fakeCache();
 try{
  globalThis.caches={default:cache};
  const request=new Request(origin+'/api/research/latest?test-coalesce=1');
  let queries=0;
  const producer=async()=>{queries++;await new Promise(resolve=>setTimeout(resolve,10));return {counts:{total_records:7}}};
  const responses=await Promise.all(Array.from({length:7},()=>cachedResearch(request,producer)));
  assert.equal(queries,1);
  assert.ok(responses.every(x=>x.ok));
 }finally{if(old===undefined)delete globalThis.caches;else globalThis.caches=old}
});

test('D1 limit marker produces an explicit retry response, not a fabricated success',async()=>{
 assert.equal(d1DailyLimitError(Error('D1_DAILY_READ_LIMIT')),true);
 const response=quotaResponse(Error('D1_DAILY_READ_LIMIT'));
 assert.equal(response.status,503);
 assert.equal((await response.json()).error,'D1_DAILY_READ_LIMIT');
});
