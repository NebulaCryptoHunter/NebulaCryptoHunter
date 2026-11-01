import {test} from 'node:test';import assert from 'node:assert/strict';
import gateway from '../workers/frontend-gateway.mjs';import api from '../workers/nebula-api.mjs';import {transformFrontend} from '../workers/frontend-transform.mjs';import fs from 'node:fs';import vm from 'node:vm';
const origin='https://nebulacryptohunter.nebula-crypto-proxy.workers.dev';
const post=(path,data,headers={})=>new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(data)});
test('gateway refuses legacy bearer key with no session',async()=>{const r=await gateway.fetch(post('/api/v1/predictions',{}, {Authorization:'Bearer old-public-key'}),{});assert.equal(r.status,401)});
test('gateway refuses cross-origin mutation',async()=>assert.equal((await gateway.fetch(post('/api/v1/predictions',{}, {Origin:'https://evil.test'}),{})).status,403));
test('gateway authenticated administrator forwards only server key',async()=>{
 let forwarded;const AUTH_DB={prepare(){return {bind(){return this},async first(){return {role:'SUPER_ADMIN',id:'admin'}}}}};
 const r=await gateway.fetch(post('/api/v1/predictions',{}, {Cookie:'__Host-nebula_session='+'a'.repeat(64),Authorization:'Bearer user-input'}),{AUTH_DB,API_KEY:'server-secret',API:{fetch:async r=>{forwarded=r;return Response.json({success:true})}}});
 assert.equal(r.status,200);assert.equal(forwarded.headers.get('Authorization'),'Bearer server-secret');assert.equal(forwarded.headers.get('Cookie'),null);
});
test('gateway rejects normal user writes to shared dataset',async()=>{const AUTH_DB={prepare(){return {bind(){return this},async first(){return {role:'USER'}}}}};assert.equal((await gateway.fetch(post('/api/v1/predictions',{}, {Cookie:'__Host-nebula_session='+'a'.repeat(64)}),{AUTH_DB})).status,401)});
test('frontend removes credential and passes JavaScript parser',()=>{
 const html=transformFrontend(fs.readFileSync('index.html','utf8'));assert.doesNotMatch(html,/apiKey\s*:/);assert.ok(!html.includes('https://nebula-api.nebula-crypto-proxy.workers.dev'));assert.ok(html.includes('id="nebulaResearchDock"'));assert.ok(!html.includes('id="nebulaManualScan"'));assert.ok(!html.includes('id="serverScan"'));assert.ok(html.indexOf('id="cockpitDashboard"')<html.indexOf('id="nebulaResearchDock"'));assert.doesNotMatch(html,/id="researchPanel"/);assert.equal(transformFrontend(html),html);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('API returns 400 for malformed JSON instead of 500',async()=>{assert.equal((await api.fetch(new Request(origin+'/api/v1/predictions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),{},{})).status,400)});
test('API bounds streamed payload without content length',async()=>{assert.equal((await api.fetch(new Request(origin+'/api/v1/predictions',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(262145)}),{},{})).status,413)});
test('retired targeted mint endpoint returns 404 while primary HUD SCAN remains protected',async()=>{
 const disabled=await gateway.fetch(post('/api/research/scan',{mints:[]}),{});
 assert.equal(disabled.status,404);
 assert.equal((await disabled.json()).error,'NOT_FOUND');
 const primary=await gateway.fetch(post('/api/research/scan-now',{}),{});
 assert.equal(primary.status,401);
});

test('spaceship HUD restores 12 indicators and hides unverified multiplier claims',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/NEBULA SHIP HUD v110/);
 assert.match(html,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(html,/chip\.className='ep-mini '/);
 assert.match(html,/ep\[n\]='pending'/);
 assert.match(html,/item\.status==='HEALTHY'\?'on'/);
 assert.match(html,/refreshProviderIndicators\(\)/);
 assert.doesNotMatch(html,/btn\.textContent='API · LIHAT STATUS PROVIDER ▾'/);
 assert.match(html,/S\.dash\.watch=feedBus\.filter\(t=>t\.decision===DECISION\.WATCH\)\.length/);
 assert.match(html,/if\(t\._serverObservation\|\|t\.restored\)/);
 assert.match(html,/t\.multiplier&&!t\.restored&&t\._passedGate/);
 assert.ok(transformFrontend(html).includes('id="nebulaProviderDetails"'));
});


test('HUD details render every section without raw source leaks or trapped scroll',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.equal((html.match(/<\/html>/g)||[]).length,1);
 assert.ok(html.trimEnd().endsWith('</html>'),'nothing should appear after closing html tag');
 assert.equal((html.match(/<script\b/g)||[]).length,1);
 assert.match(html,/\.card-detail-section\{margin-top:8px;display:none;max-height:none;overflow:visible/);
 assert.match(html,/@media\(max-width:767px\)\{\.sticky-nav\{position:relative/);
 assert.match(html,/if\(e\.target\.closest\('button, a, \.card-detail-section'\)\)return/);
 for(const section of [
  'DATA · MARKET TELEMETRY','XAI · EXPLAINABLE SCORING',
  'STRUCTURE · MARKET','EXIT · RISK PLAN','MONTE CARLO · SIMULATION',
  'CONVICTION FACTORS','AI PREDICTION','GROWTH CATALYSTS',
  'EVALUATION · FOLLOW-UP'
 ])assert.ok(html.includes(section),'missing detail section: '+section);
 assert.match(html,/const expanded=new Map\(\)/,'refresh preserves opened token cards');
 assert.match(html,/const isHistorical=!!\(t\._serverObservation\|\|t\.restored\)/);
 assert.match(html,/XAI, target harga|Tidak ada katalis terverifikasi|Model belum dikalibrasi/);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

test('legacy predictions and scanner candidates share a single history timeline from D1',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="archiveStatus"/);
 assert.match(html,/id="archiveCount"/);
 assert.match(html,/DATABASE NEBULA/);
 assert.match(html,/\/api\/research\/history\?limit=/);
 assert.doesNotMatch(html,/fetch\('\/api\/v1\/predictions\?limit=/);
 assert.match(html,/legacyArchiveCount=n/);
 assert.match(html,/function showHistoryPanel\(offset=0\)/);
 assert.match(html,/S\.dash\.dbTotal=json\.counts\?\.database_records/);
 assert.match(html,/S\.dash\.tot=json\.counts\?\.unique_mints/);
 assert.match(html,/S\.serverResearchCounts=json\.counts/);
 assert.match(html,/row\.record_source==='LEGACY'/);
 assert.match(html,/row\.record_key/);
});
test('HUD separates real one-click SCAN from read-only SINKRON and unchanged AUTO',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="scanFeedback"/);
 assert.match(html,/Sinkronisasi hanya membaca data tersimpan/);
 assert.match(html,/Scanner otomatis berjalan setiap 30 menit/);
 assert.match(html,/<button id="scanBtn"[^>]*>SCAN<\/button>/);
 assert.match(html,/<button id="syncBtn"[^>]*>SINKRON<\/button>/);
 assert.match(html,/<button id="autoPumpToggleBtn"[^>]*>AUTO<\/button>/);
 assert.match(html,/\$\('scanBtn'\)\.onclick=Scanner\.requestManualScan/);
 assert.match(html,/\$\('syncBtn'\)\.onclick=Scanner\.requestScan/);
 assert.match(html,/fetch\('\/api\/research\/scan-now'/);
 assert.match(html,/if\(!response\.ok\)/);
 assert.match(html,/await performScan\(\)/);
 assert.match(html,/btn\.textContent='SINKRON'/);
 assert.match(html,/btn\.textContent='SCAN'/);
 assert.doesNotMatch(html,/Admin sementara NONAKTIF/);
 assert.match(html,/performScan\(\)\.catch\(e=>/);
 assert.match(html,/return json;\n\}/);
});
test('frontend historical archive GET forwards over existing API service binding',async()=>{
 const seen=[];
 const API={fetch:async req=>{seen.push(new URL(req.url).pathname);return Response.json({success:true,data:{total_predictions:6952,total_evaluations:82,predictions:[]}})}};
 const env={API};
 const stats=await gateway.fetch(new Request(origin+'/api/v1/stats'),env);
 assert.equal(stats.status,200);
 const predictions=await gateway.fetch(new Request(origin+'/api/v1/predictions?limit=25&offset=0'),env);
 assert.equal(predictions.status,200);
 assert.deepEqual(seen,['/api/v1/stats','/api/v1/predictions']);
});

test('admin flag suspends account, activation, login, manual scanner and writes',async()=>{
 const env={ADMIN_MODE:'disabled',API:{fetch:async()=>Response.json({success:true,data:{total_predictions:6952}})}};
 for(const path of ['/api/auth/me','/api/auth/login','/api/auth/activate']){
  const request=new Request(origin+path);
  const response=await gateway.fetch(request,env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'ADMIN_TEMPORARILY_DISABLED');
 }
 const account=await gateway.fetch(new Request(origin+'/account'),env);
 assert.equal(account.status,200);
 assert.match(await account.text(),/Admin NEBULA sementara dinonaktifkan/);
 const scan=await gateway.fetch(post('/api/research/scan-now',{}),env);
 assert.equal(scan.status,503);
 assert.equal((await scan.json()).error,'MANUAL_SCAN_PAUSED_ADMIN_DISABLED');
 const mutation=await gateway.fetch(post('/api/v1/predictions',{token_ca:'x'}),env);
 assert.equal(mutation.status,403);
 assert.equal((await mutation.json()).error,'WRITES_DISABLED_READ_ONLY_MODE');
 const stats=await gateway.fetch(new Request(origin+'/api/v1/stats'),env);
 assert.equal(stats.status,200);
 const health=await gateway.fetch(new Request(origin+'/health'),env);
 assert.equal((await health.json()).adminEnabled,false);
});
test('admin reenabled via flag with AUTH_DB and cron preserved',()=>{
 const config=fs.readFileSync('wrangler.jsonc','utf8');
 assert.match(config,/"ADMIN_MODE": "enabled"/);
 assert.match(config,/"binding": "AUTH_DB"/);
 assert.match(config,/"SCANNER_CRON": "enabled"/);
});
test('enabled admin exposes login and requires an authenticated session for writes',async()=>{
 const env={ADMIN_MODE:'enabled',API:{fetch:async()=>Response.json({success:true})}};
 const page=await gateway.fetch(new Request(origin+'/account'),env);
 assert.equal(page.status,200);
 assert.match(await page.text(),/Akun NEBULA/);
 const health=await gateway.fetch(new Request(origin+'/health'),env);
 assert.equal((await health.json()).adminEnabled,true);
 const scan=await gateway.fetch(post('/api/research/scan-now',{}),env);
 assert.equal(scan.status,401);
 const write=await gateway.fetch(post('/api/v1/predictions',{}),env);
 assert.equal(write.status,401);
});

test('first-admin provisioning matches Cloudflare WebCrypto PBKDF2 limit',()=>{
 const provision=fs.readFileSync('backend/scripts/provision-first-admin.mjs','utf8');
 const verifier=fs.readFileSync('backend/auth-v1.mjs','utf8');
 assert.match(provision,/iterations=100000/);
 assert.doesNotMatch(provision,/iterations=310000/);
 assert.match(verifier,/const ITERATIONS = 100000/);
 assert.match(provision,/WHERE NOT EXISTS \(SELECT 1 FROM auth_users WHERE role='SUPER_ADMIN'\)/);
 assert.match(provision,/NEBULA_ADMIN_SQL_FILE/);
 assert.match(provision,/mode:0o600/);
 assert.match(provision,/flag:'wx'/);
});

test('unified research feed orders migrated rows by timestamps, not legacy ids',()=>{
 const research=fs.readFileSync('backend/workers/research-api.mjs','utf8');
 const scanner=fs.readFileSync('backend/workers/nebula-scanner.mjs','utf8');
 assert.match(research,/WHERE s\.observed_at=\(SELECT MAX\(x\.observed_at\)/);
 assert.match(research,/ORDER BY s\.observed_at DESC,s\.id DESC LIMIT 50/);
 assert.match(research,/scanner_runs ORDER BY started_at DESC,id DESC LIMIT 10/);
 assert.match(research,/prediction_candidates c[\s\S]*ORDER BY c\.observed_at DESC,c\.id DESC LIMIT 50/);
 assert.match(research,/candidate_evaluations e[\s\S]*ORDER BY e\.evaluated_at DESC,e\.id DESC LIMIT 50/);
 assert.doesNotMatch(research,/scanner_runs ORDER BY id DESC/);
 assert.match(scanner,/predictions ORDER BY created_at DESC,id DESC LIMIT 150/);
});


test('evaluation Wrangler config keeps both production D1 bindings canonical',()=>{
 const config=JSON.parse(fs.readFileSync('backend/wrangler.evaluation.jsonc','utf8'));
 const databases=Object.fromEntries(config.d1_databases.map(({binding,database_name,database_id})=>[binding,{database_name,database_id}]));
 const expected={database_name:'nebula-db',database_id:'6eeadd5e-5e58-4a8c-90d9-92d039438a8f'};
 assert.deepEqual(databases.DB,expected);
 assert.deepEqual(databases.RESEARCH_DB,expected);
});


test('manual scanner has separate secret from automatic INTERNAL_TOKEN',()=>{
 const scanner=fs.readFileSync('backend/workers/nebula-scanner.mjs','utf8');
 const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
 assert.match(scanner,/manualAuthorized=!!env.MANUAL_SCAN_TOKEN/);
 assert.match(scanner,/if\(!internalAuthorized&&!manualAuthorized\)/);
 assert.equal(config.services.find(x=>x.binding==='SCANNER')?.service,'nebula-scanner');
 assert.doesNotMatch(JSON.stringify(config),/private-manual-token|MANUAL_SCAN_TOKEN/);
});


test('manual scanner secret permits bounded batch scan but not cron schedule keys',async()=>{
 const {default:worker}=await import('../workers/nebula-scanner.mjs');
 const origin='https://scanner.internal';
 const log=[];
 const STAGE_DB={prepare(sql){return{bind(...args){log.push({sql,args});return this},async run(){return{meta:{changes:0}}},async first(){return null}}}};
 const env={MANUAL_SCAN_TOKEN:'separate-manual-test',INTERNAL_TOKEN:'cron-internal-test',AI_ENGINE:{},STAGE_DB};
 const url=origin+'/pipeline?mint=not-a-mint';
 const unauthorized=await worker.fetch(new Request(url),env);
 assert.equal(unauthorized.status,401);
 const manual=await worker.fetch(new Request(url,{headers:{Authorization:'Bearer separate-manual-test'}}),env);
 assert.equal(manual.status,400); // Authorized for pipeline; invalid mint rejected before provider call.
 const run=await worker.fetch(new Request(origin+'/run',{method:'POST',headers:{Authorization:'Bearer separate-manual-test'}}),env);
 assert.equal(run.status,429); // Duplicated manual interval returned, not a new scan.
 assert.equal((await run.json()).status,'SKIPPED_DUPLICATE');
 assert.ok(log.some(x=>x.sql.includes('INSERT OR IGNORE INTO scanner_runs')&&String(x.args[0]).startsWith('manual:')));
});


test('one-click SCAN endpoint rejects guests, unrotated Admin and disabled mode',async()=>{
 const mk=(user)=>({prepare(){return{bind(){return this},async first(){return user}}}});
 const mintPath='/api/research/scan-now';
 const env={ADMIN_MODE:'enabled',AUTH_DB:mk(null),SCANNER:{fetch:async()=>{throw Error('should not be called')}},MANUAL_SCAN_TOKEN:'secret'};
 assert.equal((await gateway.fetch(post(mintPath,{}),env)).status,401);
 env.AUTH_DB=mk({id:'admin',role:'SUPER_ADMIN',must_change_password:1});
 const blocked=await gateway.fetch(post(mintPath,{},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),env);
 assert.equal(blocked.status,401);
 assert.equal((await blocked.json()).error,'PASSWORD_CHANGE_REQUIRED');
 env.ADMIN_MODE='disabled';
 const paused=await gateway.fetch(post(mintPath,{},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),env);
 assert.equal(paused.status,503);
 assert.equal((await paused.json()).error,'MANUAL_SCAN_PAUSED_ADMIN_DISABLED');
 env.ADMIN_MODE='enabled';
 assert.equal((await gateway.fetch(post(mintPath,{}, {Origin:'https://other.test'}),env)).status,403);
});
test('one-click SCAN executes private scanner, returns truthful snapshot count and hides credential',async()=>{
 const seen=[];
 const AUTH_DB={prepare(){return{bind(){return this},async first(){return {id:'admin',role:'SUPER_ADMIN',must_change_password:0}}}}};
 const SCANNER={fetch:async(req,opts)=>{seen.push({req,opts});return Response.json({success:true,status:'COMPLETED',selectedCount:12,snapshotCount:3})}};
 const result=await gateway.fetch(post('/api/research/scan-now',{},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),{AUTH_DB,SCANNER,MANUAL_SCAN_TOKEN:'private-secret'});
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{success:true,status:'COMPLETED',selectedCount:12,snapshotCount:3});
 assert.equal(seen.length,1);
 assert.equal(new URL(seen[0].req).pathname,'/run');
 assert.equal(seen[0].opts.method,'POST');
 assert.equal(seen[0].opts.headers.Authorization,'Bearer private-secret');
 assert.doesNotMatch(JSON.stringify(seen[0].req),/private-secret/);
});
test('one-click SCAN preserves 429 and scanner failures without claiming success',async()=>{
 const AUTH_DB={prepare(){return{bind(){return this},async first(){return {id:'admin',role:'SUPER_ADMIN',must_change_password:0}}}}};
 for(const [upstream,expected] of [[Response.json({success:false,status:'SKIPPED_DUPLICATE'},{status:429}),429],[Response.json({success:false,status:'FAILED'},{status:502}),502]]){
  const result=await gateway.fetch(post('/api/research/scan-now',{},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),{AUTH_DB,MANUAL_SCAN_TOKEN:'private-secret',SCANNER:{fetch:async()=>upstream}});
  assert.equal(result.status,expected);
  assert.equal((await result.json()).success,false);
 }
 const scanner=fs.readFileSync('backend/workers/nebula-scanner.mjs','utf8');
 assert.match(scanner,/kind==='manual'\?'manual:'/);
 assert.match(scanner,/result.status==='SKIPPED_DUPLICATE'/);
 const wrangler=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
 assert.equal(wrangler.services.find(x=>x.binding==='SCANNER')?.service,'nebula-scanner');
});


test('desktop HUD extends usable width without changing mobile layout',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/NEBULA Desktop HUD v111/);
 assert.match(html,/@media \(min-width:768px\)\{/);
 assert.match(html,/\.app\{width:calc\(100% - 32px\);max-width:1480px/);
 assert.match(html,/@media \(min-width:1024px\)\{/);
 assert.match(html,/\.cockpit-dashboard\{display:grid;grid-template-columns:/);
 assert.match(html,/@media \(min-width:1200px\)\{/);
 assert.match(html,/\.radar-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(html,/\.endpoint-bar\{grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
 // Desktop rules follow existing mobile rules rather than replacing them.
 assert.ok(html.indexOf('NEBULA Desktop HUD v111')>html.indexOf('@media(max-width:767px)'));
 assert.match(html,/@media\(max-width:767px\)\{\.sticky-nav\{position:relative/);
 assert.match(html,/id="scanBtn"[^>]*>SCAN<\/button>/);
 assert.match(html,/id="syncBtn"[^>]*>SINKRON<\/button>/);
 assert.match(html,/id="autoPumpToggleBtn"[^>]*>AUTO<\/button>/);
});
test('desktop token card headers and expanded telemetry are unclipped',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const desktop=html.slice(html.indexOf('NEBULA Desktop HUD v111'),html.indexOf('@media(prefers-reduced-motion:reduce)'));
 assert.match(desktop,/\.hud-card\{padding:14px;min-width:0;overflow:visible\}/);
 assert.match(desktop,/\.hud-card \.token-name\{[^}]*white-space:normal;overflow:visible;text-overflow:clip/);
 assert.match(desktop,/\.radar-grid > \.hud-card:has\(> \.card-detail-section\[style\*="display: block"\]\)\{grid-column:1\/-1\}/);
 assert.match(desktop,/\.hud-detail-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(desktop,/\.overlay-content\{[^}]*max-height:none;overflow:visible/);
 assert.match(desktop,/\.action-row button\{flex:1 1 0/);
 assert.match(html,/\.card-detail-section\{margin-top:8px;display:none;max-height:none;overflow:visible/);
 assert.match(html,/const expanded=new Map\(\)/);
 assert.match(html,/if\(det\.style\.display==='block'\)/);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});


test('provider cooldown preflight never consumes manual 15-minute slot',async()=>{
 const {default:worker}=await import('../workers/nebula-scanner.mjs');
 const future=Date.now()+12*60000;
 const sqls=[];
 const STAGE_DB={prepare(sql){sqls.push(sql);return {async first(){return {value:String(future)}},bind(){return this},async run(){throw Error('must not write during cooldown')}}}};
 const env={MANUAL_SCAN_TOKEN:'manual-only-secret',INTERNAL_TOKEN:'cron-only-secret',STAGE_DB,AI_ENGINE:{}};
 const res=await worker.fetch(new Request('https://scanner.internal/run',{method:'POST',headers:{Authorization:'Bearer manual-only-secret'}}),env);
 assert.equal(res.status,429);
 const body=await res.json();
 assert.equal(body.error,'PROVIDER_COOLDOWN');
 assert.equal(body.status,'RATE_LIMITED');
 assert.equal(body.selectedCount,0);
 assert.equal(body.snapshotCount,0);
 assert.equal(Date.parse(body.retryAt),future);
 assert.equal(sqls.length,1);
 assert.match(sqls[0],/SELECT value FROM scanner_state WHERE key='cooldown_until'/);
 assert.ok(!sqls.some(sql=>sql.includes('INSERT OR IGNORE INTO scanner_runs')));
});
test('gateway distinguishes provider cooldown from manual slot and does not reveal secret',async()=>{
 const AUTH_DB={prepare(){return {bind(){return this},async first(){return {id:'admin',role:'SUPER_ADMIN',must_change_password:0}}}}};
 const retryAt=new Date(Date.now()+10*60000).toISOString();
 for(const code of ['PROVIDER_COOLDOWN','MANUAL_SCAN_COOLDOWN']){
  const response=Response.json({success:false,error:code,status:code==='PROVIDER_COOLDOWN'?'RATE_LIMITED':'SKIPPED_DUPLICATE',retryAt},{status:429});
  const call=await gateway.fetch(post('/api/research/scan-now',{},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),{
    AUTH_DB,MANUAL_SCAN_TOKEN:'private-gateway-test',
    SCANNER:{fetch:async()=>response}
  });
  assert.equal(call.status,429);
  const data=await call.json();
  assert.equal(data.error,code);
  assert.equal(data.retryAt,retryAt);
  assert.equal(data.success,false);
  assert.doesNotMatch(JSON.stringify(data),/private-gateway-test/);
 }
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/PROVIDER_COOLDOWN:'DexScreener membatasi permintaan/);
 assert.match(html,/MANUAL_SCAN_COOLDOWN:'Scan manual sudah dipakai/);
 assert.match(html,/Perkiraan dapat dicoba lagi:/);
 assert.ok(html.includes("timeZone:'Asia/Jakarta'"));
});

test('redundant manual scan panel is absent and server research dock remains',()=>{
 const html=transformFrontend(fs.readFileSync('index.html','utf8'));
 assert.ok(html.includes('id="nebulaResearchDock"'));
 assert.ok(!html.includes('id="nebulaManualScan"'));
 assert.ok(!html.includes('id="nebulaManualForm"'));
 assert.ok(!html.includes('id="serverScan"'));
 assert.ok(!html.includes('Alamat token Solana (maks. 5'));
 assert.ok(!html.includes('SCAN MANUAL · ADMIN'));
 assert.equal(transformFrontend(html),html);
 const gatewaySource=fs.readFileSync('backend/workers/frontend-gateway.mjs','utf8');
 assert.ok(gatewaySource.includes("if(path==='/api/research/scan')return json({error:'NOT_FOUND'},404)"));
 assert.ok(gatewaySource.includes("if(path==='/api/research/scan-now'&&method==='POST')"));
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});

test('canonical D1 read layer tracks both sources without copying legacy rows',()=>{
 const research=fs.readFileSync('backend/workers/research-api.mjs','utf8');
 const view=fs.readFileSync('backend/migrations/0010_nebula_unified_read_model.sql','utf8');
 assert.match(view,/CREATE VIEW IF NOT EXISTS nebula_unified_records_v1/);
 assert.match(view,/FROM predictions p/);
 assert.match(view,/FROM prediction_candidates c/);
 assert.match(view,/UNION ALL/);
 assert.match(view,/legacy:/);
 assert.match(view,/scanner:/);
 assert.doesNotMatch(view,/INSERT INTO|DELETE FROM|DROP TABLE|UPDATE predictions/);
 assert.match(research,/SELECT COUNT\(\*\) FROM predictions\)\+\(SELECT COUNT\(\*\) FROM prediction_candidates\)/);
 assert.match(research,/export async function unifiedHistory/);
 assert.match(research,/FROM nebula_unified_records_v1/);
 const gw=fs.readFileSync('backend/workers/frontend-gateway.mjs','utf8');
 assert.match(gw,/\/api\/research\/history/);
 assert.match(gw,/unifiedHistory\(env.RESEARCH_DB/);
});

test('unified source counts survive radar feed reconciliation',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/tot:S\.serverResearchCounts\?\.unique_mints\?\?feedBus\.length/);
 assert.match(html,/dbTotal:S\.serverResearchCounts\?\.database_records\?\?S\.dash\.dbTotal\?\?null/);
 assert.doesNotMatch(html,/async function loadStats\(\)\{const json=await apiGet\('\/stats'\)/);
 assert.match(html,/\/api\/research\/history\?limit=/);
});

test('DATABASE counts research rows, PREDICTION counts decisions, UNIQUE counts mints',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const api=fs.readFileSync('backend/workers/research-api.mjs','utf8');
 assert.match(api,/AS database_records/);
 assert.match(api,/total_records/);
 assert.match(api,/unique_mints/);
 assert.match(html,/id:'dash-db',lbl:'DATABASE'/);
 assert.match(html,/id:'dash-pred',lbl:'PREDICTION'/);
 assert.match(html,/id:'dash-unique',lbl:'UNIQUE'/);
 assert.doesNotMatch(html,/id:'dash-total',lbl:'TOT'/);
 assert.match(html,/updatePanel\('dash-db',S\.dash\.dbTotal\?\?'—'/);
 assert.match(html,/updatePanel\('dash-pred',S\.serverResearchCounts\?\.total_records/);
 assert.match(html,/updatePanel\('dash-unique',S\.dash\.tot/);
 assert.match(html,/database_records\?\?S\.dash\.dbTotal/);
 assert.match(html,/unique_mints\?\?feedBus\.length/);
});

test('DATABASE sums core research records; PREDICTION and UNIQUE retain their distinct definitions',()=>{
 const research=fs.readFileSync('backend/workers/research-api.mjs','utf8');
 const html=fs.readFileSync('index.html','utf8');
 const expected=[
  'predictions','prediction_candidates','scanner_snapshots','engine_scores',
  'evaluations','candidate_evaluations','scanner_runs'
 ];
 const query=research.match(/\`SELECT \(SELECT COUNT\(\*\) FROM scanner_snapshots\)[^\`]*\`/);
 assert.ok(query,'Research counts query exists');
 const segment=query[0].split(' AS database_records')[0].split(' total_records,')[1];
 assert.ok(segment,'DB formula is distinct from PREDICTION');
 for(const table of expected) assert.ok(segment.includes('FROM '+table+')'),table+' missing from DATABASE count');
 assert.doesNotMatch(segment,/research_databases/);
 assert.match(research,/\) total_records,/);
 assert.match(research,/\) unique_mints/);
 assert.match(html,/lbl:'DATABASE'/);
 assert.match(html,/lbl:'PREDICTION'/);
 assert.match(html,/lbl:'UNIQUE'/);
 assert.match(html,/total_records\?\?S\.predictionHistory\.length/);
 assert.match(html,/database_records\?\?S\.dash\.dbTotal/);
});

test('hero header uses Hunter NEBULA signature, without changing app identity',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/<div class="header-row-2">NEBULA CRYPTO HUNTER<\/div>/);
 assert.ok(html.includes('HUNT BEFORE THE HYPE. <span aria-hidden="true">//</span> BUILT BY HERU PRASETYO'));
 assert.doesNotMatch(html,/Sistem Riset Kripto • Engineered by Heru Prasetyo/);
 assert.doesNotMatch(html,/SIGNAL OVER NOISE/);
 assert.match(html,/id="scanBtn"/);
 assert.match(html,/id="syncBtn"/);
});


test('cinematic Hunter V2 mirrors approved mockup without replacing live research data',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const assets='/assets/nebula-hunter-v2/';
 for(const name of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp']){
   const file=fs.readFileSync('.'+assets+name);
   assert.ok(file.length>100_000,'HD asset unexpectedly small: '+name);
   assert.equal(file.toString('ascii',0,4),'RIFF','Not a real WebP file: '+name);
   assert.equal(file.toString('ascii',8,12),'WEBP','Not WebP data: '+name);
   assert.ok(html.includes('assets/nebula-hunter-v2/'+name),'HUD should reference '+name);
 }
 assert.match(html,/NEBULA HUNTER V2 — Cinematic tactical bridge/);
 assert.match(html,/id="hunterAiTitle">AI PERFORMANCE/);
 assert.match(html,/id="hunterRadarTitle">TACTICAL TOKEN RADAR/);
 assert.match(html,/id="hunterHistoryTitle">DATABASE \/ HISTORY/);
 assert.match(html,/id="hunterDatabaseValue"/);
 assert.match(html,/id="hunterPredictionValue"/);
 assert.match(html,/id="hunterUniqueValue"/);
 assert.match(html,/class="hunter-cockpit-footer"/);
 assert.match(html,/id="radarFeed"/);
 assert.match(html,/id="cockpitDashboard"/);
 assert.match(html,/id="aiHealthDash"/);
 assert.match(html,/id="aiConsole"/);
 assert.match(html,/id="scanBtn"/);
 assert.match(html,/id="syncBtn"/);
 assert.match(html,/id="autoPumpToggleBtn"/);
 assert.match(html,/HUNT BEFORE THE HYPE/);
 assert.ok(html.indexOf('id="cockpitDashboard"')<html.indexOf('<!-- RESEARCH_PANEL -->'));
 const marker=html.indexOf('/* Hunter V2 UI companion: read-only');
 const companion=html.slice(marker);
 assert.match(companion,/get\('\/api\/research\/latest'\)/);
 assert.match(companion,/get\('\/api\/research\/history\?limit=10&offset=0'\)/);
 assert.match(companion,/c\.database_records/);
 assert.match(companion,/c\.total_records/);
 assert.match(companion,/c\.unique_mints/);
 assert.match(companion,/modelCalibrated===true/);
 assert.doesNotMatch(companion,/\/api\/research\/scan-now|method:'POST'|Math\.random\(\)/);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('Hunter V2 keeps accessible responsive controls and prevents decorating artwork from intercepting clicks',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/@media\(max-width:767px\)/);
 assert.match(html,/\.hunter-layout\{display:flex;flex-direction:column/);
 assert.match(html,/\.hunter-cockpit-footer\{[^}]*pointer-events:none/);
 assert.match(html,/\.hunter-banner \.hunter-ship,\.hunter-banner \.hunter-planet\{[^}]*pointer-events:none/);
 assert.match(html,/prefers-reduced-motion:reduce\)\{\.hunter-radar-sweep\{animation:none!important/);
 assert.match(html,/id="hunterRecentRefresh"/);
 assert.match(html,/id="hunterOpenHistory"/);
 assert.match(html,/hunterOpenHistory'\)\?\.addEventListener\('click',\(\)=>el\('historyBtn'\)\?\.click\(\)\)/);
 assert.ok(!html.includes('WATCH is a guaranteed trade'));
});


test('Hunter single-screen desktop keeps scrolling inside token and history containers',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const css=html.slice(html.indexOf('/* NEBULA HUNTER V2.1 — fixed single-viewport'));
 assert.match(css,/html,body\{width:100%;height:100%;height:100dvh;overflow:hidden!important/);
 assert.match(css,/\.app\{[\s\S]*?height:100dvh;min-height:0;[\s\S]*?overflow:hidden!important/);
 assert.match(css,/\.hunter-layout\{flex:1 1 0;min-height:0;max-height:none;height:auto;overflow:hidden!important/);
 assert.match(css,/\.hunter-targets-panel \.radar-grid\{[^}]*overflow-y:auto!important/);
 assert.match(css,/\.hunter-history-panel \.hunter-history-list\{[^}]*overflow-y:auto!important/);
 assert.match(css,/\.hunter-ai-panel \.ai-health-grid\{[^}]*overflow-y:auto!important/);
 assert.match(css,/\.hunter-cockpit-footer\{[^}]*flex:0 0 clamp/);
 assert.match(css,/\.app > \.nebula-server-dock\{position:fixed/);
 assert.match(css,/\.app > #scanFeedback:not\(\[hidden\]\)\{position:fixed/);
});
test('tablet and phone use three accessible tabs rather than vertically scrolling all panels',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const css=html.slice(html.indexOf('/* NEBULA HUNTER V2.1 — fixed single-viewport'));
 for(const tab of ['hunterTabAi','hunterTabRadar','hunterTabHistory'])assert.ok(html.includes('id="'+tab+'"'));
 assert.match(css,/@media \(max-width:1199px\)/);
 assert.match(css,/\.hunter-layout > \.hunter-panel\{display:none!important/);
 assert.match(css,/\.hunter-layout > \.hunter-panel\.hunter-tab-active\{display:flex!important/);
 assert.match(html,/chooseTab\('radar'\)/);
 assert.match(html,/button\.setAttribute\('aria-selected'/);
 assert.match(html,/button\.addEventListener\('click',\(\)=>chooseTab\(button\.dataset\.hunterTab\)\)/);
 assert.match(css,/@media \(max-height:640px\) and \(max-width:767px\)/);
 assert.match(css,/@media \(max-height:730px\) and \(min-width:1200px\)/);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
 assert.equal((html.match(/<script\b/g)||[]).length,1);
});

test('Hunter controls remain connected and AUTO controls read-only periodic refresh',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const ids=['scanBtn','syncBtn','autoPumpToggleBtn','historyBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','hunterRecentRefresh','hunterOpenHistory','hunterTabAi','hunterTabRadar','hunterTabHistory','overlayClose'];
 for(const id of ids)assert.ok(html.includes('id="'+id+'"'),id+' is missing');
 for(const pattern of [
  "$('scanBtn').onclick=Scanner.requestManualScan",
  "$('syncBtn').onclick=Scanner.requestScan",
  "$('historyBtn').onclick=()=>showHistoryPanel(0)",
  "$('archiveStatus').onclick=()=>showHistoryPanel(0)",
  "$('watchlistBtn').onclick=showWatchlistPanel",
  "$('exportBtn').onclick=showExportPanel",
  "$('auditBtn').onclick=showAuditPanel",
  "$('debugBtn').onclick=()=>",
  "$('overlayClose').onclick=()=>",
  "el('hunterRecentRefresh')?.addEventListener('click',refresh)",
  "el('hunterOpenHistory')?.addEventListener('click',()=>el('historyBtn')?.click())",
 ])assert.ok(html.includes(pattern),'Missing click handler: '+pattern);
 assert.ok(html.includes("window.setInterval(()=>{if(el('autoPumpToggleBtn')?.classList.contains('active'))void refresh()},60000)"));
 assert.ok(html.includes("btn.setAttribute('aria-pressed',String(S.isAuto))"));
 assert.ok(html.includes('aria-pressed="true"'));
 assert.ok(html.includes("e.key==='Escape'&&$('overlayPanel').style.display==='block'"));
 for(const action of ['watch','copyca','phantom','pump','dex','buy'])assert.ok(html.includes("a==='"+action+"'"),'Missing token action '+action);
 for(const name of ['exportCSV','exportJSON','exportAIReport','showHistoryPanel','showWatchlistPanel','showAuditPanel','renderDetail'])assert.ok(html.includes('function '+name+'('),'Missing function '+name);
});
test('Hunter indicators and independent panel scrolling remain intact',()=>{
 const html=fs.readFileSync('index.html','utf8');
 for(const id of ['modeSelect','riskProfile','endpointBar','aiHealthDash','unifiedDash','cockpitDashboard','radarFeed','aiConsole','overlayPanel','overlayContent','overlayClose','heroPanel','archiveStatus','scanFeedback','nebulaServerDetails'])
  if(id!=='nebulaServerDetails')assert.ok(html.includes('id="'+id+'"'),'Missing original subsystem '+id);
 for(const panel of ['TRADING','PERFORMANCE','DATABASE'])assert.ok(html.includes("label:'"+panel+"'"),'Missing advanced metrics group '+panel);
 for(const label of ['DATABASE','PREDICTION','UNIQUE'])assert.ok(html.includes("lbl:'"+label+"'"),'Missing metric '+label);
 const css=html.slice(html.indexOf('/* NEBULA HUNTER V2.1 — fixed single-viewport'));
 assert.match(css,/\.hunter-targets-panel \.radar-grid\{[^}]*overflow-y:auto!important/);
 assert.match(css,/\.hunter-history-panel \.hunter-history-list\{[^}]*overflow-y:auto!important/);
 assert.match(html,/\.overlay\s*\{[^}]*overflow-y:auto/);
 assert.match(css,/\.hunter-advanced\[open\]\{position:fixed/);
 for(const tab of ['ai','radar','history'])assert.ok(html.includes('data-hunter-tab="'+tab+'"'));
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 for(const m of scripts)new vm.Script(m[1]);
});

test('HD WebP layers replace SVG without losing original controls or static responsive layout',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.ok(!html.includes('assets/nebula-hunter-v2/01_background_nebula.svg'));
 for(const name of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp'])assert.ok(html.includes('assets/nebula-hunter-v2/'+name));
 assert.ok(html.includes('NEBULA HUNTER V2.1 — fixed single-viewport command bridge'));
 for(const id of ['scanBtn','syncBtn','autoPumpToggleBtn','historyBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','hunterTabAi','hunterTabRadar','hunterTabHistory','hunterDatabaseValue','hunterPredictionValue','hunterUniqueValue','radarFeed','hunterRecentList'])assert.ok(html.includes('id="'+id+'"'),id+' missing');
 assert.ok(html.includes('data-hunter-tab="history"'));
 assert.ok(html.includes('class="hunter-cockpit-footer"'));
 assert.ok(html.includes('HUNT BEFORE THE HYPE.'));
});
