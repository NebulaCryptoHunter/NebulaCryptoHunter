import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=html.slice(html.indexOf('/* V3.2 — restore click access'));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

test('Three desktop panels remain interactive; compact tab switches alone set inert',()=>{
 assert.match(html,/const compactPanels=window\.matchMedia\('\(max-width:1199px\)'\)/);
 assert.match(html,/const singlePanel=compactPanels\.matches/);
 assert.match(html,/panel\.inert=singlePanel&&!active/);
 assert.match(html,/panel\.setAttribute\('aria-hidden',String\(singlePanel&&!active\)\)/);
 assert.match(html,/compactPanels\.addEventListener\('change',restorePanels\)/);
 assert.doesNotMatch(html,/panel\.inert=!active/);
});

test('SERVER remains a slim bottom bar without using cockpit height budget',()=>{
 assert.match(css,/\.app>\.hunter-cockpit-footer\{[\s\S]*?position:absolute!important/);
 assert.match(css,/pointer-events:none!important/);
 assert.match(css,/\.app>\.nebula-server-dock>details:not\(\[open\]\)\{max-height:30px!important\}/);
 assert.match(css,/\.app>\.nebula-server-dock>details\[open\]\{max-height:min\(25dvh,220px\)!important\}/);
});

test('DATABASE and HISTORY controls stay clickable with list-only scrolling',()=>{
 for(const id of ['archiveStatus','hunterRecentRefresh','hunterOpenHistory','hunterRecentList','hunterTabHistory','historyBtn']){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(css,/\.hunter-history-panel #hunterRecentList\{[\s\S]*?overflow-y:auto!important/);
 assert.match(css,/\.hunter-history-panel \.hunter-history-tabs button\{[\s\S]*?min-height:30px!important/);
 assert.match(html,/\$\('archiveStatus'\)\.onclick=\(\)=>showHistoryPanel\(0\)/);
 assert.match(html,/el\('hunterRecentRefresh'\)\?\.addEventListener\('click',refresh\)/);
 assert.match(html,/el\('hunterOpenHistory'\)\?\.addEventListener\('click'/);
});

test('Radar actions, token details and history scroll controls remain wired',()=>{
 for(const id of ['radarFeed','hunterTokenPosition','tokenDetailDialog','tokenDetailClose','tokenDetailJump','showAllIndicators','scanBtn','syncBtn','autoPumpToggleBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','overlayClose']){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 for(const action of ['watch','copyca','phantom','pump','dex'])assert.ok(html.includes('data-action="'+action+'"'),action);
 assert.match(css,/\.hunter-targets-panel \.radar-grid>\.hud-card>\.token-card-body\{[\s\S]*?overflow-y:auto!important/);
 assert.match(css,/\.hunter-targets-panel \.radar-grid>\.hud-card>\.token-card-footer\{[\s\S]*?flex:0 0 42px!important/);
 assert.match(html,/document\.querySelectorAll\('\[data-scroll-target\]'\)\.forEach\(btn=>btn\.addEventListener\('click'/);
 for(const script of scripts)assert.doesNotThrow(()=>new Function(script));
});
