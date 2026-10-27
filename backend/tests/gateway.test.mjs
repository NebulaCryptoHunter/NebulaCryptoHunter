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
 const html=transformFrontend(fs.readFileSync('index.html','utf8'));assert.doesNotMatch(html,/apiKey\s*:/);assert.ok(!html.includes('https://nebula-api.nebula-crypto-proxy.workers.dev'));assert.ok(html.includes('id="nebulaResearchDock"'));assert.ok(html.indexOf('id="cockpitDashboard"')<html.indexOf('id="nebulaResearchDock"'));assert.doesNotMatch(html,/id="researchPanel"/);assert.equal(transformFrontend(html),html);
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

