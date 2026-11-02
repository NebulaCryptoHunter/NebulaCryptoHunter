// Free-mode transport. No retries, no paid endpoints, no D1 dependency.
// Cache is best-effort and colo-local; provider quotas remain authoritative.
const cache=()=>{try{return globalThis.caches?.default}catch{return null}};
const read=async key=>{try{return await cache()?.match(key)}catch{return null}};
const save=async(key,value,seconds)=>{try{await cache()?.put(key,Response.json(value,{headers:{'Cache-Control':'public, max-age='+seconds}}))}catch{}};
export function retryDeadline(value,now=Date.now()){
 const seconds=Number(value),date=Date.parse(value||'');
 return Math.max(now+60000,Math.min(now+86400000,Number.isFinite(seconds)&&seconds>0?now+seconds*1000:Number.isFinite(date)?date:now+60000));
}
// HTTP cache timing is a conservative transport bound, not an on-chain trade timestamp.
export function upstreamTiming(headers,now=Date.now()){
 const rawAge=headers.get('Age'),date=Date.parse(headers.get('Date')||'');
 const age=rawAge!==null&&/^\d+(\.\d+)?$/.test(rawAge.trim())?Number(rawAge)*1000:null;
 const candidates=[...(Number.isFinite(date)?[date]:[]),...(age!==null&&Number.isFinite(age)?[now-age]:[])];
 const asOf=candidates.length?Math.min(...candidates):NaN;
 return {sourceAsOf:Number.isFinite(asOf)&&Math.abs(asOf)<=8640000000000000?new Date(asOf).toISOString():null,
  sourceTimeBasis:age!==null?'HTTP_CACHE_AGE':Number.isFinite(date)?'HTTP_RESPONSE_DATE':'FETCH_ONLY'};
}
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function providerJSON(provider,url,options={},settings={}){
 const {ttl=60,timeout=4000}=settings,now=Date.now();
 // Hash complete request identity; credentials never appear in cache keys or errors.
 const identity=await digest(JSON.stringify([url,options.method||'GET',options.headers||{},options.body||'']));
 const credential=await digest(JSON.stringify([new URL(url).host,options.headers||{},new URL(url).searchParams.get('api-key')||'']));
 const key='https://nebula.internal/free-provider-v1/'+provider+'/'+identity;
 const guard='https://nebula.internal/free-provider-v1/cooldown/'+provider+'/'+credential;
 const hit=ttl>0?await read(key):null;
 if(hit){try{const value=await hit.json(),age=now-Date.parse(value.fetchedAt);if(value.ok&&Number.isFinite(age)&&age>=0&&age<ttl*1000)return {...value,cached:true}}catch{}}
 const endpointGuard=guard+'/endpoint/'+identity;
 for(const guardKey of [guard,endpointGuard]){const paused=await read(guardKey);if(paused){try{const p=await paused.json();if(p.retryAt>now&&(p.status!==402||guardKey===endpointGuard))return {ok:false,provider,status:p.status,error:p.error,retryAt:new Date(p.retryAt).toISOString()}}catch{}}}
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
 try{
  const r=await fetch(url,{...options,redirect:'manual',signal:ctrl.signal});
  if(!r.ok){
   await r.body?.cancel();
   const status=r.status,error=status===429?'RATE_LIMIT':status===402?'FREE_PLAN_UNAVAILABLE':[401,403].includes(status)?'AUTH_ERROR':'HTTP_'+status;
   if([401,402,403,429].includes(status)||status>=500){const retryAt=retryDeadline(r.headers.get('Retry-After'),now);await save(status===402?endpointGuard:guard,{status,error,retryAt},Math.ceil((retryAt-now)/1000));return {ok:false,provider,status,error,retryAt:new Date(retryAt).toISOString()}}
   return {ok:false,provider,status,error};
  }
  // Bound upstream bodies; timeout includes reading/parsing the body.
  const reader=r.body?.getReader();let bytes=0;const chunks=[];
  if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw Error('PAYLOAD_LIMIT')}chunks.push(part.value)}
  const dataBytes=new Uint8Array(bytes);let offset=0;for(const c of chunks){dataBytes.set(c,offset);offset+=c.length}
  const data=JSON.parse(new TextDecoder().decode(dataBytes));
  if(data?.error){const code=Number(data.error.code),status=[429,-32429,-32005].includes(code)?429:502,error=status===429?'RATE_LIMIT':'RPC_ERROR';const retryAt=retryDeadline(null,now);await save(guard,{status,error,retryAt},60);return {ok:false,provider,status,error,retryAt:new Date(retryAt).toISOString()}}
  const value={ok:true,provider,status:r.status,data,fetchedAt:new Date(now).toISOString(),...upstreamTiming(r.headers,now)};
  if(ttl>0)await save(key,value,ttl);
  return value;
 }catch(e){return {ok:false,provider,status:0,error:ctrl.signal.aborted?'TIMEOUT':e?.message==='PAYLOAD_LIMIT'?'PAYLOAD_LIMIT':'UNAVAILABLE'}}
 finally{clearTimeout(timer)}
}
export async function rpcFallback(body,env={}){
 const attempts=[];
 const sources=[...(env.HELIUS_API_KEY?[['helius','https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(env.HELIUS_API_KEY)]]:[]),['solana_rpc','https://api.mainnet.solana.com'],...(env.ANKR_RPC_URL?[['ankr',env.ANKR_RPC_URL]]:[])];
 for(const [provider,url] of sources){const r=await providerJSON(provider,url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{ttl:30,timeout:2500});attempts.push({provider,ok:r.ok,error:r.error||null});if(r.ok&&Object.hasOwn(r.data||{},'result'))return {...r,attempts}}
 return {ok:false,status:503,error:'RPC_SOURCES_UNAVAILABLE',attempts};
}
