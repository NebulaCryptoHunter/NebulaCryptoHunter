import {RADAR_VERSION,RADAR_POLICY,newTrack,record,trackItem,positive,stamp} from './radar-policy.mjs';
const iso=ms=>new Date(ms).toISOString();
export const hydrateTrack=row=>({...row,payload:record(row.payload_json)||{}});
const columns=['mint','pair_address','episode_id','state','first_seen_at','first_price','first_score','last_observed_at','last_price','last_score','peak_price','weak_count','weak_since','next_due_at','last_checkpoint_at','exit_reason','payload_json','updated_at'];
const values=t=>columns.map(k=>k==='payload_json'?JSON.stringify(t.payload):t[k]??null);
const insert=`INSERT OR IGNORE INTO radar_tracks(${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`;
export function observationItem(c,v){return {mint:c.base.mint,symbol:c.base.symbol,pair_address:c.pairAddress,observed_at:c.observedAt,
 price_usd:c.priceUsd,liquidity_usd:c.liquidityUsd,volume_24h:c.volume24h,change_24h:c.change24h,source:c.source,
 source_as_of:c.sourceAsOf,timeframes:c.timeframes,tokenMetadata:c.tokenMetadata||null,verificationEvidence:c.verificationEvidence||null,
 ...v,persisted:true,evaluation_status:'PENDING'};}
export async function readRuntime(db,key){const r=await db.prepare('SELECT value_json FROM radar_runtime WHERE key=?').bind(key).first();return record(r?.value_json);}
export const runtimeStatement=(db,key,value,now=Date.now())=>db.prepare('INSERT INTO radar_runtime(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at').bind(key,JSON.stringify(value),iso(now));
export async function admitTracks(db,items,{now=Date.now()}={}){
 const seen=new Set(),tracks=[];
 for(const x of items){if(seen.has(x?.mint))continue;const t=newTrack(x,now);if(t){seen.add(t.mint);tracks.push(t);}}
 if(!tracks.length)return {admitted:0,results:[]};
 const results=await db.batch(tracks.map(t=>db.prepare(insert).bind(...values(t))));
 const added=tracks.filter((_,i)=>results[i]?.meta?.changes>0);
 if(added.length)results.push(...await db.batch(added.flatMap(t=>[
  eventStatement(db,t,'ADMITTED',{policy:RADAR_VERSION},now),...signalStatements(db,t,'V4_SELECTION',now)
 ])));
 return {admitted:added.length,results};
}
export const eventStatement=(db,t,kind,detail,now)=>db.prepare('INSERT OR IGNORE INTO radar_events(event_id,mint,episode_id,observed_at,kind,detail_json) VALUES(?,?,?,?,?,?)')
 .bind(t.episode_id+':'+kind+':'+iso(now),t.mint,t.episode_id,iso(now),kind,JSON.stringify(detail));
