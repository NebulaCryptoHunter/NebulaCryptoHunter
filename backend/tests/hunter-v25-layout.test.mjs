import {assertFrontendScripts} from './frontend-script-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync('index.html','utf8');
const idx=html.indexOf('/* NEBULA HUNTER V2.5 — one token per scroll-step');
const css=html.slice(idx,html.indexOf('</style>',idx));
const ok=value=>assert.ok(html.includes(value),'Missing: '+value);

test('one real token card fills the radar pane and scroll-snap advances one at a time',()=>{
 assert.ok(idx>0);
 assert.match(css,/\.hunter-targets-panel \.radar-grid\{[^}]*scroll-snap-type:y mandatory/);
 assert.match(css,/\.hunter-targets-panel \.radar-grid>\.hud-card\{[^}]*flex:0 0 100%!important/);
 assert.match(css,/min-height:100%!important;height:100%!important/);
 assert.match(css,/scroll-snap-align:start;scroll-snap-stop:always/);
 assert.match(css,/\.hud-card \.card-detail-section\{[^}]*overflow-y:auto!important/);
 ok("const advanceToken=(list,direction)=>");
 ok("if(id==='radarFeed')advanceToken(list,Math.sign(move[e.key]))");
 ok("if(btn.dataset.scrollTarget==='radarFeed')advanceToken(list,Number(btn.dataset.scrollDirection))");
 ok("list.addEventListener('wheel',e=>");
 ok("const detail=e.target.closest('.card-detail-section')");
 assert.doesNotMatch(html,/const detail=e\.target\.closest\('\.token-card-body'\)/);
 ok("if(roomDown||roomUp){wheelAccum=0;return}");
 ok("wheelAccum=0;lastStep=now;");
 ok('id="hunterTokenPosition"');
 ok("list.dataset.activeTokenCa=cards[index]?.dataset.ca||''");
 ok("const lastActiveCA=grid.dataset.activeTokenCa");
 ok('grid.dataset.activeTokenCa=lastActiveCA');
});
test('login is an actual accessible navigation to existing /account, all buttons remain',()=>{
 ok('id="hunterLoginLink" href="/account"');
 ok('class="hunter-login"');
 const gw=fs.readFileSync('backend/workers/frontend-gateway.mjs','utf8');
 assert.match(gw,/path==='\/account'&&method==='GET'/);
 for(const id of ['scanBtn','syncBtn','autoPumpToggleBtn','historyBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','modeSelect','riskProfile','hunterTabAi','hunterTabRadar','hunterTabHistory','overlayClose'])
   ok('id="'+id+'"');
});
test('AI model validation uses a compact status instead of a radial gauge',()=>{
 ok('class="hunter-model-validation"');
 ok('id="hunterCalibratedValue"');
 ok("set('hunterCalibratedValue',view.model?.startsWith('heuristic-v4.')?'V4'");
 ok("set('hunterCalibrationStatus','BELUM')");
 ok("function instrumentBar(");
 assert.doesNotMatch(html,/function instrumentGauge\(/);
 assert.match(css,/\.hunter-model-validation\{/);
 assert.match(css,/\.hunter-model-validation\.is-validated/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test('AI instruments fit without scroll; details and text opacity preserved',()=>{
 ok('id="aiHealthDash" class="ai-health-grid hunter-scrollable" tabindex="0"');
 assert.doesNotMatch(html,/data-scroll-target="aiHealthDash"/);
 ok('id="showAllIndicators"');
 ok("const ids=['radarFeed','hunterRecentList','aiHealthDash']");
 assert.match(css,/\.hunter-ai-panel #aiHealthDash\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.hunter-ai-panel #aiHealthDash\{[^}]*grid-template-rows:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.hunter-panel\{[\s\S]*?rgba\(5,17,40,.79\)/);
 assert.match(css,/\.hunter-kpi\{[\s\S]*?rgba\(4,21,49,.81\)/);
 assert.doesNotMatch(css,/\.hunter-panel\s*,\s*\.hunter-panel \*\s*\{text-shadow:inherit\}/);
 assert.doesNotMatch(css,/\.hunter-panel\s*\{[^}]*opacity:/);
 assert.match(css,/\.hunter-panel-heading h2,\.hunter-kpi-value,\.hunter-history-symbol,\.hunter-radar-status strong\{opacity:1\}/);
});
test('retains the Hunter spaceship, HD source layers, real data and one-page viewport',()=>{
 for(const asset of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp'])ok(asset);
 ok('NEBULA HUNTER V2.4 — TOKEN VISIBILITY FIRST');
 ok('NEBULA HUNTER V2.1 — fixed single-viewport command bridge');
 ok('id="hunterRecentList"');
 ok('id="radarFeed"');
 for(const tokenAction of ['watch','copyca','phantom','pump','dex','buy'])ok("a==='"+tokenAction+"'");
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 assertFrontendScripts(html);
 for(const [,source] of scripts)new vm.Script(source);
});
