import {evaluateResearch} from './research-evaluation.mjs';
// NEBULA scanner: deterministic token identity and pool-specific discovery.
// Research-only: staging D1 snapshots and scores; no trading.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const number=x=>{if(x===null||x===undefined||x==='')return null;const n=Number(x);return Number.isFinite(n)?n:null};
const mintOk=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function scanPairs(pairs,{minLiquidityUsd=10000}={}){
 const results=[];
 for(const p of Array.isArray(pairs)?pairs:[]){
  if(p?.chainId!=="solana"||!p?.pairAddress)continue;
  const base=p.baseToken,quote=p.quoteToken;
  if(!base?.address||!quote?.address||!mintOk(base.address)||!mintOk(quote.address))continue;
  const liq=number(p.liquidity?.usd);
  if(liq===null||liq<minLiquidityUsd)continue;
  const change24h=number(p.priceChange?.h24),volume24h=number(p.volume?.h24);
  const tx=p.txns?.h24||{};
  const buys=number(tx.buys)||0,sells=number(tx.sells)||0;
  results.push({chain:"solana",pairAddress:p.pairAddress,dexId:p.dexId||null,
   base:{mint:base.address,symbol:base.symbol||null,name:base.name||null},
   quote:{mint:quote.address,symbol:quote.symbol||null,name:quote.name||null},
   priceUsd:number(p.priceUsd),liquidityUsd:liq,volume24h,change24h,
   buys24h:buys,sells24h:sells,
   momentum:{volumeLiquidityRatio:volume24h!==null&&liq>0?volume24h/liq:null,
    transactionBuyRatio:buys+sells>0?buys/(buys+sells):null},
   risk:{rugCheck:"UNKNOWN",whaleConcentration:"UNKNOWN"},
   source:"dexscreener",observedAt:new Date().toISOString()});
 }
 return results.sort((a,b)=>(b.momentum.volumeLiquidityRatio??-1)-(a.momentum.volumeLiquidityRatio??-1));
}
async function diagnostic(env,stage,status,detail){try{await env.STAGE_DB.prepare("INSERT INTO scanner_diagnostics (observed_at,stage,status,detail) VALUES (?,?,?,?)").bind(new Date().toISOString(),stage,status,String(detail).slice(0,300)).run()}catch(e){console.error("diagnostic_write_failed",String(e))}}

