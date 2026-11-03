import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {newTrack,updateTrack,mergeRadar,RADAR_VERSION,trackItem} from '../backend/workers/radar-policy.mjs';
import {closedCandles,detectPattern} from '../backend/workers/radar-patterns.mjs';
import {admitTracks,hydrateTrack,readTrackingFeed,trackStatements,publishFeed,evaluateSignals,trackingAnalytics} from '../backend/workers/radar-store.mjs';
import monitor,{runMonitor,writeSnapshotBackup} from '../backend/workers/radar-monitor.mjs';
import {monitorMarketRoute} from '../backend/workers/radar-market.mjs';
import {scoreCandidate} from '../backend/workers/scoring-v2.mjs';
import gateway from '../backend/workers/frontend-gateway.mjs';
const now=Date.parse('2026-11-03T08:00:00Z'),at=x=>new Date(x).toISOString();
const A='So11111111111111111111111111111111111111112',B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
function item(patch={}){return {mint:A,pair_address:B,observed_at:at(now),source_as_of:at(now),price_usd:1,liquidity_usd:100000,volume_24h:300000,change_24h:10,score:69,model:'heuristic-v4.0.0',dataCoverage:100,timeframes:{h1:{changePct:15},m5:{changePct:3}},riskAssessment:{status:'UNVERIFIED',critical:false},...patch};}
function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE scanner_snapshots(id INTEGER PRIMARY KEY,mint TEXT,pair_address TEXT,observed_at TEXT,liquidity_usd REAL,volume_24h REAL,change_24h REAL,payload_json TEXT,UNIQUE(mint,pair_address,observed_at));');
 sqlite.exec(`CREATE VIEW nebula_unified_records_v1 AS SELECT NULL record_key,NULL record_source,NULL source_id,NULL mint,NULL symbol,NULL decision,NULL ai_score,NULL observed_at,NULL pair_address,NULL model,NULL evaluation_status,NULL roi_pct WHERE 0;`);
 sqlite.exec(readFileSync(new URL('../backend/migrations/0011_persistent_radar.sql',import.meta.url),'utf8'));
 const db={prepare(sql){const make=args=>({bind(...a){return make(a)},async all(){const results=sqlite.prepare(sql).all(...args);return {results,meta:{rows_read:results.length,rows_written:0}}},async first(){return sqlite.prepare(sql).get(...args)||null},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid),rows_written:Number(r.changes),rows_read:0}}}});return make([])},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}}};
 // D1 batch returns query rows for SELECT, including mixed batches.
 db.prepare=(sql=>{const original=db.prepare;return function(sql){const s=original.call(db,sql);const decorate=x=>{x._select=/^\s*(SELECT|WITH)\b/i.test(sql);const bind=x.bind;x.bind=(...a)=>decorate(bind(...a));return x};return decorate(s)}})();
 db.batch=async statements=>{sqlite.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await (s._select?s.all():s.run()));sqlite.exec('COMMIT');return out}catch(e){sqlite.exec('ROLLBACK');throw e}};
 return {db,sqlite};
}
const candles=(prices,volumes=prices.map(()=>100))=>({meta:{base:{address:A}},data:{attributes:{ohlcv_list:prices.map((p,i)=>[Math.floor(now/60000)*60-(prices.length-i)*60,p,p*1.001,p*.999,p,volumes[i]])}}});
test('durable snapshot backup is limited to one write per five minutes and keeps the observation time',async()=>{
 const {db,sqlite}=database(),saved=[],env={DB:db,SNAPSHOT_BACKUP:{async put(key,value){saved.push({key,value})}}};
 const feed={version:RADAR_VERSION,items:[],generatedAt:at(now-60000)};
 const first=await writeSnapshotBackup(env,feed,{now});assert.equal(first.status,'READY');assert.equal(saved.length,1);
 const previous=JSON.parse(sqlite.prepare("SELECT value_json FROM radar_runtime WHERE key='snapshot-backup'").get().value_json);
 await writeSnapshotBackup(env,feed,{now:now+60000,previous});assert.equal(saved.length,1);
 await writeSnapshotBackup(env,feed,{now:now+300000,previous});assert.equal(saved.length,2);
 assert.equal(JSON.parse(saved[1].value).generatedAt,feed.generatedAt);assert.equal(first.snapshotAt,feed.generatedAt);
});
test('backup provider failure is recorded without aborting the monitor or retrying every minute',async()=>{
 const {db,sqlite}=database();let calls=0;
 const result=await runMonitor({DB:db,SNAPSHOT_BACKUP:{async put(){calls++;throw Error('provider quota')}}},{now});
 assert.equal(result.status,'COMPLETED');assert.equal(calls,1);
 const backup=JSON.parse(sqlite.prepare("SELECT value_json FROM radar_runtime WHERE key='snapshot-backup'").get().value_json);
 assert.equal(backup.status,'FAILED');assert.equal(backup.lastSuccessAt,null);assert.equal(backup.nextAttemptAt,now+300000);
 const health=JSON.parse(sqlite.prepare("SELECT value_json FROM radar_runtime WHERE key='monitor-health'").get().value_json);
 assert.equal(health.status,'RUNNING');assert.equal(health.snapshotBackup.status,'FAILED');
});
test('D1 outage serves the durable KV snapshot without refreshing old prices or source timestamps',async()=>{
 const old=Date.now()-3600000,t=newTrack(item({observed_at:at(old),source_as_of:at(old)}),old);
 const feed={version:RADAR_VERSION,items:[trackItem(t,old)],generatedAt:at(old)};
 const response=await monitor.fetch(new Request('https://monitor.internal/feed'),{DB:{prepare(){throw Error('D1_DAILY_READ_LIMIT')}},SNAPSHOT_BACKUP:{async get(){return feed}}});
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.backupBackend,'KV');assert.equal(data.generatedAt,at(old));
 const merged=mergeRadar({items:[]},data);assert.equal(merged.items[0].tracking.dataStatus,'STALE');assert.equal(merged.items[0].observed_at,at(old));
});
test('an invalid durable snapshot never becomes an available tracking feed',async()=>{
 const response=await monitor.fetch(new Request('https://monitor.internal/feed'),{DB:{prepare(){throw Error('D1 unavailable')}},SNAPSHOT_BACKUP:{async get(){return {version:'wrong',items:[]}}}});
 assert.equal(response.status,503);assert.equal((await response.json()).error,'TRACKING_UNAVAILABLE');
});
test('eligible candidate is retained across empty and unrelated discovery feeds, sorted by real score',()=>{
 const t=newTrack(item(),now);assert.ok(t);const tracked=trackItem(t,now);
 const result=mergeRadar({items:[item({mint:B,score:70})]},{version:RADAR_VERSION,items:[tracked],exitedMints:[]});
 assert.deepEqual(result.items.map(x=>x.mint),[B,A]);assert.equal(mergeRadar({items:[]},{version:RADAR_VERSION,items:[tracked]}).items.length,1);
 assert.equal(newTrack(item({observed_at:at(now-3600000)}),now),null);
 assert.equal(newTrack(item({score:39,riskAssessment:{status:'RISK_DETECTED'}}),now),null);
 const compact=mergeRadar({items:[],counts:{total_records:2}},{version:RADAR_VERSION,items:[tracked],legacy:{items:[item()],counts:{total_records:2}}});
 assert.equal(compact.counts.total_records,2);assert.equal(JSON.parse(JSON.stringify(compact)).radarTracking.legacy,undefined);
});
test('missing provider data, duplicates and a single reversal never remove a candidate',()=>{
 const t=newTrack(item(),now);const missing=updateTrack(t,null,{now:now+60000});assert.equal(missing.state,'ACTIVE');assert.equal(missing.payload.dataStatus,'POOL_MISSING');
 const weak=item({observed_at:at(now+300000),source_as_of:at(now+300000),score:25,price_usd:.8,timeframes:{h1:{changePct:-5},m5:{changePct:-3}}});
 const first=updateTrack(t,weak,{now:now+300000});assert.equal(first.state,'WEAK');assert.equal(first.weak_count,1);
 const duplicate=updateTrack(first,weak,{now:now+360000});assert.equal(duplicate.weak_count,1);assert.notEqual(duplicate.state,'EXITED');
 const restored=updateTrack(first,item({observed_at:at(now+600000),source_as_of:at(now+600000),price_usd:1.1}),{now:now+600000});assert.equal(restored.state,'ACTIVE');assert.equal(restored.weak_count,0);
});
test('three independent weak observations spanning ten minutes archive with a recorded reason',()=>{
 let t=newTrack(item(),now);
 for(const delta of [300000,600000,900000])t=updateTrack(t,item({observed_at:at(now+delta),source_as_of:at(now+delta),score:20,price_usd:.7,timeframes:{h1:{changePct:-10},m5:{changePct:-5}}}),{now:now+delta});
 assert.equal(t.state,'EXITED');assert.equal(t.exit_reason,'SUSTAINED_WEAKNESS_BELOW_ENTRY');
 assert.equal(mergeRadar({items:[item()]},{version:RADAR_VERSION,items:[],exitedMints:[A]}).items.length,0);
});
test('minute-by-minute monitoring confirms weakness at spaced samples rather than resetting its clock',()=>{
 let t=newTrack(item(),now);
 for(let minute=1;minute<=11;minute++)t=updateTrack(t,item({observed_at:at(now+minute*60000),source_as_of:at(now+minute*60000),score:20,price_usd:.7,timeframes:{h1:{changePct:-10},m5:{changePct:-5}}}),{now:now+minute*60000});
 assert.equal(t.state,'EXITED');assert.equal(t.weak_count,3);
});
test('new download timestamps cannot turn the same cached source quote into confirmation',()=>{
 const t=newTrack(item(),now),repeat=updateTrack(t,item({observed_at:at(now+60000),source_as_of:at(now),score:20,price_usd:.7,timeframes:{h1:{changePct:-10},m5:{changePct:-5}}}),{now:now+60000});
 assert.equal(repeat.weak_count,0);assert.equal(repeat.last_price,1);
});
test('confirmed critical risk exits immediately; a lower overheating score alone does not',()=>{
 const t=newTrack(item(),now),later={observed_at:at(now+60000),source_as_of:at(now+60000)};
 assert.equal(updateTrack(t,item({...later,score:49,price_usd:1.5,riskFlags:['OVERHEATED_MOMENTUM']}),{now:now+60000}).state,'ACTIVE');
 const bad=updateTrack(t,item({...later,riskAssessment:{status:'RISK_DETECTED',critical:true}}),{now:now+60000});assert.equal(bad.exit_reason,'CRITICAL_RISK_CONFIRMED');
});
test('closed candle validation rejects wrong token, gaps, malformed OHLC and open candles',()=>{
 const payload=candles(Array(25).fill(1));assert.equal(closedCandles(payload,{mint:A,pairAddress:B,now}).ok,true);
 assert.equal(closedCandles(payload,{mint:B,pairAddress:B,now}).ok,false);
 const gap=structuredClone(payload);gap.data.attributes.ohlcv_list.splice(15,1);assert.equal(closedCandles(gap,{mint:A,pairAddress:B,now}).reason,'CANDLE_GAPS');
 const bad=structuredClone(payload);bad.data.attributes.ohlcv_list[1][2]=.5;assert.equal(closedCandles(bad,{mint:A,pairAddress:B,now}).ok,false);
 const open=structuredClone(payload);open.data.attributes.ohlcv_list.push([now/1000,10,10,10,10,10000]);assert.equal(closedCandles(open,{mint:A,pairAddress:B,now}).candles.length,25);
});
test('vertical detector needs independent volume evidence, not just a large return',()=>{
 const prices=[...Array(22).fill(1),1.06,1.15,1.3],volumes=[...Array(22).fill(100),500,500,500];
 const parsed=closedCandles(candles(prices,volumes),{mint:A,pairAddress:B,now});assert.equal(detectPattern(parsed,{now}).type,'VERTICAL');
 assert.notEqual(detectPattern(closedCandles(candles(prices,Array(25).fill(0)),{mint:A,pairAddress:B,now}),{now}).type,'VERTICAL');
});
test('staircase detector confirms rising swing highs/lows only after their confirming candles',()=>{
 const wave=[0,1,2,3,2,1,0,1],prices=Array.from({length:40},(_,i)=>1+Math.floor(i/8)*.08+wave[i%8]*.02);
 const pattern=detectPattern(closedCandles(candles(prices),{mint:A,pairAddress:B,now}),{now});assert.equal(pattern.type,'STAIRCASE');assert.equal(pattern.detectedAt,at(now));
 assert.notEqual(detectPattern(closedCandles(candles(Array(40).fill(1)),{mint:A,pairAddress:B,now}),{now}).type,'STAIRCASE');
});
test('D1 migration and admissions are idempotent; histories persist across feed replacement',async()=>{
 const {db,sqlite}=database();await admitTracks(db,[item(),item()],{now});await admitTracks(db,[item()],{now:now+60000});
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM radar_tracks').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM radar_signals').get().n,4);
 const feed=await publishFeed(db,{now});assert.equal(feed.items[0].tracking.firstPrice,1);
 assert.equal((await readTrackingFeed(db)).items.length,1);
 assert.equal(sqlite.prepare("SELECT record_source FROM nebula_unified_records_v2").get().record_source,'TRACKING');
});
test('algorithm outcomes are horizon-specific and missing/wrong-pool/stale-source quotes never become losses',async()=>{
 const {db,sqlite}=database();await admitTracks(db,[item()],{now});
 await evaluateSignals(db,[item({pair_address:A,price_usd:2,observed_at:at(now+1800000),source_as_of:at(now+1800000)})],{now:now+1800000});
 assert.equal(sqlite.prepare("SELECT status FROM radar_signals WHERE horizon_seconds=1800").get().status,'PENDING');
 await evaluateSignals(db,[item({price_usd:2,observed_at:at(now+1800000),source_as_of:at(now)})],{now:now+1800000});
 assert.equal(sqlite.prepare("SELECT status FROM radar_signals WHERE horizon_seconds=1800").get().status,'PENDING');
 await evaluateSignals(db,[item({price_usd:1.2,observed_at:at(now+1800000),source_as_of:at(now+1800000)})],{now:now+1800000});
 assert.equal(sqlite.prepare("SELECT status FROM radar_signals WHERE horizon_seconds=1800").get().status,'SUCCESS');
 await evaluateSignals(db,[],{now:now+9000000});assert.equal(sqlite.prepare("SELECT status FROM radar_signals WHERE horizon_seconds=7200").get().status,'INDETERMINATE');
 const stats=await trackingAnalytics(db);assert.ok(stats.rows.some(x=>x.horizon_seconds===1800&&x.status==='SUCCESS'));assert.equal(stats.calibrated,false);
});
test('market route is private and cannot be called through the public API hostname',async()=>{
 const response=await monitorMarketRoute(new Request('https://api.nebulacryptohunter.space/api/v1/monitor-market?mints='+A),{});assert.equal(response.status,403);
});
test('retained tracking is served without calling discovery when legacy reads are unavailable',async()=>{
 const {db}=database(),tracked=trackItem(newTrack(item(),now),now);let upstream=0;
 const env={RESEARCH_DB:db,MONITOR:{fetch:async()=>Response.json({version:RADAR_VERSION,items:[tracked],exitedMints:[]})},API:{fetch:async()=>{upstream++;throw Error('discovery must not run')}}};
 const r=await gateway.fetch(new Request('https://nebulacryptohunter.space/api/research/latest'),env);
 assert.equal(r.status,200);assert.equal((await r.json()).items[0].mint,A);assert.equal(upstream,0);
});
test('positive return below the declared target is FAILED_TARGET, not a fabricated successful trade',async()=>{
 const {db,sqlite}=database();await admitTracks(db,[item()],{now});
 await evaluateSignals(db,[item({price_usd:1.05,observed_at:at(now+1800000),source_as_of:at(now+1800000)})],{now:now+1800000});
 const outcome=sqlite.prepare('SELECT status,roi_pct FROM radar_signals WHERE horizon_seconds=1800').get();assert.equal(outcome.status,'FAILED_TARGET');assert.ok(outcome.roi_pct>0);
});
test('an existing monitoring lease prevents a duplicate invocation',async()=>{
 const {db}=database();await db.prepare("INSERT INTO radar_runtime VALUES('monitor-lock',?,?)").bind(JSON.stringify({until:now+30000,lease:'another'}),at(now)).run();
 assert.equal((await runMonitor({DB:db},{now})).status,'BUSY');
});
test('consolidation is measured from actual closed candles following an earlier rise',()=>{
 const prices=[...Array.from({length:20},(_,i)=>1+i*.01),...Array(5).fill(1.19)];
 assert.equal(detectPattern(closedCandles(candles(prices),{mint:A,pairAddress:B,now}),{now}).type,'CONSOLIDATION');
});
test('monitor updates a locked pool and persists across a failed subsequent provider call',async()=>{
 const {db,sqlite}=database();await admitTracks(db,[item()],{now});
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json(candles(Array(40).fill(1)));
 const c={base:{mint:A,symbol:'TEST'},quote:{mint:B},pairAddress:B,observedAt:at(now+60000),sourceAsOf:at(now+60000),priceUsd:1.05,liquidityUsd:100000,volume24h:300000,change24h:15,timeframes:{h1:{changePct:15,volumeUsd:100000,buys:80,sells:20},m5:{changePct:3,volumeUsd:10000,buys:20,sells:5}},buys24h:100,sells24h:30,poolCreatedAt:at(now-86400000),source:'dexscreener'};
 const env={DB:db,MARKET_API:{fetch:async()=>Response.json({observations:[c],attempts:[]})}};
 try{
  const result=await runMonitor(env,{now:now+60000});assert.equal(result.status,'COMPLETED');assert.equal(sqlite.prepare('SELECT last_price FROM radar_tracks').get().last_price,1.05);
  const bad=await runMonitor({...env,MARKET_API:{fetch:async()=>{throw Error('test upstream outage')}}},{now:now+120000}).catch(()=>null);assert.equal(bad,null);
  assert.equal((await readTrackingFeed(db)).items[0].mint,A);assert.notEqual(sqlite.prepare('SELECT state FROM radar_tracks').get().state,'EXITED');
 }finally{globalThis.fetch=original;}
});
