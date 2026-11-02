import {selectScanMints} from './scanner-selection.mjs';
import {marketPairs,discoverMints,marketFeed,scannerMarket} from './market-sources.mjs';
import {retryDeadline,createProviderContext} from './provider-runtime.mjs';
import {d1DailyLimitError,resetUTC} from './research-cache.mjs';
// NEBULA scanner: deterministic token identity and pool-specific discovery.
// Research-only: staging D1 snapshots and scores; no trading.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const mintOk=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
import {scanPairs} from './market-observation.mjs';
export {scanPairs} from './market-observation.mjs';
async function diagnostic(env,stage,status,detail){try{await env.STAGE_DB.prepare("INSERT INTO scanner_diagnostics (observed_at,stage,status,detail) VALUES (?,?,?,?)").bind(new Date().toISOString(),stage,status,String(detail).slice(0,300)).run()}catch(e){console.error("diagnostic_write_failed",String(e))}}

const BATCH_MAX_MINTS=12;
const DISCOVERY_INTERVAL_MS=30*60*1000;
const BACKOFF_BASE_MS=60*1000;
const MAX_BACKOFF_MS=15*60*1000;
async function getState(env,key){
 const r=await env.STAGE_DB.prepare("SELECT value FROM scanner_state WHERE key=?").bind(key).first();
 return r?.value??null;
}
async function putState(env,key,value){
 await env.STAGE_DB.prepare("INSERT INTO scanner_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,String(value)).run();
}
function tokenMints(values){return [...new Set(values.filter(mintOk))];}
async function providerBackoff(env,kind,response){
 const key=kind==='discovery'?'discovery_backoff_level':'provider_backoff_level';
 const untilKey=kind==='discovery'?'discovery_cooldown_until':'cooldown_until';
 const level=Math.min(5,(Number(await getState(env,key))||0)+1);
 const retryAfter=response?.headers?.get?.('retry-after');
 const retry=retryAfter?Math.max(0,retryDeadline(retryAfter)-Date.now()):0;
 const delay=Math.max(Math.min(MAX_BACKOFF_MS,BACKOFF_BASE_MS*Math.pow(2,level-1)),retry);
 await putState(env,key,level);
 await putState(env,untilKey,Date.now()+delay);
 return delay;
}
async function availablePool(env){
 const all=[];
 // New discovery is supplemented with historical known mints and the user's watchlist.
 try{
  const rows=await env.STAGE_DB.prepare("SELECT mint FROM scanner_snapshots GROUP BY mint ORDER BY MAX(observed_at) ASC LIMIT 150").all();
  all.push(...(rows.results||[]).map(r=>r.mint));
 }catch{}
 try{
  const rows=await env.STAGE_DB.prepare("SELECT token_ca AS mint FROM watchlist ORDER BY updated_at DESC LIMIT 30").all();
  all.push(...(rows.results||[]).map(r=>r.mint));
 }catch{} // Table absent on isolated staging DB.
 try{
  const rows=await env.STAGE_DB.prepare("SELECT token_ca AS mint FROM predictions ORDER BY created_at DESC,id DESC LIMIT 150").all();
  all.push(...(rows.results||[]).map(r=>r.mint));
 }catch{}
 return tokenMints(all);
}
export async function runScheduledScan(event,env){
 if(!env.STAGE_DB||!env.INTERNAL_TOKEN||!env.AI_ENGINE)throw Error("SCANNER_BINDING_MISSING");
 const now=Date.now(),startISO=new Date(now).toISOString(),context=createProviderContext();
 await env.STAGE_DB.prepare("UPDATE scanner_runs SET status='FAILED',completed_at=?,error='RUN_TIMEOUT_RECOVERED' WHERE status='RUNNING' AND started_at<?").bind(startISO,new Date(now-15*60*1000).toISOString()).run();
 const scheduledTime=Number(event?.scheduledTime)||now;
 // Manual batch scans have a separate 15-minute duplicate key; cron retains its original schedule key.
 const scheduleKey=event?.kind==='manual'?'manual:'+Math.floor(scheduledTime/900000):'cron:'+Math.floor(scheduledTime/1800000);
 const created=await env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_runs(schedule_key,started_at,status) VALUES (?,?,'RUNNING')").bind(scheduleKey,startISO).run();
 if(!created.meta?.changes)return {status:'SKIPPED_DUPLICATE',scheduleKey};
 const runId=created.meta.last_row_id;
 let status='COMPLETED',error=null,selected=[],snapshotCount=0,results=[],profilesWarning=null;
 try{
  {
   const dexPaused=Number(await getState(env,'cooldown_until'))>now;
   let cached=[];
   try{cached=JSON.parse(await getState(env,'discovery_cached_mints')||'[]')}catch{}
   if(!Array.isArray(cached))cached=[];
   const discoveryNext=Number(await getState(env,'discovery_next_at'));
   const discoveryDue=!Number.isFinite(discoveryNext)||discoveryNext<=now||discoveryNext>now+DISCOVERY_INTERVAL_MS;
   if(discoveryDue&&Number(await getState(env,'discovery_cooldown_until'))<=now){
    // One bounded discovery cycle per scanner interval; cached source responses are reused.
    await putState(env,'discovery_next_at',now+DISCOVERY_INTERVAL_MS);
    try{
     const discovery=await discoverMints({context});
     if(discovery.mints.length){cached=discovery.mints.slice(0,80);await putState(env,'discovery_cached_mints',JSON.stringify(cached));}
     const limited=discovery.attempts.find(x=>x.error==='RATE_LIMIT');
     if(limited){await providerBackoff(env,'discovery');profilesWarning='Discovery HTTP 429; using independent fallback/cached mints';}
    }catch(e){profilesWarning='Discovery unavailable: '+String(e.message).slice(0,100);}
   }
   const known=await availablePool(env);
   const pool=tokenMints([...cached,...known]);
   const due=await env.STAGE_DB.prepare(`SELECT c.mint FROM prediction_candidates c
    WHERE c.observed_at>=? AND c.observed_at<=? AND NOT EXISTS(SELECT 1 FROM candidate_evaluations e WHERE e.candidate_id=c.id)
    GROUP BY c.mint ORDER BY MIN(c.observed_at),c.mint LIMIT 6`).bind(new Date(now-90*60000).toISOString(),new Date(now-25*60000).toISOString()).all();
   const followups=tokenMints((due.results||[]).map(x=>x.mint));
   if(!pool.length&&!followups.length){status='EMPTY';error='No valid mints discovered or tracked';}
   else{
    const cursor=Math.max(0,Number(await getState(env,'rotation_index'))||0);
    const selection=selectScanMints(pool,followups,{cursor,limit:BATCH_MAX_MINTS});
    selected=selection.selected;
    // At most ONE DexScreener price request per run for up to 12 mints.
    const market=await scannerMarket(selected,env,{dexPaused,context});
    const dex=market.attempts.find(x=>x.provider==='dexscreener');
    if(dex?.error==='RATE_LIMIT')await providerBackoff(env,'pairs',{headers:new Headers(dex.retryAt?{'retry-after':dex.retryAt}:{})});
    if(!market.pairs.length&&!market.observations?.length&&market.attempts.every(x=>!x.ok)){
     status=market.attempts.some(x=>['RATE_LIMIT','COOLDOWN'].includes(x.error))?'RATE_LIMITED':'FAILED';
     error='All pool sources unavailable; '+market.attempts.map(x=>x.provider+':'+x.error).join(',');
    }else{
     const data=market.pairs;
     const items=market.observations??scanPairs(data.filter(p=>selected.includes(p?.baseToken?.address)));
     const grouped=new Map();
     for(const item of items){
      const bucket=grouped.get(item.base.mint)||[];
      if(bucket.length<3)bucket.push(item);
      grouped.set(item.base.mint,bucket);
     }
     const chosen=[...grouped.values()].flat().slice(0,100);
     if(chosen.length){
      const scored=await env.AI_ENGINE.fetch('https://nebula-ai-engine.internal/score',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.INTERNAL_TOKEN},body:JSON.stringify({items:chosen})});
      if(!scored.ok)throw Error('AI Engine HTTP '+scored.status);
      const body=await scored.json();
      if(!Array.isArray(body.results)||body.results.length!==chosen.length)throw Error('AI Engine response length mismatch');
      const statements=[];
      for(let i=0;i<chosen.length;i++){
       const c=chosen[i],v=body.results[i];
       if(v?.mint!==c.base.mint||v?.pairAddress!==c.pairAddress)throw Error('AI score identity mismatch');
       if(!['WATCH','REVIEW','INSUFFICIENT_DATA'].includes(v.decision)||typeof v.model!=='string'||!v.model||(v.decision==='INSUFFICIENT_DATA'?v.score!==null:!Number.isFinite(v.score)||v.score<0||v.score>100))throw Error('AI score invalid');
       statements.push(env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_snapshots(mint,pair_address,observed_at,liquidity_usd,volume_24h,change_24h,payload_json) VALUES (?,?,?,?,?,?,?)").bind(c.base.mint,c.pairAddress,c.observedAt,c.liquidityUsd,c.volume24h,c.change24h,JSON.stringify(c)));
       statements.push(env.STAGE_DB.prepare("INSERT OR IGNORE INTO engine_scores(mint,pair_address,observed_at,model,decision,score,payload_json) VALUES (?,?,?,?,?,?,?)").bind(v.mint,v.pairAddress,c.observedAt,v.model,v.decision,v.score,JSON.stringify({...v,observedAt:c.observedAt,source:c.source})));
      }
      const writes=await env.STAGE_DB.batch(statements);
      if(!Array.isArray(writes)||writes.length!==statements.length)throw Error('Snapshot persistence result unavailable');
      snapshotCount=writes.reduce((sum,result,i)=>sum+(i%2===0?Number(result.meta?.changes)||0:0),0);
     }
     results=selected.map(mint=>({mint,status:grouped.has(mint)?200:404,snapshots:grouped.get(mint)?.length||0,providerAttempts:market.attempts}));
     await putState(env,'rotation_index',selection.nextCursor);
     if(dex?.ok){await putState(env,'provider_backoff_level','0');await putState(env,'cooldown_until','0');}
     status=snapshotCount?'COMPLETED':'EMPTY';
     if(profilesWarning)error=profilesWarning;
    }
   }
  }
 }catch(e){status='FAILED';error=String(e?.message||e).slice(0,220);}
 await env.STAGE_DB.prepare('UPDATE scanner_runs SET completed_at=?,status=?,selected_count=?,snapshot_count=?,results_json=?,error=? WHERE id=?').bind(new Date().toISOString(),status,selected.length,snapshotCount,JSON.stringify(results),error,runId).run();
 await diagnostic(env,'scheduled',status,'Batch '+runId+'; '+selected.length+' mints; '+snapshotCount+' snapshots; '+String(error||'').slice(0,100));
 return {status,selectedCount:selected.length,snapshotCount,error};
}