const BATCH_MAX_MINTS=12;
const DISCOVERY_INTERVAL_MS=6*60*60*1000;
const BACKOFF_BASE_MS=60*60*1000;
const MAX_BACKOFF_MS=12*60*60*1000;
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
 const seconds=response?.headers?.get?.('retry-after');
 const retry=seconds&&/^\d+$/.test(seconds)?Number(seconds)*1000:0;
 const delay=Math.min(MAX_BACKOFF_MS,Math.max(BACKOFF_BASE_MS*Math.pow(2,level-1),retry));
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
 const now=Date.now(),startISO=new Date(now).toISOString();
 await env.STAGE_DB.prepare("UPDATE scanner_runs SET status='FAILED',completed_at=?,error='RUN_TIMEOUT_RECOVERED' WHERE status='RUNNING' AND started_at<?").bind(startISO,new Date(now-15*60*1000).toISOString()).run();
 const scheduledTime=Number(event?.scheduledTime)||now;
 const scheduleKey='cron:'+Math.floor(scheduledTime/1800000);
 const created=await env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_runs(schedule_key,started_at,status) VALUES (?,?,'RUNNING')").bind(scheduleKey,startISO).run();
 if(!created.meta?.changes)return {status:'SKIPPED_DUPLICATE',scheduleKey};
 const runId=created.meta.last_row_id;
 let status='COMPLETED',error=null,selected=[],snapshotCount=0,results=[],profilesWarning=null;
 try{
  if(Number(await getState(env,'cooldown_until'))>now){
   status='RATE_LIMITED';error='Provider backoff active; no HTTP requests sent';
  }else{
   let cached=[];
   try{cached=JSON.parse(await getState(env,'discovery_cached_mints')||'[]')}catch{}
   if(!Array.isArray(cached))cached=[];
   const discoveryDue=Number(await getState(env,'discovery_next_at'))<=now;
   if(discoveryDue&&Number(await getState(env,'discovery_cooldown_until'))<=now){
    // Once per six hours, not once per 30-minute run.
    await putState(env,'discovery_next_at',now+DISCOVERY_INTERVAL_MS);
    try{
     const response=await fetch('https://api.dexscreener.com/token-profiles/latest/v1',{signal:AbortSignal.timeout(8000)});
     if(response.status===429){
      await providerBackoff(env,'discovery',response);
      profilesWarning='Discovery HTTP 429; falling back to cached/tracked mints';
     }else if(!response.ok){profilesWarning='Discovery HTTP '+response.status;}
     else {
      const profiles=await response.json();
      if(!Array.isArray(profiles))throw Error('Invalid discovery payload');
      cached=tokenMints(profiles.filter(p=>p.chainId==='solana').map(p=>p.tokenAddress)).slice(0,80);
      await putState(env,'discovery_cached_mints',JSON.stringify(cached));
      await putState(env,'discovery_backoff_level','0');
      await putState(env,'discovery_cooldown_until','0');
     }
    }catch(e){profilesWarning='Discovery unavailable: '+String(e.message).slice(0,100);}
   }
   const known=await availablePool(env);
   const pool=tokenMints([...cached,...known]);
   if(!pool.length){status='EMPTY';error='No valid mints discovered or tracked';}
   else{
    const cursor=Math.max(0,Number(await getState(env,'rotation_index'))||0)%pool.length;
    selected=Array.from({length:Math.min(BATCH_MAX_MINTS,pool.length)},(_,i)=>pool[(cursor+i)%pool.length]);
    // At most ONE DexScreener price request per run for up to 12 mints.
    const response=await fetch('https://api.dexscreener.com/tokens/v1/solana/'+selected.map(encodeURIComponent).join(','),{signal:AbortSignal.timeout(10000)});
    if(response.status===429){status='RATE_LIMITED';const delay=await providerBackoff(env,'pairs',response);error='Batch pricing HTTP 429; backoff '+Math.round(delay/60000)+' min';}
    else if(!response.ok){status='FAILED';error='Batch pricing HTTP '+response.status;}
    else{
     const data=await response.json();
     if(!Array.isArray(data))throw Error('Invalid batch pricing response');
     const items=scanPairs(data.filter(p=>selected.includes(p?.baseToken?.address)));
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
       statements.push(env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_snapshots(mint,pair_address,observed_at,liquidity_usd,volume_24h,change_24h,payload_json) VALUES (?,?,?,?,?,?,?)").bind(c.base.mint,c.pairAddress,c.observedAt,c.liquidityUsd,c.volume24h,c.change24h,JSON.stringify(c)));
       statements.push(env.STAGE_DB.prepare("INSERT OR IGNORE INTO engine_scores(mint,pair_address,observed_at,model,decision,score,payload_json) VALUES (?,?,?,?,?,?,?)").bind(v.mint,v.pairAddress,c.observedAt,v.model,v.decision,v.score,JSON.stringify({...v,observedAt:c.observedAt,source:c.source})));
      }
      await env.STAGE_DB.batch(statements);
      snapshotCount=chosen.length;
     }
     results=selected.map(mint=>({mint,status:200,snapshots:grouped.get(mint)?.length||0}));
     await putState(env,'rotation_index',(cursor+selected.length)%pool.length);
     await putState(env,'provider_backoff_level','0');
     await putState(env,'cooldown_until','0');
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

async function setCooldown(env){await env.STAGE_DB.prepare("INSERT INTO scanner_state(key,value) VALUES ('cooldown_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(Date.now()+30*60*1000)).run();}
const worker={async scheduled(event,env,ctx){
 ctx.waitUntil((async()=>{await runScheduledScan(event,env);await evaluateResearch(env.STAGE_DB)})());
},async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==='/run'&&request.method==='POST'){
  if(!env.INTERNAL_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.INTERNAL_TOKEN)return reply({error:'UNAUTHORIZED'},401);
  await runScheduledScan({scheduledTime:Date.now()},env);return reply({success:true});
 }
 if(u.pathname==="/health")return reply({service:"nebula-scanner",status:"ok"});
 if(u.pathname==="/discover"&&request.method==="GET"){
  if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.INTERNAL_TOKEN)return reply({error:"UNAUTHORIZED"},401);
  const mint=u.searchParams.get("mint");
  if(!mintOk(mint))return reply({error:"INVALID_MINT"},400);
  try{
   const upstream=await fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+encodeURIComponent(mint),{signal:AbortSignal.timeout(8000)});
   if(!upstream.ok){if(upstream.status===429&&env.STAGE_DB)await setCooldown(env);return reply({error:"UPSTREAM_ERROR",status:upstream.status},upstream.status===429?429:502);}
   const data=await upstream.json();
   const pairs=(Array.isArray(data)?data:[]).filter(p=>p.baseToken?.address===mint||p.quoteToken?.address===mint);
   return reply({mint,items:scanPairs(pairs),totalPairs:pairs.length,source:"dexscreener"});
  }catch{return reply({error:"UPSTREAM_UNAVAILABLE"},502);}
 }
 if(u.pathname==="/pipeline"&&request.method==="GET"){
  if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!=="Bearer "+env.INTERNAL_TOKEN)return reply({error:"UNAUTHORIZED"},401);
  const cooldown=await env.STAGE_DB?.prepare("SELECT value FROM scanner_state WHERE key='cooldown_until'").first();
  if(Number(cooldown?.value)>Date.now())return reply({error:'PROVIDER_COOLDOWN'},429);
  if(!env.AI_ENGINE)return reply({error:"ENGINE_BINDING_MISSING"},503);
  const mint=u.searchParams.get("mint");
  if(!mintOk(mint))return reply({error:"INVALID_MINT"},400);
  try{
   const upstream=await fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+encodeURIComponent(mint),{signal:AbortSignal.timeout(8000)});
   if(!upstream.ok){if(upstream.status===429&&env.STAGE_DB)await setCooldown(env);return reply({error:"UPSTREAM_ERROR",status:upstream.status},upstream.status===429?429:502);}
   const pairs=await upstream.json();
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
   return reply({mint,items,results:data.results,source:"dexscreener",persisted:persist});
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
