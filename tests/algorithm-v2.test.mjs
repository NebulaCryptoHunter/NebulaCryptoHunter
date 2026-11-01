import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {scoreCandidate,MODEL} from '../backend/workers/scoring-v2.mjs';
import {scanPairs} from '../backend/workers/market-observation.mjs';
import {selectScanMints} from '../backend/workers/scanner-selection.mjs';
import {pointOutcome,classificationMetrics,analyticsSQL} from '../backend/workers/evaluation-metrics.mjs';
import {getTokenPrice,evaluatePrediction} from '../backend/workers/nebula-evaluation.mjs';
const now=Date.parse('2026-11-01T13:00:00Z');
const A='So11111111111111111111111111111111111111112',B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const observation=(patch={})=>({priceUsd:1,liquidityUsd:500000,volume24h:2500000,change24h:24,observedAt:new Date(now).toISOString(),buys24h:700,sells24h:300,timeframes:{h1:{changePct:8,buys:80,sells:20},m5:{changePct:2}},risk:{rugCheck:'SAFE',whaleConcentration:'SAFE'},...patch});
const score=c=>scoreCandidate(c,{now});
test('ranking is explainable, bounded and not a probability or BUY',()=>{const r=score(observation());assert.equal(r.model,MODEL);assert.equal(r.decision,'REVIEW');assert.equal(r.confidence,null);assert.equal(r.probabilityOfProfit,null);assert.equal(r.autoTrade,false);assert.equal(r.dataCoverage,100);assert.ok(r.components.buyPressure>50);assert.ok(r.score>=0&&r.score<=100)});
test('falling price is not rewarded by extreme turnover',()=>{
 const healthy=score(observation()),dump=score(observation({change24h:-80,timeframes:{h1:{changePct:-30,buys:10,sells:90}}})),wash=score(observation({volume24h:1e10,change24h:-80,timeframes:{h1:{changePct:-30,buys:10,sells:90}}}));
 assert.ok(dump.score<healthy.score);assert.ok(wash.score<healthy.score);assert.equal(wash.decision,'WATCH');assert.ok(wash.riskFlags.includes('EXTREME_TURNOVER'));assert.ok(dump.riskFlags.includes('SELL_PRESSURE'));
});
test('overheated momentum receives a reversal warning rather than a better score',()=>{const r=score(observation({change24h:1200}));assert.equal(r.decision,'WATCH');assert.ok(r.riskFlags.includes('OVERHEATED_MOMENTUM'));assert.ok(r.score<score(observation()).score)});
test('missing, boolean, nonpositive or nonfinite core inputs cannot be scored',()=>{for(const patch of [{priceUsd:0},{priceUsd:true},{priceUsd:NaN},{liquidityUsd:Infinity},{liquidityUsd:0},{volume24h:-1},{change24h:-101},{change24h:null}]){const r=score(observation(patch));assert.equal(r.decision,'INSUFFICIENT_DATA');assert.equal(r.score,null)}});
test('overflow in the volume/liquidity ratio cannot enter ranking',()=>assert.equal(score(observation({volume24h:1e300,liquidityUsd:1e-300})).score,null));
test('unknown counts stay unknown and one buy cannot imply robust demand',()=>{
 const absent=score(observation({buys24h:null,sells24h:null,timeframes:{h1:{changePct:8}}}));assert.equal(absent.components.buyPressure,null);assert.ok(absent.dataCoverage<100);assert.equal(absent.decision,'WATCH');
 const one=score(observation({timeframes:{h1:{changePct:8,buys:1,sells:0}}}));assert.ok(one.components.buyPressure<55);assert.equal(one.decision,'WATCH');
});
test('stale and future observations cannot qualify for REVIEW',()=>{for(const time of [now-16*60000,now+2*60000]){const r=score(observation({observedAt:new Date(time).toISOString()}));assert.equal(r.decision,'WATCH');assert.ok(r.score<=30)}});
test('ranking does not change if future outcomes are appended to input',()=>{const c=observation();assert.deepEqual(score({...c,futurePrice:9999,roi_pct:1e6,outcome:'WIN'}),score(c))});
test('unknown security never qualifies for REVIEW even when momentum is strong',()=>{const r=score(observation({risk:{}}));assert.equal(r.decision,'WATCH');assert.ok(r.reasons.some(x=>x.includes('unverified')))});
test('normalization preserves m5/h1/h24 and distinguishes absent counts from zero',()=>{
 const p={chainId:'solana',pairAddress:B,baseToken:{address:A},quoteToken:{address:B},priceUsd:'1',liquidity:{usd:'50000'},volume:{h24:'1000',h1:'100'},priceChange:{h24:'5',h1:'2',m5:'1'}};
 const [missing]=scanPairs([p]);assert.equal(missing.buys24h,null);assert.equal(missing.momentum.transactionBuyRatio,null);assert.equal(missing.timeframes.h1.volumeUsd,100);assert.equal(missing.timeframes.m5.changePct,1);
 const [zero]=scanPairs([{...p,txns:{h24:{buys:0,sells:0}}}]);assert.equal(zero.buys24h,0);assert.equal(zero.momentum.transactionBuyRatio,null);
});
test('pool selection prefers liquidity, deduplicates pairs and never parses booleans as prices',()=>{
 const p={chainId:'solana',pairAddress:B,baseToken:{address:A},quoteToken:{address:B},priceUsd:true,liquidity:{usd:50000},volume:{h24:1e9},priceChange:{h24:2}};
 const rows=scanPairs([p,p,{...p,pairAddress:A,liquidity:{usd:100000},volume:{h24:1}}]);assert.equal(rows.length,2);assert.equal(rows[0].pairAddress,A);assert.equal(rows[1].priceUsd,null);
});
test('follow-up selection gives due tokens a slot while preserving new discovery capacity and cursor',()=>{
 const pool=Array.from({length:20},(_,i)=>'1'.repeat(31)+String.fromCharCode(65+i).replace('I','Z'));
 const due=[A,B,...pool.slice(0,7)];const r=selectScanMints(pool,due);assert.equal(r.selected.length,12);assert.equal(new Set(r.selected).size,12);assert.ok(r.selected.includes(A));assert.ok(r.selected.includes(B));assert.ok(r.nextCursor>0);assert.equal(r.followupCount,6);
});
test('point outcomes leave unmeasurable ATH/drawdown/rug/calibration fields empty',()=>{const r=pointOutcome({entryPrice:2,exitPrice:.02,decision:'WATCH'});assert.equal(r.directionalScore,null);assert.equal(r.successScore,null);assert.equal(r.maxDrawdown,null);assert.equal(r.riskScore,null);assert.equal(r.confidenceCalibrationScore,null);assert.equal(r.evaluationConfidence,null);assert.equal(r.isTradePnL,false);assert.equal(r.outcome,'NEGATIVE_RETURN')});
test('return calculations reject impossible inputs and confidence zero is never replaced with 50',()=>{assert.equal(pointOutcome({entryPrice:0,exitPrice:1}),null);assert.equal(pointOutcome({entryPrice:true,exitPrice:1}),null);assert.equal(pointOutcome({entryPrice:1e-300,exitPrice:1e300}),null);assert.equal(pointOutcome({entryPrice:1,exitPrice:2,decision:'BUY'}).confidenceCalibrationScore,null)});
test('classification uses proper denominators and undefined values remain null',()=>{assert.deepEqual(classificationMetrics(),{tp:0,fp:0,fn:0,tn:0,samples:0,precision:null,recall:null,f1:null,accuracy:null});const r=classificationMetrics({tp:2,fp:1,fn:2,tn:5});assert.equal(r.precision,2/3);assert.equal(r.recall,.5);assert.equal(r.f1,4/7);assert.ok(r.accuracy<=1);assert.throws(()=>classificationMetrics({tp:-1}))});
test('analytics exclude other windows, legacy models, WATCH and duplicate measurements',()=>{
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE predictions(id INTEGER PRIMARY KEY,decision TEXT);CREATE TABLE evaluations(id INTEGER PRIMARY KEY,prediction_id INTEGER,actual_roi REAL,evaluation_window TEXT,engine_version TEXT,evaluation_status TEXT,evaluated_at TEXT);INSERT INTO predictions VALUES(1,'BUY'),(2,'BUY'),(3,'AVOID'),(4,'AVOID'),(5,'WATCH');`);
 const insert=db.prepare("INSERT INTO evaluations VALUES(?,?,?,?,?,'COMPLETED','2026-11-01T13:00:00Z')");
 for(const row of [[1,1,10,'30m','V111.0.0'],[2,1,20,'2h','V111.0.0'],[3,1,30,'30m','V111.0.0'],[4,2,-2,'30m','V111.0.0'],[5,3,10,'30m','V111.0.0'],[6,4,-2,'30m','V111.0.0'],[7,5,100,'30m','V111.0.0'],[8,2,10,'30m','V109']])insert.run(...row);
 const r=db.prepare(analyticsSQL).get();assert.deepEqual([r.tp,r.fp,r.fn,r.tn],[1,1,1,1]);assert.equal(r.total_evaluations,8);assert.equal(r.avg_buy_roi,4);db.close();
});
test('evaluation price fallback obeys a per-run budget and coalesces repeated token requests',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{calls++;return String(url).includes('dexscreener')?new Response('',{status:429}):Response.json({data:{id:'solana_'+A,attributes:{price_usd:'2'}}})};
 try{const budget={remaining:1,pending:new Map()};const [a,b]=await Promise.all([getTokenPrice(A,budget),getTokenPrice(A,budget)]);assert.equal(a.price,2);assert.equal(b.source,'geckoterminal');assert.equal(calls,2);assert.equal(await getTokenPrice(B,budget),null);assert.equal(calls,2)}finally{globalThis.fetch=old}
});
test('legacy decision gate rejects out-of-range and coercible scores',async()=>{
 const {evaluatePrediction}=await import('../backend/prediction-engine-v2.mjs');
 const v={token_ca:A,entry_price:1,liquidity_usd:100000,holder_count:100,rug_status:'SAFE',mint_authority_enabled:false,freeze_authority_enabled:false,dex_verified:true,helius_verified:true,rug_verified:true,quality_score:90,security_score:90,confidence_score:90,ai_score:90};
 for(const x of [101,'90',true,null,Infinity])assert.equal(evaluatePrediction({...v,ai_score:x}).decision,'WATCH');
 for(const key of ['quality_score','security_score','confidence_score'])assert.equal(evaluatePrediction({...v,[key]:500}).passed_gate,false);
});
test('legacy evaluator persists measurable returns and null unknown fields in the actual SQL contract',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE evaluations(id INTEGER PRIMARY KEY,prediction_id INTEGER NOT NULL,token_ca TEXT NOT NULL,directional_score REAL,multiplier_score REAL,timing_score REAL,risk_score REAL,opportunity_cost_score REAL,sustainability_score REAL,confidence_calibration_score REAL,success_score REAL,actual_roi REAL,actual_multiplier REAL,max_drawdown REAL,time_to_ath INTEGER,sustained_hours REAL,evaluation_confidence INTEGER,market_regime TEXT,evaluation_window TEXT,engine_version TEXT,notes TEXT,evaluated_at TEXT);CREATE TABLE predictions(id INTEGER PRIMARY KEY,success_score REAL,actual_multiplier REAL);INSERT INTO predictions VALUES(1,NULL,NULL);`);
 const adapter={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)},async run(){return db.prepare(sql).run(...args)}}}};
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({pairs:[{chainId:'solana',baseToken:{address:A},quoteToken:{address:B},priceUsd:'2',liquidity:{usd:10000}}]});
 try{await evaluatePrediction(adapter,{id:1,token_ca:A,entry_price:1,decision:'WATCH',created_at:new Date(Date.now()-31*60000).toISOString()},'30m','test',{remaining:1,pending:new Map()});const row=db.prepare('SELECT * FROM evaluations').get();assert.equal(row.actual_roi,100);for(const key of ['success_score','directional_score','max_drawdown','time_to_ath','risk_score','timing_score','sustainability_score','confidence_calibration_score','evaluation_confidence'])assert.equal(row[key],null);assert.equal(row.engine_version,'V111.0.0');assert.match(row.notes,/POINT_IN_TIME_V2/)}finally{globalThis.fetch=old;db.close()}
});
test('actual scanner, AI worker, SQLite persistence and candidate trigger agree on the V2 contract',async()=>{
 const fs=await import('node:fs');const {runScheduledScan}=await import('../backend/workers/nebula-scanner.mjs');const {default:engine}=await import('../backend/workers/nebula-ai-engine.mjs');
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('backend/migrations/0008_unified_scanner_schema.sql','utf8'));
 const adapter={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}}}},async batch(statements){const results=[];db.exec('BEGIN');try{for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};
 const old=globalThis.fetch;let upstream=0;
 globalThis.fetch=async url=>{upstream++;return String(url).includes('token-profiles')?Response.json([{chainId:'solana',tokenAddress:A}]):Response.json([{chainId:'solana',pairAddress:B,baseToken:{address:A},quoteToken:{address:B},priceUsd:'2',liquidity:{usd:500000},volume:{h24:2500000,h1:150000},priceChange:{h24:20,h1:5,m5:1},txns:{h24:{buys:700,sells:300},h1:{buys:80,sells:20}}}])};
 try{
  const env={STAGE_DB:adapter,INTERNAL_TOKEN:'test-only',AI_ENGINE:{fetch:(url,init)=>engine.fetch(new Request(url,init),{INTERNAL_TOKEN:'test-only'})}};
  const event={scheduledTime:Date.now()};const r=await runScheduledScan(event,env);assert.equal(r.status,'COMPLETED');assert.equal(r.snapshotCount,1);
  const saved=db.prepare('SELECT * FROM engine_scores').get();assert.equal(saved.model,MODEL);assert.equal(JSON.parse(saved.payload_json).confidence,null);assert.ok(saved.score>0);
  const c=db.prepare('SELECT * FROM prediction_candidates').get();assert.equal(c.model,MODEL);assert.equal(c.decision,'WATCH');assert.equal(c.risk_verified,0);
  assert.equal((await runScheduledScan(event,env)).status,'SKIPPED_DUPLICATE');assert.equal(upstream,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM scanner_snapshots').get().n,1);
 }finally{globalThis.fetch=old;db.close()}
});
