import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const patch=html.slice(html.indexOf('/* V3.8: optical/header centering'),html.indexOf('</style>'));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);

test('title box is positioned at the exact horizontal and vertical center',()=>{
 assert.match(patch,/\.hunter-banner \.hunter-brand\{[\s\S]*?position:absolute!important/);
 assert.match(patch,/left:50%!important;top:50%!important/);
 assert.match(patch,/transform:translate\(-50%,-50%\)!important/);
 assert.match(patch,/text-align:center!important;z-index:2!important/);
 assert.ok(html.includes('NEBULA CRYPTO HUNTER'));
 assert.ok(html.includes('HUNT BEFORE THE HYPE.'));
});

test('both neon side brackets are mathematically symmetrical and aligned',()=>{
 const common=patch.match(/\.hunter-banner \.hunter-brand::before,\s*\.hunter-banner \.hunter-brand::after\{([\s\S]*?)\n\}/);
 assert.ok(common);
 assert.match(common[1],/width:19px!important;height:42px!important/);
 assert.match(common[1],/top:50%!important;bottom:auto!important/);
 assert.match(common[1],/transform:translateY\(-50%\)!important/);
 assert.match(patch,/border-width:2px 0 2px 2px!important/);
 assert.match(patch,/border-width:2px 2px 2px 0!important/);
 assert.match(patch,/left:0!important;right:auto!important/);
 assert.match(patch,/right:0!important;left:auto!important/);
});

test('tablet and mobile use scaled symmetrical corner frame',()=>{
 assert.match(patch,/@media\(max-width:1199px\)/);
 assert.match(patch,/@media\(max-width:767px\)/);
 assert.match(patch,/max-width:calc\(100% - 106px\)!important/);
 assert.match(patch,/height:30px!important;width:11px!important/);
});

test('no change to big Earth, ship, three panels, or executable scripts',()=>{
 assert.match(html,/\.hunter-banner img\.hunter-planet\{display:none!important\}/);
 assert.ok(html.includes('01_background_nebula_hd.webp'));
 assert.ok(html.includes('02_spaceship_hunter_hd.webp'));
 for(const id of ['hunterRadarTitle','hunterAiTitle','hunterHistoryTitle','radarFeed','hunterRecentList','hunterConsoleOpen','hunterLoginLink'])
  assert.ok(html.includes('id="'+id+'"'),id);
 for(const src of scripts)assert.doesNotThrow(()=>new Script(src));
});