export function signalStatements(db,t,algorithm,now){
 const detected=iso(now),id=t.episode_id+':'+algorithm+':'+detected;
 const version=algorithm==='V4_SELECTION'?t.payload.item.model:t.payload.pattern?.version||RADAR_VERSION;
 return RADAR_POLICY.horizons.map(seconds=>db.prepare(`INSERT OR IGNORE INTO radar_signals
  (signal_id,mint,pair_address,episode_id,algorithm,version,detected_at,entry_price,horizon_seconds,target_pct,due_at,deadline_at,status,detail_json)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?)`).bind(id+':'+seconds,t.mint,t.pair_address,t.episode_id,algorithm,version,detected,t.last_price,seconds,RADAR_POLICY.targetPct,
   iso(now+seconds*1000),iso(now+seconds*1000+RADAR_POLICY.horizonToleranceMs),JSON.stringify({policy:'POINT_RETURN_TARGET',targetPct:RADAR_POLICY.targetPct,toleranceSeconds:RADAR_POLICY.horizonToleranceMs/1000,calibrated:false,isTradePnL:false})));
}
export function trackStatements(db,before,t,{now=Date.now(),checkpointMs=RADAR_POLICY.checkpointMs}={}){
 const updates=columns.filter(k=>!['mint','pair_address','episode_id','first_seen_at','first_price','first_score'].includes(k)&&(k!=='state'||before.state!==t.state));
 const all=[db.prepare(`UPDATE radar_tracks SET ${updates.map(k=>k+'=?').join(',')} WHERE mint=? AND episode_id=? AND updated_at<=?`)
  .bind(...updates.map(k=>k==='payload_json'?JSON.stringify(t.payload):t[k]??null),t.mint,t.episode_id,t.updated_at)];
 if(before.state!==t.state)all.push(eventStatement(db,t,t.state,{reason:t.exit_reason,score:t.last_score},now));
 const oldPattern=before.payload.pattern?.type,newPattern=t.payload.pattern?.type;
 if(newPattern!==oldPattern&&['STAIRCASE','VERTICAL','CONSOLIDATION'].includes(newPattern)){
  all.push(eventStatement(db,t,'PATTERN_'+newPattern,t.payload.pattern,now));
  if(t.state!=='EXITED')all.push(...signalStatements(db,t,newPattern,now));
 }
 if(stamp(t.last_observed_at)>stamp(before.last_observed_at)&&(!before.last_checkpoint_at||stamp(t.last_observed_at)-stamp(before.last_checkpoint_at)>=checkpointMs)){
  t.last_checkpoint_at=t.last_observed_at;
  all[0]=db.prepare(`UPDATE radar_tracks SET ${updates.map(k=>k+'=?').join(',')} WHERE mint=? AND episode_id=? AND updated_at<=?`)
   .bind(...updates.map(k=>k==='payload_json'?JSON.stringify(t.payload):t[k]??null),t.mint,t.episode_id,t.updated_at);
  const x=t.payload.item;
  all.push(db.prepare('INSERT OR IGNORE INTO scanner_snapshots(mint,pair_address,observed_at,liquidity_usd,volume_24h,change_24h,payload_json) VALUES(?,?,?,?,?,?,?)')
   .bind(t.mint,t.pair_address,t.last_observed_at,x.liquidity_usd??null,x.volume_24h??null,x.change_24h??null,JSON.stringify({base:{mint:t.mint,symbol:x.symbol},pairAddress:t.pair_address,priceUsd:t.last_price,source:x.source,observedAt:t.last_observed_at,sourceAsOf:x.source_as_of,timeframes:x.timeframes,monitorVersion:RADAR_VERSION})));
 }
 return all;
}
export async function readTrackingFeed(db,{now=Date.now()}={}){
 const saved=await readRuntime(db,'latest-feed');
 if(saved?.version===RADAR_VERSION)return saved;
 const rows=await db.prepare("SELECT * FROM radar_tracks WHERE state IN ('ACTIVE','WEAK') ORDER BY last_score DESC,mint LIMIT ?").bind(RADAR_POLICY.maxFeed).all();
 return {version:RADAR_VERSION,items:(rows.results||[]).map(hydrateTrack).map(t=>trackItem(t,now)),exitedMints:[],generatedAt:iso(now),status:'BOOTSTRAPPING'};
}
export async function publishFeed(db,{now=Date.now(),health={},account=()=>{}}={}){
 const [active,exited,counts]=await db.batch([
  db.prepare("SELECT * FROM radar_tracks WHERE state IN ('ACTIVE','WEAK') ORDER BY last_score DESC,mint LIMIT ?").bind(RADAR_POLICY.maxFeed),
  db.prepare("SELECT mint FROM radar_tracks WHERE state='EXITED' ORDER BY next_due_at DESC LIMIT 1000"),
  db.prepare('SELECT state,COUNT(*) count FROM radar_tracks GROUP BY state')
 ]);
 account([active,exited,counts]);
 const analytics=await readRuntime(db,'algorithm-analytics'),legacy=await readRuntime(db,'legacy-context');
 const result={version:RADAR_VERSION,items:(active.results||[]).map(hydrateTrack).map(t=>trackItem(t,now)),exitedMints:(exited.results||[]).map(x=>x.mint),analytics,
  counts:Object.fromEntries((counts.results||[]).map(x=>[x.state,x.count])),generatedAt:iso(now),health,status:'RUNNING',modelCalibrated:false,legacy};
 account(await runtimeStatement(db,'latest-feed',result,now).run());return result;
}
export async function evaluateSignals(db,items,{now=Date.now()}={}){
 const due=await db.prepare("SELECT * FROM radar_signals WHERE status='PENDING' AND due_at<=? ORDER BY due_at LIMIT 60").bind(iso(now)).all(),statements=[];
 for(const s of due.results||[]){
  const x=items.find(x=>x.mint===s.mint&&x.pair_address===s.pair_address&&positive(x.price_usd)&&stamp(x.observed_at)>=stamp(s.due_at)&&stamp(x.observed_at)<=stamp(s.deadline_at)&&stamp(x.observed_at)<=now+60000&&(x.source_as_of==null||stamp(x.source_as_of)>=stamp(s.due_at)));
  if(x){const roi=(x.price_usd/s.entry_price-1)*100;if(!Number.isFinite(roi))continue;
   statements.push(db.prepare("UPDATE radar_signals SET status=?,exit_price=?,roi_pct=?,evaluated_at=? WHERE signal_id=? AND status='PENDING'")
    .bind(roi>=s.target_pct?'SUCCESS':'FAILED_TARGET',x.price_usd,roi,x.observed_at,s.signal_id));
  }else if(stamp(s.deadline_at)<now)statements.push(db.prepare("UPDATE radar_signals SET status='INDETERMINATE',evaluated_at=? WHERE signal_id=? AND status='PENDING'").bind(iso(now),s.signal_id));
 }
 return statements.length?db.batch(statements):[];
}
export async function trackingAnalytics(db){
 const r=await db.prepare(`SELECT algorithm,version,horizon_seconds,target_pct,status,COUNT(*) samples,AVG(roi_pct) mean_return_pct
 FROM (SELECT * FROM radar_signals ORDER BY rowid DESC LIMIT 2000) GROUP BY algorithm,version,horizon_seconds,target_pct,status`).all();
 return {version:RADAR_VERSION,scope:'LATEST_2000_SIGNAL_HORIZONS',rows:r.results||[],definition:'Versioned paper signals; success means point return >= declared target at declared horizon plus tolerance. Missing observations are indeterminate. Not trading win rate or P&L.',calibrated:false};
}
