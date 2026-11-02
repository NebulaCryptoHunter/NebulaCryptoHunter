import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('/* V3.6 — reveal original NEBULA space');
const css=html.slice(begin,html.indexOf('</style>',begin));
const main=css.match(/\.bg-nebula\{([\s\S]*?)\n\}/)?.[1]||'';
const banner=css.match(/\.hunter-banner\{([\s\S]*?)\n\}/)?.[1]||'';

test('preserve the largest Earth in the original HD header artwork',()=>{
 assert.ok(begin>=0);
 assert.match(banner,/01_background_nebula_hd\.webp/);
 assert.match(banner,/background-size:cover,cover,cover!important/);
 assert.match(banner,/background-position:center,center,center 24%!important/);
 assert.match(css,/\.hunter-banner img\.hunter-planet\{display:none!important\}/);
 assert.equal((html.match(/class="hunter-planet"/g)||[]).length,1);
});

test('body space backdrop excludes the original Earth while retaining nebula and stars',()=>{
 assert.match(main,/01_background_nebula_hd\.webp/);
 assert.match(main,/background-size:cover,max\(165%,180vh\) auto!important/);
 assert.match(main,/background-position:center top,left top!important/);
 assert.match(main,/background-repeat:no-repeat!important/);
 assert.match(css,/\.hunter-banner::before\{[\s\S]*?radial-gradient\(circle,rgba\(230,253,255,\.89\)/);
 assert.match(css,/\.hunter-banner .hunter-ship\{[\s\S]*?z-index:1!important/);
});

test('preserve ship, controls, responsive layout, and executable frontend',()=>{
 for(const name of ['02_spaceship_hunter_hd.webp','03_planet_hologram_hd.webp','04_cockpit_console_hd.webp'])
  assert.ok(html.includes(name),name);
 for(const id of ['hunterRadarTitle','hunterHistoryTitle','hunterAiTitle','radarFeed','hunterRecentList','hunterConsoleOpen','hunterLoginLink'])
  assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(css,/@media\(max-width:767px\)/);
 const inlineScripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
 assert.ok(inlineScripts.length>0);
 for(const src of inlineScripts)assert.doesNotThrow(()=>new Script(src));
});
