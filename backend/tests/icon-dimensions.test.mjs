import {assertFrontendScripts} from './frontend-script-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('index.html','utf8');
const marker='/* NEBULA HUNTER V2.3 — ICON SIZE / HIT-AREA AUDIT';
const offset=html.indexOf(marker);
const css=html.slice(offset,html.indexOf('</style>',offset));
const ids=['scanBtn','syncBtn','autoPumpToggleBtn','historyBtn','watchlistBtn','exportBtn','auditBtn','debugBtn','modeSelect','riskProfile','hunterTabAi','hunterTabRadar','hunterTabHistory','hunterRecentRefresh','hunterOpenHistory','radarFeed','hunterRecentList'];
const includes=(source,part)=>assert.ok(source.includes(part),'Required CSS/markup missing: '+part);

test('icon audit overrides late responsive CSS rather than altering original controls',()=>{
 assert.ok(offset>0);
 assert.ok(offset>html.indexOf('/* NEBULA HUNTER V2.1 — fixed single-viewport command bridge'));
 assert.ok(offset>html.indexOf('/* Hunter V2.2 — explicit scrollbars'));
 for(const id of ids)includes(html,'id="'+id+'"');
 assert.match(css,/presentation-only/);
 includes(html,'HUNT BEFORE THE HYPE.');
 assert.match(html,/NEBULA HUNTER V2.1 — fixed single-viewport command bridge/);
 const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
 assertFrontendScripts(html);
 for(const src of scripts)new vm.Script(src[1]);
});
test('12 provider LEDs and chips stay present with readable minimum dimensions',()=>{
 includes(html,"'PUMP','DEX','HELIUS','RUGCHECK','JUPITER','GECKO','BIRDEYE','ANKR','SOLANA_RPC','PUMP_WS','COINGECKO','COINPAPRIKA'");
 includes(css,'.sticky-nav .ep-mini');
 includes(css,'min-height:36px!important;height:36px!important');
 includes(css,'.sticky-nav .ep-mini .indicator-dot');
 includes(css,'width:8px;height:8px;flex:0 0 8px');
 includes(css,'grid-template-columns:repeat(4,minmax(0,1fr))');
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(css,/@media\(max-height:640px\)/);
});
test('all 8 command buttons and secondary controls meet touch hit area targets',()=>{
 includes(css,'--hunter-tap:40px');
 includes(css,'height:var(--hunter-tap)!important;min-height:var(--hunter-tap)!important');
 includes(css,'.hunter-scroll-controls button');
 includes(css,'min-height:40px!important');
 includes(css,'.hunter-mobile-tabs button');
 includes(css,'.overlay-close,.export-btn,.archive-pager button');
 includes(css,'min-width:42px;min-height:42px');
 assert.match(css,/\.hud-card \.action-btn-text\{[\s\S]*?min-height:40px!important/);
 assert.match(css,/@media\s*\(max-width:767px\)/);
 includes(css,'grid-template-columns:repeat(3,minmax(0,1fr))!important');
});
test('score/rank/gauge and all sensor badges remain visible, with consistent icon scale',()=>{
 includes(css,'.hud-card .score-ring-container');
 includes(css,'width:44px;height:44px;flex:0 0 44px');
 includes(css,'font-size:11px!important');
 includes(css,'.hud-card .confidence-badge,.hud-card .wallet-badge,');
 includes(css,'.hud-card .ob-badge,.hud-card .fvg-badge');
 includes(css,'.hud-card .cache-badge,.hud-card .multiplier-badge-card');
 includes(css,'font-size:10px;line-height:1.25;white-space:normal');
 includes(css,'.hud-card .ob-badge,.hud-card .fvg-badge{display:inline-flex!important}');
 includes(css,'.hud-gauge .gauge-track{height:9px}');
 includes(css,'.hunter-kpi-icon');
 includes(css,'display:grid!important;width:18px;height:18px');
 includes(css,'.hunter-panel-icon');
 includes(css,'font-size:22px;line-height:1;white-space:nowrap');
 includes(css,'.hunter-banner .hunter-ship');
 includes(css,'.hunter-banner .hunter-planet');
});
test('original active data UI, images, research buttons and per-panel scroll are not dropped',()=>{
 for(const path of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp'])
   includes(html,'assets/nebula-hunter-v2/'+path);
 for(const action of ['watch','copyca','phantom','pump','dex','buy'])
   includes(html,"a==='"+action+"'");
 for(const panel of ['AI PERFORMANCE','TACTICAL TOKEN RADAR','DATABASE / HISTORY'])
   includes(html,panel);
 for(const indicator of ['hunterDatabaseValue','hunterPredictionValue','hunterUniqueValue','hunterRadarBadge'])
   includes(html,'id="'+indicator+'"');
 for(const scrollTarget of ['radarFeed','hunterRecentList'])includes(html,'data-scroll-target="'+scrollTarget+'"');
 assert.match(css,/\.hud-card > div:first-child > div:first-child\{[\s\S]*?flex-wrap:wrap/);
});
