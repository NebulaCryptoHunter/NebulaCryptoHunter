// Public D1 research cache, isolated from Admin/auth paths.
// Cloudflare Cache API is colo-local. This cache never stores credentials or writes.
// Refresh TTL is short; stale data is explicitly labelled, not mistaken for live data.
const MAX_STALE_MS=24*60*60*1000;
let quotaPauseUntil=0;
export const d1DailyLimitError=error=>/daily row read limit|exceeded d1.*free tier|D1.*row.?read.?limit|code.?\D?7500|D1_QUOTA_EXCEEDED|D1_DAILY_READ_LIMIT/i.test(String(error?.message||error||''));
export const resetUTC=now=>new Date(Math.ceil((now+1)/86400000)*86400000).toISOString();
const backoff=(error,now)=>{
 if(d1DailyLimitError(error))quotaPauseUntil=Math.max(quotaPauseUntil,Date.parse(resetUTC(now)));
};
function findCache(){
 try{return typeof caches!=='undefined'&&caches.default&&typeof caches.default.match==='function'&&typeof caches.default.put==='function'?caches.default:null}
 catch{return null}
}
function response(value,status,storedAt,warning){
 const body={...value,dataStatus:status,cacheAt:new Date(storedAt).toISOString()};
 if(warning)body.warning=warning;
 return Response.json(body,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-NEBULA-Data-Status':status}});
}
async function saved(cache,key){
 if(!cache)return null;
 try{
  const r=await cache.match(key);if(!r)return null;
  const timestamp=Date.parse(r.headers.get('X-NEBULA-Cache-Stored-At')||'');
  if(!Number.isFinite(timestamp)||Date.now()-timestamp>MAX_STALE_MS||timestamp>Date.now()+60000)return null;
  const payload=await r.json();
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return null;
  return {timestamp,payload};
 }catch{return null}
}
export async function cachedResearch(request,producer,{freshMs=180000}={}){
 const path=new URL(request.url);
 if(request.method!=='GET')throw Error('CACHE_READ_ONLY');
 const key=new Request(path.toString(),{method:'GET'});
 const store=findCache(),now=Date.now(),existing=await saved(store,key);
 const age=existing?now-existing.timestamp:Infinity;
 if(existing&&age<freshMs)return response(existing.payload,'CACHED',existing.timestamp);
 if(quotaPauseUntil>now){if(existing)return response(existing.payload,'STALE',existing.timestamp,'D1_DAILY_READ_LIMIT');throw Error('D1_DAILY_READ_LIMIT')}
  try{
   const payload=await producer();
   if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('INVALID_RESEARCH_PAYLOAD');
   const timestamp=Date.now();
   if(store)try{
    const writable=new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age=86400','X-NEBULA-Cache-Stored-At':new Date(timestamp).toISOString()}});
    await store.put(key,writable);
   }catch(e){console.warn('research_cache_write_unavailable',e?.name)}
   return response(payload,'LIVE',timestamp);
  }catch(e){
   backoff(e,Date.now());
   if(existing)return response(existing.payload,'STALE',existing.timestamp,d1DailyLimitError(e)?'D1_DAILY_READ_LIMIT':'RESEARCH_REFRESH_UNAVAILABLE');
   throw e;
  }
}
export async function invalidateResearchCache(url){
 const store=findCache();
 if(!store)return;
 const origin=new URL(url).origin;
 for(const path of ['/api/research/latest','/api/research/history?limit=10&offset=0']){
  try{await store.delete(new Request(origin+path,{method:'GET'}))}catch(e){console.warn('research_cache_invalidate_failed',e?.name)}
 }
}
export function quotaResponse(error){
 if(!d1DailyLimitError(error))return null;
 const deadline=resetUTC(Date.now()),seconds=Math.max(1,Math.ceil((Date.parse(deadline)-Date.now())/1000));
 return Response.json({success:false,error:'D1_DAILY_READ_LIMIT',message:'Cloudflare D1 daily free-tier row-read quota is exhausted. Showing only available cached research until the UTC reset.',resetAt:deadline},{status:503,headers:{'Cache-Control':'no-store','Retry-After':String(seconds),'X-NEBULA-Data-Status':'UNAVAILABLE'}});
}
