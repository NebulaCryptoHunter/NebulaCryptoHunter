import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performanceMetrics,withPerformance} from '../backend/workers/performance-metrics.mjs';
import {modelValidation} from '../backend/workers/model-validation.mjs';
import {MODEL} from '../backend/workers/scoring-v2.mjs';
import {scoringEvidence} from './fixtures/scoring-evidence.mjs';
import gateway from '../backend/workers/frontend-gateway.mjs';
const now=Date.parse('2026-11-03T00:00:00Z'),at=new Date(now).toISOString();
const A='So11111111111111111111111111111111111111112',B='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const item=(patch={})=>({mint:A,pair_address:B,price_usd:1,liquidity_usd:500000,score:66,model:MODEL,observed_at:at,decision:'WATCH',...scoringEvidence(A,at),...patch});
const metrics=data=>performanceMetrics(data,{now});
const candidate=(patch={})=>({id:1,model:MODEL,ai_score:66,observed_at:new Date(now-3600000).toISOString(),evaluation_observed_at:at,evaluation_status:'COMPLETED',entry_price:1,exit_price:1.2,roi_pct:20,...patch});
const html=readFileSync('index.html','utf8');
function ui(){
 const clock={now};class Clock extends Date{static now(){return clock.now;}}
 const elements={aiHealthDash:{innerHTML:''},hunterActiveTargetCount:{},hunterTrackedValue:{},hunterTrackedCaption:{},hunterSetupValue:{},hunterWatchValue:{},hunterEvaluationValue:{},hunterCalibrationStatus:{},hunterCalibratedValue:{closest:()=>null},hunterPerformanceAsOf:{}};
 const ctx=vm.createContext({S:{},CONFIG:{ENDPOINTS:['DEX','HELIUS','RUGCHECK']},ep:{},eph:{},Date:Clock,$:id=>elements[id],escapeHTML:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(html.slice(html.indexOf('function currentProviderState('),html.indexOf('function showIndicatorCatalog(')),ctx);
 return {ctx,clock,elements};
}
test('all token coverage uses exactly the first visible pool per mint, including duplicate pools',()=>{
 const p=metrics({items:[item({price_usd:0}),item({pair_address:'another'}),item({mint:B})]});
 assert.equal(p.tokenCount,2);assert.equal(p.metrics.price.numerator,1);assert.equal(p.metrics.pool.numerator,1);
 assert.equal(p.metrics.scored.numerator,2);assert.equal(p.metrics.price.value,50);
});
test('TRACKED uses persistent ACTIVE plus WEAK totals, independent of feed size and EXITED history',()=>{
 const data={items:[item()],radarTracking:{version:'radar-v1.0.0',counts:{ACTIVE:7,WEAK:2,EXITED:11}}};
 assert.equal(metrics(data).overview.tracked,9);
 assert.equal(metrics({...data,radarTracking:{version:'radar-v1.0.0',counts:{}}}).overview.tracked,0);
 for(const radarTracking of [null,{version:'old',counts:{}},{version:'radar-v1.0.0',counts:{ACTIVE:-1}},{version:'radar-v1.0.0',counts:{ACTIVE:'7'}}])assert.equal(metrics({...data,radarTracking}).overview.tracked,null);
});
test('ACTIVE SETUPS counts unique fresh V4 REVIEW with current passing checks, excluding weak and exited tokens',()=>{
 assert.equal(metrics({items:[item({decision:'REVIEW'}),item({decision:'REVIEW',pair_address:'second-pool'})]}).overview.activeSetups,1);
 for(const patch of [{decision:'WATCH'},{model:'heuristic-v3.0.0'},{observed_at:new Date(now-16*60000).toISOString()},{source_as_of:new Date(now-3600000).toISOString()},{verificationEvidence:null,tokenMetadata:null,riskAssessment:{status:'CHECKS_PASSED'}},{tracking:{state:'WEAK'}},{tracking:{state:'EXITED'}}])
  assert.equal(metrics({items:[item({decision:'REVIEW',...patch})]}).overview.activeSetups,0,JSON.stringify(patch));
});
test('new overview cards preserve unknown versus zero and expire setups in the browser without losing tracked totals',()=>{
 const {ctx,elements,clock}=ui();ctx.renderResearchIndicators();assert.equal(elements.hunterTrackedValue.textContent,'—');assert.equal(elements.hunterSetupValue.textContent,'—');
 const data=withPerformance({items:[item({decision:'REVIEW'})],radarTracking:{version:'radar-v1.0.0',counts:{ACTIVE:2,WEAK:1}}},{now});
 ctx.S.serverResearch=data;ctx.S.performanceAsOf=data.aiPerformance.asOf;ctx.S.performanceReceivedAt=now;ctx.renderResearchIndicators(data);
 assert.equal(elements.hunterTrackedValue.textContent,'3');assert.equal(elements.hunterSetupValue.textContent,'1');
 clock.now+=16*60000;ctx.renderResearchIndicators(data);assert.equal(elements.hunterTrackedValue.textContent,'3');assert.equal(elements.hunterSetupValue.textContent,'0');
});
test('pool coverage requires identity, positive liquidity and a positive numeric price',()=>{
 for(const patch of [{pair_address:null},{pair_address:''},{liquidity_usd:0},{liquidity_usd:-1},{price_usd:true},{price_usd:'1'},{price_usd:0}])assert.equal(metrics({items:[item(patch)]}).metrics.pool.value,0);
});
test('zero is a valid V4 score; old models, booleans and out-of-range scores never count as V4',()=>{
 assert.equal(metrics({items:[item({score:0})]}).metrics.scored.value,100);
 for(const patch of [{score:101},{score:-1},{score:'66'},{score:true},{model:'heuristic-v3.0.0'}])assert.equal(metrics({items:[item(patch)]}).metrics.scored.value,0);
});
test('missing or empty populations remain unknown rather than an invented zero percent',()=>{
 for(const data of [null,{}, {items:[]}]){const p=metrics(data);assert.equal(p.metrics.price.value,null);assert.equal(p.metrics.evaluation.value,null);assert.equal(p.metrics.positive.value,null);}
});
test('freshness uses both capture and source times and refuses future, stale and invalid times',()=>{
 assert.equal(metrics({items:[item()]}).metrics.fresh.value,100);
 for(const patch of [{observed_at:null},{observed_at:'invalid'},{observed_at:new Date(now+120000).toISOString()},{observed_at:new Date(now-16*60000).toISOString()},{source_as_of:new Date(now-3600000).toISOString()},{source_as_of:'invalid'}])assert.equal(metrics({items:[item(patch)]}).metrics.fresh.value,0);
});
test('risk completeness is assessed again from dated exact-mint evidence, not from a stored PASS label',()=>{
 const p=metrics({items:[item()]});assert.equal(p.metrics.risk.value,100);assert.equal(p.metrics.risk.passedTokens,1);assert.equal(p.metrics.risk.checkExpiries.length,5);
 const forged=item({verificationEvidence:null,tokenMetadata:null,riskAssessment:{status:'CHECKS_PASSED',coverage:100}});
 assert.equal(metrics({items:[forged]}).metrics.risk.value,0);
});
test('a failed check counts as inspected and explicitly remains a detected risk, not a safety percentage',()=>{
 const x=item();x.tokenMetadata.topHoldersPercentage=80;
 const p=metrics({items:[x]});assert.equal(p.metrics.risk.value,100);assert.equal(p.metrics.risk.detectedTokens,1);assert.equal(p.metrics.risk.passedTokens,0);
});
test('persisted JSON strings behave like live evidence and old timestamps stop counting',()=>{
 const x=item();x.tokenMetadata=JSON.stringify(x.tokenMetadata);x.verificationEvidence=JSON.stringify(x.verificationEvidence);
 assert.equal(metrics({items:[x]}).metrics.risk.numerator,5);
 const p=performanceMetrics({items:[x]},{now:now+16*60000});assert.equal(p.metrics.risk.numerator,0);assert.equal(p.metrics.fresh.numerator,0);
});
test('follow-up denominator excludes candidates below 30m while delayed and unmeasured ones remain visible',()=>{
 const p=metrics({items:[],candidates:[candidate(),candidate({id:2,observed_at:new Date(now-600000).toISOString(),evaluation_status:'PENDING'}),candidate({id:3,observed_at:new Date(now-7200000).toISOString(),evaluation_status:'MISSING_OBSERVATION'})]});
 assert.equal(p.validation.candidates,3);assert.equal(p.validation.eligible,2);assert.equal(p.validation.pending,1);assert.equal(p.validation.overdue,1);
 assert.equal(p.metrics.evaluation.value,50);assert.equal(p.metrics.positive.value,100);
});
test('positive observation fraction treats flat returns separately and does not imply trading win rate',()=>{
 const p=metrics({candidates:[candidate(),candidate({id:2,exit_price:.9,roi_pct:-10}),candidate({id:3,exit_price:1,roi_pct:0})]});
 assert.equal(p.validation.positive,1);assert.equal(p.validation.negative,1);assert.equal(p.validation.flat,1);assert.equal(p.metrics.positive.numerator,1);assert.equal(p.metrics.positive.denominator,3);assert.equal(p.validation.calibrated,false);
});
test('validation uses only original V4 scores, caps its cohort at fifty and rejects inconsistent outcomes',()=>{
 const candidates=Array.from({length:60},(_,i)=>candidate({id:i}));assert.equal(modelValidation(candidates,{now}).candidates,50);
 const p=metrics({candidates:[candidate({model:'heuristic-v3.0.0'}),candidate({id:2,roi_pct:999}),candidate({id:3,evaluation_observed_at:new Date(now+60000).toISOString()})]});assert.equal(p.validation.measured,0);
});
test('frontend has eight relevant instruments and uses the same unique token and V4 cohort counts',()=>{
 const {ctx,elements}=ui(),data=withPerformance({items:[item(),item({pair_address:'second'})],candidates:[candidate()]},{now});ctx.S.serverResearch=data;ctx.renderResearchIndicators(data);
 const labels=ctx.researchPerformanceView(data).bars.map(x=>x[0]);assert.equal(labels.length,8);assert.equal(labels.join('|'),'DATA POOL|HARGA|SKOR V4|API AKTIF|DATA SEGAR|CEK RISIKO|EVALUASI V4|RETURN POSITIF');
 assert.equal(elements.hunterActiveTargetCount.textContent,'1');assert.equal(elements.hunterEvaluationValue.textContent,'1');assert.equal(elements.hunterCalibrationStatus.textContent,'BELUM');assert.equal(elements.hunterCalibratedValue.textContent,'V4');
 assert.doesNotMatch(elements.aiHealthDash.innerHTML,/WIN RATE|PRECISION|F1 SCORE|RECALL/);
});
test('frontend freshness and risk completeness expire while a page remains open, without extra network calls',()=>{
 const {ctx,clock}=ui(),data=withPerformance({items:[item()]},{now});ctx.S.serverResearch=data;ctx.S.performanceAsOf=data.aiPerformance.asOf;ctx.S.performanceReceivedAt=now;
 assert.equal(ctx.researchPerformanceView(data).bars[4][1],100);assert.equal(ctx.researchPerformanceView(data).bars[5][1],100);
 clock.now+=16*60000;assert.equal(ctx.researchPerformanceView(data).bars[4][1],0);assert.equal(ctx.researchPerformanceView(data).bars[5][1],0);
});
test('API availability expires instead of staying green forever; absent or duplicate providers do not count',()=>{
 const {ctx,clock}=ui();ctx.S.providerHealth={checkedAt:at,providers:[{key:'DEX',status:'HEALTHY',observedAt:at},{key:'HELIUS',status:'HEALTHY',observedAt:at}]};
 assert.equal(ctx.providerPerformance().numerator,2);assert.equal(ctx.providerPerformance().denominator,3);
 ctx.S.providerHealth.providers.push({key:'DEX',status:'UNAVAILABLE'});assert.equal(ctx.providerPerformance().numerator,1);
 ctx.ep.HELIUS='on';ctx.eph.HELIUS={checkedAt:at};assert.equal(ctx.currentProviderState('HELIUS'),'on');
 clock.now+=16*60000;assert.equal(ctx.providerPerformance().value,null);assert.equal(ctx.currentProviderState('HELIUS'),'pending');
});
test('invalid server metric counts cannot produce a fabricated fill or percentages above 100',()=>{
 const {ctx}=ui(),data=withPerformance({items:[item()]},{now});data.aiPerformance.metrics.scored.numerator=2;
 assert.equal(ctx.researchPerformanceView(data).bars[2][1],null);
 data.aiPerformance.metrics.scored.numerator=true;assert.equal(ctx.researchPerformanceView(data).bars[2][1],null);
});
test('all performance surfaces use the same server definitions rather than old local learning accuracy',()=>{
 for(const name of ['showUnifiedDashboard','exportAIReport','showAuditPanel']){
  const source=html.slice(html.indexOf('function '+name+'(')).split('\n')[0];assert.doesNotMatch(source,/S\.learning\.accuracy|S\.outcomes|avgConfidence/);
 }
 assert.match(html,/debugBtn'\)\.onclick=showAuditPanel/);
});
test('advanced dashboard preserves real database count definitions and never substitutes local history for a missing count',()=>{
 const {ctx}=ui(),panels={};ctx.feedBus=[];ctx.updatePanel=(id,value)=>{panels[id]=value;};ctx.patchHeroPanel=()=>{};
 ctx.S.serverResearch={...withPerformance({items:[]},{now}),counts:{database_records:300,total_records:100,unique_mints:70}};
 ctx.S.predictionHistory=Array(999);ctx.S.dash={dbTotal:999,tot:999};
 const source=html.slice(html.indexOf('  function updateDashboard(){')).split('\n')[0];vm.runInContext(source,ctx);ctx.updateDashboard();
 assert.equal(panels['dash-db'],300);assert.equal(panels['dash-pred'],100);assert.equal(panels['dash-unique'],70);
 ctx.S.serverResearch.counts=null;ctx.updateDashboard();assert.equal(panels['dash-db'],'—');assert.equal(panels['dash-pred'],'—');assert.equal(panels['dash-unique'],'—');
});
test('a non-quota research read failure falls back to the independent market service instead of blanking the panel',async()=>{
 const old=globalThis.caches;globalThis.caches=undefined;
 try{let calls=0;const r=await gateway.fetch(new Request('https://audit.test/api/research/latest'),{RESEARCH_DB:{prepare(){return {};},async batch(){throw Error('temporary D1 transport failure');}},API:{async fetch(){calls++;return Response.json({items:[item()],dataStatus:'LIVE_ONLY',persisted:false});}}});
  assert.equal(r.status,200);const d=await r.json();assert.equal(d.warning,'RESEARCH_READ_UNAVAILABLE');assert.equal(d.aiPerformance.version,'research-performance-v1');assert.equal(calls,1);assert.equal(d.persisted,false);
 }finally{globalThis.caches=old;}
});
test('an unavailable read plus unavailable market reports its actual condition, not a fabricated D1 quota error',async()=>{
 const old=globalThis.caches;globalThis.caches=undefined;
 try{const r=await gateway.fetch(new Request('https://audit.test/api/research/latest'),{RESEARCH_DB:{prepare(){return {};},async batch(){throw Error('temporary read failure');}},API:{async fetch(){return Response.json({error:'NO_DATA'},{status:503});}}});assert.equal(r.status,503);assert.equal((await r.json()).error,'RESEARCH_READ_UNAVAILABLE');
 }finally{globalThis.caches=old;}
});
