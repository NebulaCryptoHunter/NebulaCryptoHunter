import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const marker='/* NEBULA HUNTER V2.4 — TOKEN VISIBILITY FIRST.';
const offset=html.indexOf(marker);
const styleEnd=html.indexOf('</style>',offset);
const css=html.slice(offset,styleEnd);

test('HUD prioritizes token list over decorative radar within one fullscreen viewport',()=>{
 assert.ok(offset>0,'Missing token visibility override');
 assert.ok(offset>html.indexOf('NEBULA HUNTER V2.3 — ICON SIZE'));
 assert.match(css,/\.hunter-targets-panel \.radar-grid\{[^}]*flex:1 1 0!important;min-height:0!important/);
 assert.match(css,/height:0;max-height:none!important/);
 assert.match(css,/overflow-x:hidden!important;overflow-y:scroll!important/);
 assert.match(css,/\.hunter-layout > \.hunter-targets-panel\{[^}]*min-height:0;overflow:hidden/);
 assert.match(css,/\.hunter-targets-panel \.hunter-radar-zone\{[^}]*height:54px!important;min-height:54px!important/);
 assert.match(css,/\.hunter-targets-panel \.hunter-radar-status p\{display:none!important\}/);
 assert.match(css,/\.hunter-console-wrap \.ai-console\{[^}]*height:30px!important;max-height:30px!important/);
 assert.match(css,/\.hunter-cockpit-footer\{[^}]*height:48px!important/);
 assert.match(html,/NEBULA HUNTER V2.1 — fixed single-viewport command bridge/);
});
test('previous Hunter spaceship size is restored, without altering the other HD layers',()=>{
 assert.match(css,/\.hunter-banner \.hunter-ship\{\s*width:min\(26%,310px\);height:auto;max-width:none;max-height:none;/);
 assert.match(css,/left:2%;top:-27px;transform:rotate\(-5deg\)/);
 for(const file of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp'])
 assert.ok(html.includes('assets/nebula-hunter-v2/'+file));
 assert.doesNotMatch(css,/\.hunter-banner \.hunter-planet\{/);
});
test('on tablet and mobile, token feed keeps flex scrolling within RADAR tab',()=>{
 assert.match(css,/@media\(max-width:1199px\)\{/);
 assert.match(css,/\.hunter-layout>\.hunter-targets-panel\.hunter-tab-active\{display:flex!important\}/);
 assert.match(css,/\.hunter-targets-panel \.radar-grid\{height:0\}/);
 assert.match(css,/@media\(max-width:767px\)\{/);
 assert.match(css,/\.hunter-banner \.hunter-ship\{\s*width:33%;height:auto;max-width:none;max-height:none;/);
 assert.match(html,/id="hunterTabRadar"/);
 assert.match(html,/id="radarFeed"/);
 assert.match(html,/data-scroll-target="radarFeed" data-scroll-direction="-1"/);
 assert.match(html,/data-scroll-target="radarFeed" data-scroll-direction="1"/);
});
test('scanner, data, token actions, score and indicators are preserved',()=>{
 const ids=['scanBtn','syncBtn','autoPumpToggleBtn','historyBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','radarFeed','archiveStatus','hunterRecentList','hunterDatabaseValue','hunterPredictionValue','hunterUniqueValue','hunterRadarBadge'];
 for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 for(const a of ['watch','copyca','phantom','pump','dex','buy'])assert.ok(html.includes("a==='"+a+"'"),'Missing token action '+a);
 assert.match(html,/class="score-ring-container"/);
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,1);
 for(const s of scripts)new vm.Script(s[1]);
});
