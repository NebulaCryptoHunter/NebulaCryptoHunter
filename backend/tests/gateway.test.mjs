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
 const html=transformFrontend(fs.readFileSync('index.html','utf8'));assert.doesNotMatch(html,/apiKey\s*:/);assert.ok(!html.includes('https://nebula-api.nebula-crypto-proxy.workers.dev'));assert.ok(html.includes('id="nebulaResearchDock"'));assert.ok(html.includes('id="nebulaManualScan"'));assert.ok(html.indexOf('id="cockpitDashboard"')<html.indexOf('id="nebulaResearchDock"'));assert.doesNotMatch(html,/id="researchPanel"/);assert.equal(transformFrontend(html),html);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
test('API returns 400 for malformed JSON instead of 500',async()=>{assert.equal((await api.fetch(new Request(origin+'/api/v1/predictions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),{},{})).status,400)});
test('API bounds streamed payload without content length',async()=>{assert.equal((await api.fetch(new Request(origin+'/api/v1/predictions',{method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(262145)}),{},{})).status,413)});
test('manual scan requires login and cannot write anonymously',async()=>{assert.equal((await gateway.fetch(post('/api/research/scan',{mints:[]}),{})).status,401)});

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

test('historical archive stays separate and visible beside scanner snapshots',()=>{
 const html=fs.readFileSync('index.html','utf8');
 assert.match(html,/id="archiveStatus"/);
 assert.match(html,/id="archiveCount"/);
 assert.match(html,/\/api\/v1\/stats/);
 assert.match(html,/\/api\/v1\/predictions\?limit=/);
 assert.match(html,/legacyArchiveCount=n/);
 assert.match(html,/function showHistoryPanel\(offset=0\)/);
 assert.match(html,/Menampilkan /);
 assert.match(html,/S\.dash\.dbTotal=json\.counts\?\.snapshots/);
 assert.match(html,/S\.serverResearchCounts=json\.counts/);
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
 const scan=await gateway.fetch(post('/api/research/scan',{mints:[]}),env);
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
 const scan=await gateway.fetch(post('/api/research/scan',{mints:[]}),env);
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


test('manual scan requires an authenticated Admin and refuses invalid mints',async()=>{
 const AUTH_DB={prepare(){return{bind(){return this},async first(){return {role:'SUPER_ADMIN',id:'admin'}}}}};
 const env={AUTH_DB,SCANNER:{fetch:async()=>{throw Error('scanner should not be called')}},MANUAL_SCAN_TOKEN:'private-test-secret'};
 const request=(mints)=>post('/api/research/scan',{mints},{Cookie:'__Host-nebula_session='+'a'.repeat(64)});
 for(const mints of [[],['not-a-solana-mint'],Array(6).fill('So11111111111111111111111111111111111111112')]){
  const r=await gateway.fetch(request(mints),env);assert.equal(r.status,400);
 }
 const unauthed=await gateway.fetch(post('/api/research/scan',{mints:['So11111111111111111111111111111111111111112']}),env);
 assert.equal(unauthed.status,401);
});
test('Admin manual scan forwards private credential, persists observations, never returns secret',async()=>{
 const mint='So11111111111111111111111111111111111111112';
 let calls=0;
 const AUTH_DB={prepare(){return{bind(){return this},async first(){return {role:'SUPER_ADMIN',id:'admin'}}}}};
 const env={AUTH_DB,MANUAL_SCAN_TOKEN:'private-manual-token',SCANNER:{fetch:async(url,options)=>{
  calls++;assert.equal(new URL(url).pathname,'/pipeline');
  assert.equal(new URL(url).searchParams.get('persist'),'1');
  assert.equal(new URL(url).searchParams.get('mint'),mint);
  assert.equal(options.headers.Authorization,'Bearer private-manual-token');
  return Response.json({mint,items:[{pairAddress:'pair-id'}],persisted:true,results:[{score:42}]});
 }}};
 const r=await gateway.fetch(post('/api/research/scan',{mints:[mint,mint]},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),env);
 assert.equal(r.status,200);assert.equal(calls,1);
 const output=await r.text();assert.doesNotMatch(output,/private-manual-token/);
 const payload=JSON.parse(output);assert.equal(payload.totalObservations,1);
 assert.equal(payload.results[0].persisted,true);
 const health=await gateway.fetch(new Request(origin+'/health'),env);
 assert.equal((await health.json()).manualScanAvailable,true);
});
test('manual scan propagates provider rate-limit without claiming success',async()=>{
 const mint='So11111111111111111111111111111111111111112';
 const AUTH_DB={prepare(){return{bind(){return this},async first(){return {role:'SUPER_ADMIN',id:'admin'}}}}};
 const env={AUTH_DB,MANUAL_SCAN_TOKEN:'x',SCANNER:{fetch:async()=>Response.json({error:'PROVIDER_COOLDOWN'},{status:429})}};
 const r=await gateway.fetch(post('/api/research/scan',{mints:[mint]},{Cookie:'__Host-nebula_session='+'a'.repeat(64)}),env);
 assert.equal(r.status,429);assert.equal((await r.json()).success,false);
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
