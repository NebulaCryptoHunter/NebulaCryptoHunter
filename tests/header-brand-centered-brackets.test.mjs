import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const at=html.indexOf('/* V4.1 — revive the original outlined cyan title BOX');
const patch=html.slice(at,html.indexOf('</style>',at));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]);

test('restored title frame keeps the NEBULA heading at the exact banner center',()=>{
 assert.ok(at>0);
 assert.match(patch,/\.hunter-banner \.hunter-brand\{[\s\S]*?position:absolute!important/);
 assert.match(patch,/left:50%!important;top:50%!important/);
 assert.match(patch,/transform:translate\(-50%,-50%\)!important/);
 assert.match(patch,/width:max-content!important/);
 assert.match(patch,/text-align:center!important/);
 assert.match(patch,/border:1px solid rgba\(52,217,252,\.23\)!important/);
 assert.match(patch,/background:linear-gradient\(90deg,rgba\(3,27,50,\.43\)/);
 assert.ok(html.includes('NEBULA CRYPTO HUNTER'));
 assert.ok(html.includes('HUNT BEFORE THE HYPE.'));
});

test('left and right cyan box brackets share the same height and central origin',()=>{
 const common=patch.match(/\.hunter-banner \.hunter-brand::before,\s*\.hunter-banner \.hunter-brand::after\{([\s\S]*?)\n\}/);
 assert.ok(common);
 assert.match(common[1],/width:22px!important;height:calc\(100% - 8px\)!important/);
 assert.match(common[1],/top:50%!important;bottom:auto!important/);
 assert.match(common[1],/transform:translateY\(-50%\)!important/);
 assert.match(patch,/border-width:2px 0 2px 2px!important/);
 assert.match(patch,/border-width:2px 2px 2px 0!important/);
 assert.match(patch,/left:-1px!important;right:auto!important/);
 assert.match(patch,/right:-1px!important;left:auto!important/);
});

test('boxed title scales for tablet and mobile without losing centered brackets',()=>{
 assert.match(patch,/@media\(max-width:1199px\)/);
 assert.match(patch,/@media\(max-width:767px\)/);
 assert.match(patch,/max-width:calc\(100% - 106px\)!important/);
 assert.match(patch,/height:calc\(100% - 6px\)!important/);
 assert.match(patch,/white-space:normal!important/);
});

test('no visual or behavioral changes to large Earth, ship, navigation panels and scripts',()=>{
 assert.match(html,/\.hunter-banner img\.hunter-planet\{display:none!important\}/);
 for(const src of ['01_background_nebula_hd.webp','02_spaceship_hunter_hd.webp']) assert.ok(html.includes(src));
 for(const id of ['hunterRadarTitle','hunterAiTitle','hunterHistoryTitle','radarFeed','hunterRecentList','hunterConsoleOpen','hunterLoginLink'])
  assert.ok(html.includes('id="'+id+'"'),id);
 for(const src of scripts)assert.doesNotThrow(()=>new Script(src));
});
