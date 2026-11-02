import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const polished=html.slice(html.indexOf('/* HUD V3.5'));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);

test('three-panel fullscreen HUD keeps original spaceship and instrument graphics',()=>{
 for(const id of ['hunterAiTitle','hunterRadarTitle','hunterHistoryTitle','radarFeed','aiHealthDash','hunterRecentList','hunterLoginLink'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(html,/\.app\{height:100dvh!important;min-height:0;overflow:hidden!important\}/);
 assert.ok(html.includes('hunterValidationOrbit'));
 assert.ok(html.includes('hunter-radar-sweep'));
 assert.ok(html.includes('nebula-hunter-v2/02_spaceship_hunter_hd.webp'));
 assert.ok(html.includes('nebula-hunter-v2/04_cockpit_console_hd.webp'));
});

test('history uses one slim scrollbar with two-row paging',()=>{
 assert.match(polished,/#hunterRecentList\{overflow-y:auto!important;scrollbar-gutter:auto!important/);
 assert.match(polished,/#hunterRecentList::-webkit-scrollbar\{width:5px!important\}/);
 assert.match(polished,/#hunterRecentList>\.hunter-history-row \.history-record-content\{overflow:visible!important\}/);
 assert.match(html,/flex:0 0 calc\(\(100% - 6px\)\/2\)!important/);
 assert.match(html,/const advanceHistory=\(list,direction\)=>/);
 assert.ok(html.includes('id="hunterHistoryPosition"'));
 assert.match(html,/target\.textContent=count\?\(Math\.min\(count,current\*2\+1\)/);
});

test('Radar keeps token paging and metrics scroll while hiding extra visible scrollbar',()=>{
 assert.match(polished,/\.hunter-targets-panel \.radar-grid\{overflow-y:auto!important/);
 assert.match(polished,/\.token-card-body\{scrollbar-width:none!important/);
 assert.match(polished,/\.token-card-body::-webkit-scrollbar\{display:none!important/);
 assert.match(html,/if\(id==='radarFeed'\)advanceToken/);
 assert.match(html,/const roomDown=e\.deltaY>0&&detail\.scrollTop/);
});

test('eight AI bars use larger legible labels without removing animation',()=>{
 for(const name of ['DATA POOL','HARGA','SKOR V4','API AKTIF','DATA SEGAR','CEK RISIKO','EVALUASI V4','RETURN POSITIF'])
  assert.ok(html.includes("'"+name+"'"),name);
 assert.match(polished,/\.instrument-bar \.lbl\{font-size:clamp\(11px,\.75vw,12px\)!important/);
 assert.match(polished,/\.instrument-bar-track\{min-height:7px!important/);
 assert.ok(html.includes('hunter-validation-orbit'));
});

test('bottom console shows latest event and opens the full on-session log',()=>{
 assert.ok(html.includes('id="hunterConsoleOpen"'));
 assert.match(polished,/\.ai-console\{display:flex!important;[\s\S]*?overflow:hidden!important/);
 assert.match(polished,/\.ai-console>\.log-entry:not\(:first-child\)\{display:none!important\}/);
 assert.match(html,/document\.getElementById\('hunterConsoleOpen'\)\?\.addEventListener\('click'/);
 assert.match(html,/root\.replaceChildren\(heading,hint,entries\);overlay\.style\.display='block'/);
});

test('KPI captions clearly distinguish distinct backend counts',()=>{
 assert.ok(html.includes('MULTI-TABLE RECORDS'));
 assert.ok(html.includes('LEGACY + CANDIDATES'));
 assert.ok(html.includes('◈ PREDICTION ARCHIVE'));
 for(const key of ['database_records','total_records','unique_mints']) assert.ok(html.includes('c.'+key));
});

test('all inline script bodies parse',()=>{
 assert.ok(scripts.length>0);
 for(const src of scripts)assert.doesNotThrow(()=>new Script(src));
});