export async function liveOnlyScan(env={}){let feed;
 if(env.MARKET_API)try{const r=await env.MARKET_API.fetch('https://market.internal/api/v1/market-feed',{signal:AbortSignal.timeout(15000)});const data=await r.json();if(r.ok&&Array.isArray(data.items))feed=data}catch{}
 feed=feed||await marketFeed(env);return {success:feed.items.length>0,status:'LIVE_ONLY',selectedCount:feed.items.length,snapshotCount:0,persisted:false,warning:'D1_DAILY_READ_LIMIT',resetAt:resetUTC(Date.now()),items:feed.items,providerAttempts:feed.providerAttempts};}
const worker={async scheduled(event,env,ctx){
 ctx.waitUntil((async()=>{try{await runScheduledScan(event,env)}catch(e){if(!d1DailyLimitError(e))throw e;const live=await liveOnlyScan(env);console.warn('scanner_live_only',JSON.stringify({status:live.status,items:live.items.length,persisted:false,resetAt:live.resetAt}));}})());
},async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==='/run'&&request.method==='POST'){
  const header=request.headers.get('Authorization');
  const internalAuthorized=!!env.INTERNAL_TOKEN&&header==='Bearer '+env.INTERNAL_TOKEN;
  const manualAuthorized=!!env.MANUAL_SCAN_TOKEN&&header==='Bearer '+env.MANUAL_SCAN_TOKEN;
  if(!internalAuthorized&&!manualAuthorized)return reply({error:'UNAUTHORIZED'},401);
  if(!env.STAGE_DB||!env.AI_ENGINE||!env.INTERNAL_TOKEN)return reply({error:'SCANNER_BINDING_MISSING'},503);
  try{
   const isManual=manualAuthorized&&!internalAuthorized;
   const result=await runScheduledScan({scheduledTime:Date.now(),kind:isManual?'manual':'cron'},env);
   if(result.status==='SKIPPED_DUPLICATE'){
    const retryAt=isManual?new Date((Math.floor(Date.now()/900000)+1)*900000).toISOString():null;
    return reply({success:false,error:isManual?'MANUAL_SCAN_COOLDOWN':'SCANNER_DUPLICATE',...result,retryAt},429);
   }
   if(result.status==='RATE_LIMITED'){
    const state=await env.STAGE_DB.prepare("SELECT value FROM scanner_state WHERE key='cooldown_until'").first();
    const until=Number(state?.value);
    const retryAt=Number.isFinite(until)&&until>Date.now()?new Date(until).toISOString():null;
    return reply({success:false,error:'PROVIDER_COOLDOWN',...result,retryAt},429);
   }
   if(result.status==='FAILED')return reply({success:false,error:'SCANNER_FAILED',...result},502);
   return reply({success:true,...result});
  }catch(e){if(d1DailyLimitError(e)){const live=await liveOnlyScan(env);return reply(live,live.success?200:503)}return reply({success:false,error:'SCANNER_UNAVAILABLE'},503);}
 }
 if(u.pathname==="/health")return reply({service:"nebula-scanner",status:"ok"});
 if(u.pathname==="/discover"&&request.method==="GET"){
  if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.INTERNAL_TOKEN)return reply({error:"UNAUTHORIZED"},401);
  const mint=u.searchParams.get("mint");
  if(!mintOk(mint))return reply({error:"INVALID_MINT"},400);
  try{
   const market=await marketPairs([mint]);
   if(!market.pairs.length&&market.attempts.every(x=>!x.ok))return reply({error:'POOL_SOURCES_UNAVAILABLE',attempts:market.attempts},market.attempts.some(x=>x.error==='RATE_LIMIT')?429:502);
   const data=market.pairs;
   const pairs=(Array.isArray(data)?data:[]).filter(p=>p.baseToken?.address===mint||p.quoteToken?.address===mint);
   return reply({mint,items:scanPairs(pairs),totalPairs:pairs.length,sources:[...new Set(pairs.map(p=>p._source))]});
  }catch{return reply({error:"UPSTREAM_UNAVAILABLE"},502);}
 }
 if(u.pathname==="/pipeline"&&request.method==="GET"){
  // Manual scans use a dedicated secret. Existing INTERNAL_TOKEN remains reserved for cron/AI paths.
  const header=request.headers.get("Authorization");
  const internalAuthorized=!!env.INTERNAL_TOKEN&&header==="Bearer "+env.INTERNAL_TOKEN;
  const manualAuthorized=!!env.MANUAL_SCAN_TOKEN&&header==="Bearer "+env.MANUAL_SCAN_TOKEN;
  if(!internalAuthorized&&!manualAuthorized)return reply({error:"UNAUTHORIZED"},401);

  if(!env.AI_ENGINE)return reply({error:"ENGINE_BINDING_MISSING"},503);
  const mint=u.searchParams.get("mint");
  if(!mintOk(mint))return reply({error:"INVALID_MINT"},400);
  try{
   const market=await marketPairs([mint]);
   if(!market.pairs.length&&market.attempts.every(x=>!x.ok))return reply({error:'POOL_SOURCES_UNAVAILABLE',attempts:market.attempts},market.attempts.some(x=>x.error==='RATE_LIMIT')?429:502);
   const pairs=market.pairs;
   const selected=(Array.isArray(pairs)?pairs:[]).filter(p=>p.baseToken?.address===mint);
   const items=scanPairs(selected).slice(0,200);
   if(!items.length)return reply({mint,items:[],results:[],note:"NO_BASE_TOKEN_PAIRS"});
   const scored=await env.AI_ENGINE.fetch("https://nebula-ai-engine.internal/score",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+env.INTERNAL_TOKEN},body:JSON.stringify({items})});
   if(!scored.ok)return reply({error:"ENGINE_FAILED",status:scored.status},502);
   const data=await scored.json();
   if(!Array.isArray(data.results)||data.results.length!==items.length)return reply({error:"ENGINE_RESPONSE_INVALID"},502);
   if(data.results.some((v,i)=>!v||v.mint!==items[i].base.mint||v.pairAddress!==items[i].pairAddress))return reply({error:"IDENTITY_MISMATCH"},502);
   const persist=u.searchParams.get("persist")==="1";
   if(persist){
    if(!env.STAGE_DB)return reply({error:"STAGING_DB_MISSING"},503);
    try{
     for(let i=0;i<items.length;i++){
      const c=items[i],v={...data.results[i],observedAt:items[i].observedAt,source:items[i].source};
      if(v.mint!==c.base.mint||v.pairAddress!==c.pairAddress)return reply({error:"IDENTITY_MISMATCH"},502);
      await env.STAGE_DB.batch([
       env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_snapshots (mint,pair_address,observed_at,liquidity_usd,volume_24h,change_24h,payload_json) VALUES (?,?,?,?,?,?,?)").bind(c.base.mint,c.pairAddress,c.observedAt,c.liquidityUsd,c.volume24h,c.change24h,JSON.stringify(c)),
       env.STAGE_DB.prepare("INSERT INTO engine_scores (mint,pair_address,observed_at,model,decision,score,payload_json) VALUES (?,?,?,?,?,?,?)").bind(v.mint,v.pairAddress,c.observedAt,v.model,v.decision,v.score,JSON.stringify(v))
      ]);
     }
    }catch{return reply({error:"STAGING_WRITE_FAILED"},503);}
   }
   return reply({mint,items,results:data.results,sources:[...new Set(items.map(p=>p.source))],persisted:persist});
  }catch{return reply({error:"PIPELINE_UNAVAILABLE"},502);}
 }
 if(u.pathname!=="/scan"||request.method!=="POST")return reply({error:"NOT_FOUND"},404);
 // Private Worker-to-Worker service token; do not expose public scan endpoint.
 if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.INTERNAL_TOKEN}`)return reply({error:"UNAUTHORIZED"},401);
 let payload;try{payload=await request.json()}catch{return reply({error:"INVALID_JSON"},400)}
 if(!Array.isArray(payload?.pairs)||payload.pairs.length>200)return reply({error:"INVALID_PAIRS"},400);
 return reply({items:scanPairs(payload.pairs),count:payload.pairs.length});
}};


export default worker;
