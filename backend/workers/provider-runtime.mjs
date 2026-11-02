// Shared free-provider transport. No automatic retry loops or database dependency.
const cache=()=>{try{return globalThis.caches?.default}catch{return null}};
const read=async key=>{try{return await cache()?.match(key)}catch{return null}};
const save=async(key,value,seconds)=>{try{await cache()?.put(key,Response.json(value,{headers:{'Cache-Control':'public, max-age='+Math.max(1,Math.ceil(seconds))}}))}catch{}};
// A context belongs to ONE invocation; promises and request state never cross Worker requests.
export function createProviderContext({maxRequests=12,deadlineMs=12000}={}){
 return {pending:new Map(),remaining:Math.max(0,Math.floor(maxRequests)),deadlineAt:Date.now()+Math.max(1,deadlineMs),attempts:0,cacheHits:0};
}
export function retryDeadline(value,now=Date.now()){
 const raw=typeof value==='string'?value.trim():'',seconds=raw&&/^\d+(\.\d+)?$/.test(raw)?Number(raw):NaN,date=raw?Date.parse(raw):NaN;
 const deadline=Number.isFinite(seconds)?now+seconds*1000:Number.isFinite(date)?date:now+60000;
 return Math.max(now+1000,Math.min(now+86400000,deadline));
}
export function upstreamTiming(headers,now=Date.now()){
 const rawAge=headers.get('Age'),date=Date.parse(headers.get('Date')||'');
 const age=rawAge!==null&&/^\d+(\.\d+)?$/.test(rawAge.trim())?Number(rawAge)*1000:null;
 const candidates=[...(Number.isFinite(date)?[date]:[]),...(age!==null&&Number.isFinite(age)?[now-age]:[])];
 const asOf=candidates.length?Math.min(...candidates):NaN;
 return {sourceAsOf:Number.isFinite(asOf)&&Math.abs(asOf)<=8640000000000000?new Date(asOf).toISOString():null,
  sourceTimeBasis:age!==null?'HTTP_CACHE_AGE':Number.isFinite(date)?'HTTP_RESPONSE_DATE':'FETCH_ONLY'};
}
export function providerScope(provider,url){
 const path=new URL(url).pathname;
 if(provider==='dexscreener'){
  if(/^\/(token-profiles|token-boosts|community-takeovers|ads|orders)\//.test(path))return 'discovery';
  if(path.startsWith('/tokens/v1/'))return 'market-batch';
  if(path.startsWith('/token-pairs/v1/'))return 'market-token';
  return 'market';
 }
 return 'shared';
}
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function providerJSON(provider,url,options={},settings={}){
 const {ttl=60,timeout=4000,context}=settings,now=Date.now(),parsed=new URL(url);
 const headers=Object.fromEntries([...new Headers(options.headers||{}).entries()].sort(([a],[b])=>a.localeCompare(b)));
 // Canonical header order/casing lets scanner, health checks and adapters reuse cached requests.
 const identity=await digest(stable([url,options.method||'GET',headers,options.body||'']));
 const credential=await digest(stable([parsed.host,headers,parsed.searchParams.get('api-key')||'']));
 const key='https://nebula.internal/free-provider-v2/'+provider+'/'+identity;
 if(context?.pending.has(key))return context.pending.get(key);
 const run=async()=>{
  const guard='https://nebula.internal/free-provider-v2/cooldown/'+provider+'/'+credential+'/'+providerScope(provider,url);
  const endpointGuard=guard+'/endpoint/'+identity;
  const hit=ttl>0?await read(key):null;
  if(hit){try{const value=await hit.json(),age=now-Date.parse(value.fetchedAt);if(value.ok&&Number.isFinite(age)&&age>=0&&age<ttl*1000){if(context)context.cacheHits++;return {...value,cached:true}}}catch{}}
  for(const guardKey of [guard,endpointGuard]){
   const paused=await read(guardKey);
   if(paused)try{const p=await paused.json();if(p.retryAt>now)return {ok:false,provider,status:p.status,error:p.error,retryAt:new Date(p.retryAt).toISOString(),fromCooldown:true}}catch{}
  }
  if(context&&(context.remaining<=0||Date.now()>=context.deadlineAt))return {ok:false,provider,status:0,error:'REQUEST_BUDGET_EXHAUSTED'};
  if(context){context.remaining--;context.attempts++}
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),Math.max(1,Math.min(timeout,context?context.deadlineAt-Date.now():timeout)));
  const pause=async(status,error,retryAfter=null)=>{
   // 429/auth are scoped to a documented provider family. Endpoint failures never disable a healthy sibling endpoint.
   const retryAt=retryDeadline(retryAfter,Date.now()),scope=[401,403,429].includes(status)?guard:endpointGuard;
   await save(scope,{status,error,retryAt},(retryAt-Date.now())/1000);
   return {ok:false,provider,status,error,retryAt:new Date(retryAt).toISOString()};
  };
  try{
   const r=await fetch(url,{...options,headers,redirect:'manual',signal:ctrl.signal});
   if(!r.ok){
    await r.body?.cancel();
    const status=r.status,error=status===429?'RATE_LIMIT':status===402?'FREE_PLAN_UNAVAILABLE':[401,403].includes(status)?'AUTH_ERROR':'HTTP_'+status;
    if([401,402,403,429].includes(status)||status>=500)return pause(status,error,r.headers.get('Retry-After'));
    return {ok:false,provider,status,error};
   }
   const reader=r.body?.getReader();let bytes=0;const chunks=[];
   if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024){await reader.cancel();throw Error('PAYLOAD_LIMIT')}chunks.push(part.value)}
   const dataBytes=new Uint8Array(bytes);let offset=0;for(const c of chunks){dataBytes.set(c,offset);offset+=c.length}
   const data=JSON.parse(new TextDecoder().decode(dataBytes));
   if(data?.error){const code=Number(data.error.code),status=[429,-32429,-32005].includes(code)?429:502;return pause(status,status===429?'RATE_LIMIT':'RPC_ERROR');}
   const value={ok:true,provider,status:r.status,data,fetchedAt:new Date(now).toISOString(),...upstreamTiming(r.headers,now)};
   if(ttl>0)await save(key,value,ttl);
   return value;
  }catch(e){
   const error=ctrl.signal.aborted?'TIMEOUT':e?.message==='PAYLOAD_LIMIT'?'PAYLOAD_LIMIT':'UNAVAILABLE';
   // A short endpoint-only negative cache prevents refresh storms without inventing successful data.
   return pause(0,error,'5');
  }finally{clearTimeout(timer)}
 };
 const pending=run();if(context)context.pending.set(key,pending);
 return pending;
}
export async function rpcFallback(body,env={},settings={}){
 const attempts=[],context=settings.context;
 const sources=[...(env.HELIUS_API_KEY?[['helius','https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(env.HELIUS_API_KEY)]]:[]),['solana_rpc','https://api.mainnet.solana.com'],...(env.ANKR_RPC_URL?[['ankr',env.ANKR_RPC_URL]]:[])];
 for(const [provider,url] of sources){
  const r=await providerJSON(provider,url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)},{ttl:settings.ttl??30,timeout:2500,context});
  attempts.push({provider,ok:r.ok,error:r.error||null});
  if(r.ok&&Object.hasOwn(r.data||{},'result'))return {...r,attempts};
  if(r.error==='REQUEST_BUDGET_EXHAUSTED')break;
 }
 return {ok:false,status:503,error:'RPC_SOURCES_UNAVAILABLE',attempts};
}
