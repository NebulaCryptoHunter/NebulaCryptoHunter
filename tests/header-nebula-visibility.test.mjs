import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=html.slice(html.indexOf('/* V3.6 — reveal original NEBULA space'));
const original='01_background_nebula_hd.webp';
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

test('same original background HD remains; no asset swaps',()=>{
 assert.ok(css.includes(original));
 assert.ok(html.includes('02_spaceship_hunter_hd.webp'));
 assert.ok(html.includes('03_planet_hologram_hd.webp'));
 assert.ok(html.includes('04_cockpit_console_hd.webp'));
 assert.equal((css.match(new RegExp(original,'g'))||[]).length,2);
});

test('show high-detail nebula in banner without excessive blur',()=>{
 assert.match(css,/\.bg-nebula\{[\s\S]*?rgba\(0,5,20,\.76\)/);
 assert.match(css,/\.hunter-banner\{[\s\S]*?url\("https:\/\/raw\.githubusercontent\.com\/NebulaCryptoHunter/);
 assert.match(css,/\.sticky-nav\{[\s\S]*?backdrop-filter:blur\(2px\)!important/);
 assert.match(css,/\.hunter-banner\{[\s\S]*?filter:none!important/);
 assert.match(css,/\.hunter-banner .hunter-brand .header-row-2\{/);
});

test('pinpoint starfield is a static noninteractive overlay behind content',()=>{
 assert.match(css,/\.hunter-banner::before\{/);
 assert.match(css,/pointer-events:none/);
 assert.match(css,/radial-gradient\(circle,rgba\(230,253,255,\.89\)/);
 assert.match(css,/\.hunter-banner \.hunter-ship,\.hunter-banner \.hunter-planet\{[\s\S]*?z-index:1!important/);
 assert.match(css,/\.hunter-banner \.hunter-brand\{z-index:2!important\}/);
 assert.doesNotMatch(css,/animation:/);
});

test('desktop and Android still retain all three panels and buttons',()=>{
 for(const id of ['hunterAiTitle','hunterRadarTitle','hunterHistoryTitle','radarFeed','hunterRecentList','hunterConsoleOpen','hunterLoginLink']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(css,/@media\(max-width:767px\)/);
 assert.match(html,/\.app\{height:100dvh!important;min-height:0;overflow:hidden!important\}/);
 for(const source of script)assert.doesNotThrow(()=>new Script(source));
});
