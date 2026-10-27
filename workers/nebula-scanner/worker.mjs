import {toPredictionCandidates} from './prediction-adapter.mjs';
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
export async function runScheduledScan(event,env){
 const key='cron:'+Math.floor(event.scheduledTime/1800000),now=new Date().toISOString();
 const inserted=await env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_runs(schedule_key,started_at,status) VALUES (?,?,'RUNNING')").bind(key,now).run();
 if(!inserted.meta.changes)return;
 const runId=inserted.meta.last_row_id,results=[];let status='COMPLETED',error=null,selected=[];
 try{
  const state=await env.STAGE_DB.prepare("SELECT value FROM scanner_state WHERE key='cooldown_until'").first();
  let profiles=[];
  if(Number(state?.value)>Date.now()){status='RATE_LIMITED';error='Provider cooldown active';}
  else {
   const response=await fetch('https://api.dexscreener.com/token-profiles/latest/v1',{signal:AbortSignal.timeout(8000)});
   if(!response.ok){if(response.status===429){status='RATE_LIMITED';await setCooldown(env);error='Discovery HTTP 429; provider cooldown set';}else{throw Error('Discovery HTTP '+response.status);}}
   else profiles=await response.json();
   if(!Array.isArray(profiles))throw Error('Invalid discovery response');
  }
  {
   const discovered=[...new Set(profiles.filter(p=>p.chainId==='solana'&&mintOk(p.tokenAddress)).map(p=>p.tokenAddress))];
   const {results:tracked}=await env.STAGE_DB.prepare("SELECT mint,MAX(observed_at) last_seen FROM scanner_snapshots GROUP BY mint ORDER BY last_seen ASC LIMIT 2").all();
   selected=[...new Set([...discovered.slice(0,3),...tracked.map(p=>p.mint),...discovered.slice(3)])].filter(mintOk).slice(0,5);
   for(const mint of selected){
    const r=await worker.fetch(new Request('https://scanner.internal/pipeline?persist=1&mint='+mint,{headers:{Authorization:'Bearer '+env.INTERNAL_TOKEN}}),env);
    const d=await r.json();results.push({mint,status:r.status,snapshots:d.persisted?d.items?.length||0:0,error:d.error||null});
    if(r.status===429){status='RATE_LIMITED';await setCooldown(env);break;}
    if(!r.ok)status='PARTIAL';
   }
   if(!selected.length&&status==='COMPLETED')status='EMPTY';
  }
 }catch(e){if(status!=='RATE_LIMITED')status='FAILED';error=String(e.message).slice(0,200);}
 await env.STAGE_DB.prepare("UPDATE scanner_runs SET completed_at=?,status=?,selected_count=?,snapshot_count=?,results_json=?,error=? WHERE id=?").bind(new Date().toISOString(),status,selected.length,results.reduce((n,x)=>n+x.snapshots,0),JSON.stringify(results),error,runId).run();
 await diagnostic(env,'scheduled',status,'Round '+runId+'; '+results.length+' tokens processed');
}
async function setCooldown(env){await env.STAGE_DB.prepare("INSERT INTO scanner_state(key,value) VALUES ('cooldown_until',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(Date.now()+30*60*1000)).run();}
const worker={async scheduled(event,env,ctx){
 ctx.waitUntil(runScheduledScan(event,env));
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
   const candidates=toPredictionCandidates(items,data.results);
   const persist=u.searchParams.get("persist")==="1";
   if(persist){
    if(!env.STAGE_DB)return reply({error:"STAGING_DB_MISSING"},503);
    try{
     for(let i=0;i<items.length;i++){
      const c=items[i],v=data.results[i];
      if(v.mint!==c.base.mint||v.pairAddress!==c.pairAddress)return reply({error:"IDENTITY_MISMATCH"},502);
      await env.STAGE_DB.batch([
       env.STAGE_DB.prepare("INSERT OR IGNORE INTO scanner_snapshots (mint,pair_address,observed_at,liquidity_usd,volume_24h,change_24h,payload_json) VALUES (?,?,?,?,?,?,?)").bind(c.base.mint,c.pairAddress,c.observedAt,c.liquidityUsd,c.volume24h,c.change24h,JSON.stringify(c)),
       env.STAGE_DB.prepare("INSERT INTO engine_scores (mint,pair_address,observed_at,model,decision,score,payload_json) VALUES (?,?,?,?,?,?,?)").bind(v.mint,v.pairAddress,c.observedAt,v.model,v.decision,v.score,JSON.stringify(v))
      ]);
     }
    }catch{return reply({error:"STAGING_WRITE_FAILED"},503);}
   }
   return reply({mint,items,results:data.results,predictionCandidates:candidates,source:"dexscreener",persisted:persist});
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
