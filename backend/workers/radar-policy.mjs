import {MODEL, SCORING_POLICY} from './scoring-v2.mjs';
export const RADAR_VERSION='radar-v1.0.0';
// Provisional, versioned research policy, not fitted trading rules or probabilities.
export const RADAR_POLICY=Object.freeze({entryScore:60,weakScore:40,weakObservations:3,
 minWeakSpanMs:10*60000,hotLimit:10,warmLimit:20,hotMs:60000,warmMs:5*60000,
 coldMs:30*60000,checkpointMs:5*60000,ownDailyWriteBudget:50000,
 ownDailyReadBudget:1000000,maxDue:30,maxFeed:200,targetPct:10,
 horizons:[1800,7200,21600,86400],horizonToleranceMs:15*60000});
export const record=x=>{if(typeof x==='string')try{x=JSON.parse(x)}catch{return null}return x&&typeof x==='object'&&!Array.isArray(x)?x:null};
export const finite=x=>typeof x==='number'&&Number.isFinite(x);
export const positive=x=>finite(x)&&x>0;
export const stamp=x=>typeof x==='string'?Date.parse(x):NaN;
export const freshItem=(x,now=Date.now())=>[x?.observed_at,...(x?.source_as_of!=null?[x.source_as_of]:[])].every(v=>Number.isFinite(stamp(v))&&stamp(v)<=now+60000&&now-stamp(v)<=SCORING_POLICY.maxObservationAgeMs);
export const LABELS=Object.freeze({ACTIVE:'DIPANTAU',WEAK:'MELEMAH',EXITED:'KELUAR RADAR',STAIRCASE:'TANGGA NAIK',VERTICAL:'LONJAKAN VERTIKAL',CONSOLIDATION:'KONSOLIDASI',OBSERVING:'DIPANTAU',INSUFFICIENT_DATA:'POLA BELUM TERUKUR',STALE:'DATA LAMA',RATE_LIMIT:'LIMIT API',POOL_MISSING:'POOL BELUM TERSEDIA'});
export function eligibleTrack(x,now=Date.now()){
 const risk=record(x?.riskAssessment),breakdown=record(x?.scoreBreakdown),flags=Array.isArray(x?.riskFlags)?x.riskFlags:[];
 const heated=flags.includes('OVERHEATED_MOMENTUM')&&flags.every(f=>f==='OVERHEATED_MOMENTUM');
 const identity=v=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
 return x?.model===MODEL&&identity(x.mint)&&identity(x.pair_address)
  &&positive(x.price_usd)&&positive(x.liquidity_usd)&&x.liquidity_usd>=SCORING_POLICY.minReviewLiquidity
  &&freshItem(x,now)&&x.dataCoverage===100&&finite(x.score)
  &&x.timeframes?.h1?.changePct>0&&x.timeframes?.m5?.changePct>0&&flags.every(f=>f==='OVERHEATED_MOMENTUM')
  &&(x.score>=RADAR_POLICY.entryScore||(heated&&x.score>=40&&breakdown?.baseScore>=60))
  &&['UNVERIFIED','CHECKS_PASSED'].includes(risk?.status)&&risk?.critical!==true;
}
export function newTrack(item,now=Date.now()){
 if(!eligibleTrack(item,now))return null;
 const at=new Date(now).toISOString(),episode=item.mint+':'+item.pair_address+':'+item.observed_at;
 return {mint:item.mint,pair_address:item.pair_address,episode_id:episode,state:'ACTIVE',first_seen_at:item.observed_at,
  first_price:item.price_usd,first_score:item.score,last_observed_at:item.observed_at,last_price:item.price_usd,
  last_score:item.score,peak_price:item.price_usd,weak_count:0,weak_since:null,next_due_at:at,
  last_checkpoint_at:null,exit_reason:null,payload:{item:{...item,persisted:true},pattern:{type:'INSUFFICIENT_DATA'},dataStatus:'FRESH'},updated_at:at};
}
export function updateTrack(track,item,{now=Date.now(),intervalMs=RADAR_POLICY.warmMs,pattern=null}={}){
 const next={...track,payload:{...track.payload}};
 next.next_due_at=new Date(now+intervalMs).toISOString();next.updated_at=new Date(now).toISOString();
 if(track.state==='EXITED')return next;
 if(!item||item.mint!==track.mint||item.pair_address!==track.pair_address||!freshItem(item,now)||!positive(item.price_usd)){
  next.payload.dataStatus=!item?'POOL_MISSING':'STALE';return next;
 }
 const effective=x=>Math.min(stamp(x.observed_at),x.source_as_of==null?Infinity:stamp(x.source_as_of));
 if(stamp(item.observed_at)<=stamp(track.last_observed_at)||effective(item)<=effective(track.payload.item))return next; // cache repeats never confirm weakness
 next.payload.item={...item,persisted:true};next.payload.dataStatus='FRESH';
 if(pattern)next.payload.pattern=pattern;
 next.last_observed_at=item.observed_at;next.last_price=item.price_usd;next.last_score=finite(item.score)?item.score:null;
 next.peak_price=Math.max(track.peak_price,item.price_usd);
 const risk=record(item.riskAssessment),h=item.timeframes?.h1,m=item.timeframes?.m5;
 if(risk?.critical===true&&risk.status==='RISK_DETECTED'){
  next.state='EXITED';next.exit_reason='CRITICAL_RISK_CONFIRMED';return next;
 }
 const liquidityCollapse=finite(item.liquidity_usd)&&item.liquidity_usd<1000;
 const weak=liquidityCollapse||(finite(item.score)&&item.score<RADAR_POLICY.weakScore&&finite(h?.changePct)&&h.changePct<0&&finite(m?.changePct)&&m.changePct<0&&item.price_usd<track.first_price);
 if(weak){
  // Independent observations separated by at least five minutes.
  if(!track.weak_since){next.weak_since=item.observed_at;next.weak_count=1;next.payload.lastWeakSampleAt=item.observed_at;}
  else if(stamp(item.observed_at)-stamp(track.payload.lastWeakSampleAt||track.weak_since)>=RADAR_POLICY.checkpointMs){next.weak_count=track.weak_count+1;next.payload.lastWeakSampleAt=item.observed_at;}
  next.state='WEAK';
  if(next.weak_count>=RADAR_POLICY.weakObservations&&stamp(item.observed_at)-stamp(next.weak_since)>=RADAR_POLICY.minWeakSpanMs){next.state='EXITED';next.exit_reason=liquidityCollapse?'SUSTAINED_LIQUIDITY_COLLAPSE':'SUSTAINED_WEAKNESS_BELOW_ENTRY';}
 }else{next.state='ACTIVE';next.weak_count=0;next.weak_since=null;next.payload.lastWeakSampleAt=null;}
 return next;
}
export function trackItem(t,now=Date.now()){
 const item={...t.payload.item},fresh=freshItem(item,now),status=fresh?t.payload.dataStatus||'FRESH':'STALE';
 const pattern=t.payload.pattern||null,patternCurrent=Number.isFinite(stamp(pattern?.lastClosedAt))&&now-stamp(pattern.lastClosedAt)<=10*60000;
 return {...item,persisted:true,dataStatus:fresh?'LIVE':'STALE',tracking:{version:RADAR_VERSION,episodeId:t.episode_id,
  state:t.state,label:LABELS[t.state],pattern,patternLabel:['STAIRCASE','VERTICAL','CONSOLIDATION'].includes(pattern?.type)?patternCurrent?LABELS[pattern.type]:'POLA LAMA':null,
  firstSeenAt:t.first_seen_at,firstPrice:t.first_price,firstScore:t.first_score,lastObservedAt:t.last_observed_at,
  changeSinceFoundPct:(t.last_price/t.first_price-1)*100,observedPeakReturnPct:(t.peak_price/t.first_price-1)*100,
  peakDefinition:'Highest sampled price, not continuous ATH',dataStatus:status,dataLabel:LABELS[status]||null,
  exitReason:t.exit_reason,weakCount:t.weak_count}};
}
export function mergeRadar(base,monitor){
 if(!monitor||monitor.version!==RADAR_VERSION)return base;
 const blocked=new Set(monitor.exitedMints||[]),seen=new Set(),items=[];
 for(let item of [...(monitor.items||[]),...(base?.items||[])]){
  if(!item?.mint||seen.has(item.mint)||blocked.has(item.mint))continue;
  if(item.tracking&&!freshItem(item)){item={...item,dataStatus:'STALE',tracking:{...item.tracking,dataStatus:'STALE',dataLabel:LABELS.STALE}};}
  seen.add(item.mint);items.push(item);
 }
 items.sort((a,b)=>(finite(b.score)?b.score:-1)-(finite(a.score)?a.score:-1)||String(a.tracking?.firstSeenAt||a.observed_at).localeCompare(String(b.tracking?.firstSeenAt||b.observed_at))||a.mint.localeCompare(b.mint));
 return {...base,items,radarTracking:{...monitor,items:undefined,exitedMints:undefined},generatedAt:new Date().toISOString()};
}
