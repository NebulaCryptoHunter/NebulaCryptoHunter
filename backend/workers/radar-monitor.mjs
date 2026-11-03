import {scoreCandidate} from './scoring-v2.mjs';
import {createProviderContext} from './provider-runtime.mjs';
import {RADAR_VERSION,RADAR_POLICY,updateTrack,trackItem,stamp,freshItem,record} from './radar-policy.mjs';
import {admitTracks,hydrateTrack,observationItem,readRuntime,runtimeStatement,trackStatements,readTrackingFeed,publishFeed,evaluateSignals,trackingAnalytics} from './radar-store.mjs';
import {fetchPattern} from './radar-market.mjs';
import {d1DailyLimitError} from './research-cache.mjs';
import {researchData} from './research-api.mjs';
const iso=ms=>new Date(ms).toISOString();
const safeError=e=>String(e?.message||e).replace(/https?:\/\/\S+/g,'[upstream]').slice(0,140);
export const backupBackend=env=>env.ARCHIVE?'R2':env.SNAPSHOT_BACKUP?'KV':null;
export async function readSnapshotBackup(env){
 if(env.ARCHIVE)try{const object=await env.ARCHIVE.get('radar/latest.json');if(object)return {feed:await object.json(),backend:'R2'};}catch{}
 if(env.SNAPSHOT_BACKUP)try{const feed=await env.SNAPSHOT_BACKUP.get('radar/latest.json',{type:'json',cacheTtl:60});if(feed?.version===RADAR_VERSION&&Array.isArray(feed.items))return {feed,backend:'KV'};}catch{}
 return null;
}
export async function writeSnapshotBackup(env,feed,{now=Date.now(),previous=null,account=()=>{}}={}){
 const backend=backupBackend(env);if(!backend)return null;
 if(previous?.backend===backend&&previous.nextAttemptAt>now)return previous;
 const state={backend,status:'WRITING',nextAttemptAt:now+5*60000,lastSuccessAt:previous?.lastSuccessAt||null,snapshotAt:previous?.snapshotAt||null,error:null};
 // Persist the attempt before the external write: cron retries cannot multiply
 // KV writes. At most 288 snapshot writes/day, with no per-token KV writes.
 account(await runtimeStatement(env.DB,'snapshot-backup',state,now).run());
 try{
  const body=JSON.stringify(feed);
  if(backend==='R2')await env.ARCHIVE.put('radar/latest.json',body,{httpMetadata:{contentType:'application/json'}});
  else await env.SNAPSHOT_BACKUP.put('radar/latest.json',body);
  state.status='READY';state.lastSuccessAt=iso(now);state.snapshotAt=feed.generatedAt;
 }catch(e){state.status='FAILED';state.error=safeError(e);console.warn('radar_snapshot_backup_unavailable',e?.name);}
 account(await runtimeStatement(env.DB,'snapshot-backup',state,now).run());
 return state;
}
async function serveFeed(env){
 const key=new Request('https://nebula.internal/radar-monitor-feed-v1');let cached=null;
 try{const r=await globalThis.caches?.default?.match(key);if(r)cached=await r.json();}catch{}
 if(cached&&Date.now()-stamp(cached.cacheAt)<15000)return cached;
 try{
  const feed={...await readTrackingFeed(env.DB),cacheAt:new Date().toISOString()};
  try{await globalThis.caches?.default?.put(key,Response.json(feed,{headers:{'Cache-Control':'public,max-age=86400'}}));}catch{}
  return feed;
 }catch(e){
  if(cached)return {...cached,status:'STALE_CACHE',warning:d1DailyLimitError(e)?'D1_DAILY_READ_LIMIT':'TRACKING_READ_UNAVAILABLE'};
  const saved=await readSnapshotBackup(env);if(saved)return {...saved.feed,status:'ARCHIVE_FALLBACK',backupBackend:saved.backend,warning:'D1_UNAVAILABLE'};
  throw e;
 }
}
export async function runMonitor(env,{now=Date.now()}={}){
 const db=env.DB;if(!db)return {status:'NOT_CONFIGURED'};
 const lockUntil=now+45000,lease=crypto.randomUUID();
 const lock=await db.prepare(`INSERT INTO radar_runtime(key,value_json,updated_at) VALUES('monitor-lock',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
  WHERE CAST(json_extract(radar_runtime.value_json,'$.until') AS REAL)<?`).bind(JSON.stringify({until:lockUntil,lease}),iso(now),now).run();
 if(!lock.meta?.changes)return {status:'BUSY'};
 const day=iso(now).slice(0,10),previous=await readRuntime(db,'monitor-budget'),budget=previous?.day===day?previous:{day,startedAt:now,rowsRead:0,rowsWritten:0,runs:0};
 const account=results=>{for(const r of Array.isArray(results)?results:[results]){budget.rowsRead+=Number(r?.meta?.rows_read)||0;budget.rowsWritten+=Number(r?.meta?.rows_written)||0;}};
 let selected=[],items=[],error=null,candleRequests=0,status='RUNNING',snapshotBackup=null;
 try{
  if(budget.rowsWritten>=RADAR_POLICY.ownDailyWriteBudget||budget.rowsRead>=RADAR_POLICY.ownDailyReadBudget){status='MONITOR_BUDGET_PAUSED';return {status,budget};}
  const remainingMinutes=(Date.parse(day+'T00:00:00Z')+86400000-now)/60000,elapsedMinutes=Math.max(10,(now-(budget.startedAt||now))/60000);
  const projected=budget.rowsWritten+budget.rowsWritten/elapsedMinutes*remainingMinutes;
  const cadenceFactor=Math.min(10,Math.max(1,Math.ceil(projected/(RADAR_POLICY.ownDailyWriteBudget*.9))));
  if(cadenceFactor>1)status='CONSERVING_BUDGET';
  const hot=await db.prepare("SELECT mint,last_score FROM radar_tracks WHERE state IN ('ACTIVE','WEAK') ORDER BY last_score DESC,mint LIMIT 30").all();account(hot);
  const hotMints=(hot.results||[]).slice(0,RADAR_POLICY.hotLimit).map(x=>x.mint),warmMints=(hot.results||[]).slice(RADAR_POLICY.hotLimit,RADAR_POLICY.hotLimit+RADAR_POLICY.warmLimit).map(x=>x.mint);
  const due=await db.prepare("SELECT * FROM radar_tracks WHERE state IN ('ACTIVE','WEAK') AND next_due_at<=? ORDER BY next_due_at,last_score DESC LIMIT ?").bind(iso(now),RADAR_POLICY.maxDue).all();account(due);
  const pending=await db.prepare("SELECT mint FROM radar_signals WHERE status='PENDING' AND due_at<=? AND deadline_at>=? GROUP BY mint ORDER BY MIN(due_at) LIMIT 6").bind(iso(now),iso(now)).all();account(pending);
  selected=(due.results||[]).map(hydrateTrack);
  const extra=(pending.results||[]).map(x=>x.mint).filter(m=>!selected.some(x=>x.mint===m));
  if(extra.length){const rows=await db.prepare('SELECT * FROM radar_tracks WHERE mint IN ('+extra.map(()=>'?').join(',')+')').bind(...extra).all();account(rows);selected=[...selected,...(rows.results||[]).map(hydrateTrack)].slice(0,30);}
  // Bootstrap from the scanner and existing market service. No fake production candidates.
  const bootstrap=await readRuntime(db,'bootstrap-next');
  if(!hot.results?.length&&env.MARKET_API&&(!bootstrap||bootstrap.at<=now)){
   await runtimeStatement(db,'bootstrap-next',{at:now+30*60000},now).run();
   const r=await env.MARKET_API.fetch('https://monitor.internal/api/v1/market-feed',{signal:AbortSignal.timeout(12000)});
   if(r.ok){const feed=await r.json();const admitted=await admitTracks(db,feed.items||[],{now});account(admitted.results);}
  }
  const riskMints=selected.filter(t=>!t.payload.lastRiskAttemptAt||now-stamp(t.payload.lastRiskAttemptAt)>=10*60000).sort((a,b)=>stamp(a.payload.lastRiskAttemptAt||a.first_seen_at)-stamp(b.payload.lastRiskAttemptAt||b.first_seen_at)).slice(0,12).map(t=>t.mint);
  let observations=[],attempts=[];
  if(selected.length&&env.MARKET_API){
   const url='https://monitor.internal/api/v1/monitor-market?mints='+selected.map(x=>x.mint).join(',')+'&risk='+riskMints.join(',');
   const r=await env.MARKET_API.fetch(url,{signal:AbortSignal.timeout(13000)});
   if(!r.ok)throw Error('MONITOR_MARKET_HTTP_'+r.status);
   const result=await r.json();observations=Array.isArray(result.observations)?result.observations:[];attempts=result.attempts||[];
  }
  const context=createProviderContext({maxRequests:3,deadlineMs:8000});
  const candleDue=selected.filter(t=>t.state!=='EXITED'&&(!t.payload.lastCandleAttemptAt||now-stamp(t.payload.lastCandleAttemptAt)>=5*60000))
   .sort((a,b)=>stamp(a.payload.lastCandleAttemptAt||a.first_seen_at)-stamp(b.payload.lastCandleAttemptAt||b.first_seen_at)||(b.last_score||0)-(a.last_score||0)).slice(0,3);
  const patterns=new Map();
  for(const t of candleDue){const result=await fetchPattern(t,{now,context});patterns.set(t.mint,result);candleRequests++;}
  const statements=[];
  for(const before of selected){
   const c=observations.find(c=>c.base?.mint===before.mint&&c.pairAddress===before.pair_address);
   let item=null;
   if(c){
    // Preserve original evidence timestamps. Successful market fetches do not refresh old risk evidence.
    c.tokenMetadata=c.tokenMetadata||before.payload.item.tokenMetadata;
    c.verificationEvidence={...record(before.payload.item.verificationEvidence),...c.verificationEvidence};
    item=observationItem(c,scoreCandidate(c,{now}));items.push(item);
   }
   const interval=(hotMints.includes(before.mint)?RADAR_POLICY.hotMs:warmMints.includes(before.mint)?RADAR_POLICY.warmMs:RADAR_POLICY.coldMs)*cadenceFactor;
   const result=patterns.get(before.mint),t=updateTrack(before,item,{now,intervalMs:interval,pattern:result?.pattern});
   if(result&&['STAIRCASE','VERTICAL','CONSOLIDATION'].includes(result.pattern.type)&&result.pattern.type!==before.payload.pattern?.type&&result.candles.length){
    const evidenceId=before.episode_id+':'+result.pattern.lastClosedAt;
    t.payload.pattern.evidenceId=evidenceId;
    statements.push(db.prepare('INSERT OR IGNORE INTO radar_pattern_evidence(evidence_id,mint,pair_address,closed_at,candles_json,pattern_json) VALUES(?,?,?,?,?,?)')
     .bind(evidenceId,t.mint,t.pair_address,result.pattern.lastClosedAt,JSON.stringify(result.candles),JSON.stringify(result.pattern)));
   }
   if(result)t.payload.lastCandleAttemptAt=iso(now);
   if(riskMints.includes(t.mint))t.payload.lastRiskAttemptAt=iso(now);
   if(!item){const limited=attempts.some(a=>['RATE_LIMIT','COOLDOWN'].includes(a.error));t.payload.dataStatus=limited?'RATE_LIMIT':'POOL_MISSING';}
   statements.push(...trackStatements(db,before,t,{now,checkpointMs:hotMints.includes(t.mint)?5*60000:15*60000}));
   if(result?.candles.length&&env.ARCHIVE)try{await env.ARCHIVE.put('candles/'+before.mint+'/'+Math.floor(now/300000)+'.json',JSON.stringify({mint:before.mint,pairAddress:before.pair_address,observedAt:iso(now),...result}),{httpMetadata:{contentType:'application/json'}});}catch(e){console.warn('radar_archive_unavailable',e?.name);}
  }
  if(statements.length)account(await db.batch(statements));
  account(await evaluateSignals(db,items.filter(x=>freshItem(x,now)),{now}));
  snapshotBackup=await readRuntime(db,'snapshot-backup');
  const feed=await publishFeed(db,{now,account,health:{selected:selected.length,candleRequests,archiveEnabled:!!env.ARCHIVE,backupBackend:backupBackend(env),snapshotBackup,error:null,status,cadenceFactor}});
  snapshotBackup=await writeSnapshotBackup(env,feed,{now,previous:snapshotBackup,account});
  if(Math.floor(now/60000)%5===0)await runtimeStatement(db,'algorithm-analytics',await trackingAnalytics(db),now).run();
  const nextLegacy=await readRuntime(db,'legacy-next');
  if(!nextLegacy||nextLegacy.at<=now){
   await runtimeStatement(db,'legacy-next',{at:now+30*60000},now).run();
   try{await runtimeStatement(db,'legacy-context',await researchData(db),now).run();}catch(e){console.warn('radar_legacy_context_unavailable',e?.name);}
  }
  return {status:'COMPLETED',selected:selected.length,items:items.length,candleRequests,tracked:feed.items.length,budget};
 }catch(e){status='FAILED';error=safeError(e);console.warn('radar_monitor_failed',JSON.stringify({error,d1Limited:d1DailyLimitError(e)}));throw e;
 }finally{
  budget.runs++;budget.rowsWritten+=4; // bounded coordination + snapshot overhead; row metadata tracks the bulk writes.
  try{await db.batch([runtimeStatement(db,'monitor-budget',budget,now),runtimeStatement(db,'monitor-health',{version:RADAR_VERSION,at:iso(now),status,selected:selected.length,error,archiveEnabled:!!env.ARCHIVE,backupBackend:backupBackend(env),snapshotBackup},now),
   db.prepare("UPDATE radar_runtime SET value_json=? WHERE key='monitor-lock' AND json_extract(value_json,'$.lease')=?").bind(JSON.stringify({until:0,lease}),lease)]);}catch(e){console.warn('radar_monitor_state_unavailable',e?.name);}
 }
}
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(runMonitor(env).then(r=>console.log('radar_monitor',JSON.stringify(r))).catch(()=>{}));},
 async fetch(request,env){
  const u=new URL(request.url);if(request.method!=='GET')return Response.json({error:'METHOD_NOT_ALLOWED'},{status:405});
  if(u.pathname==='/health')return Response.json({service:'nebula-monitor',version:RADAR_VERSION,archiveEnabled:!!env.ARCHIVE,backupBackend:backupBackend(env)});
  try{
   if(u.pathname==='/feed')return Response.json(await serveFeed(env),{headers:{'Cache-Control':'no-store'}});
   if(u.pathname==='/status')return Response.json({health:await readRuntime(env.DB,'monitor-health'),budget:await readRuntime(env.DB,'monitor-budget'),analytics:await readRuntime(env.DB,'algorithm-analytics')});
  }catch(e){
   if(u.pathname==='/feed'){const saved=await readSnapshotBackup(env);if(saved)return Response.json({...saved.feed,status:'ARCHIVE_FALLBACK',backupBackend:saved.backend,warning:d1DailyLimitError(e)?'D1_DAILY_READ_LIMIT':'TRACKING_READ_UNAVAILABLE'});}
   return Response.json({error:'TRACKING_UNAVAILABLE'},{status:503});
  }
  return Response.json({error:'NOT_FOUND'},{status:404});
 }
};
