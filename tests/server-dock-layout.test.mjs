import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const dock=readFileSync(new URL('../backend/workers/research-panel.mjs',import.meta.url),'utf8');
const css=html.slice(html.indexOf('/* NEBULA V3.1 — SERVER is a reserved bottom'));

test('SERVER dock is bottom-flow, not a fixed overlay on desktop or Android',()=>{
  assert.ok(html.includes('<!-- RESEARCH_PANEL -->'));
  assert.ok(dock.includes('class=\\\"nebula-server-dock\\\"'));
  assert.ok(css.includes('.app > .nebula-server-dock{'));
  assert.match(css,/order:20;/);
  assert.match(css,/position:relative!important/);
  assert.match(css,/bottom:auto!important/);
  assert.match(css,/width:100%!important/);
  assert.match(css,/flex:0 0 auto/);
  assert.match(css,/@media\(max-width:767px\)/);
  assert.match(css,/padding-bottom:env\(safe-area-inset-bottom,0px\)!important/);
});

test('Expanded SERVER details scroll within the available viewport and never cover other menus',()=>{
  assert.match(css,/\.app > \.nebula-server-dock > details\[open\]\{/);
  assert.match(css,/overflow-y:auto!important/);
  assert.match(css,/max-height:min\(32dvh,260px\)!important/);
  assert.match(css,/max-height:min\(27dvh,188px\)!important/);
  assert.match(css,/text-overflow:ellipsis/);
  assert.match(css,/flex-wrap:nowrap!important/);
  assert.match(dock,/id=\\\"nebulaServerRefresh\\\"/);
});

test('Locked frontend navigation, HUD and server refresh remain intact',()=>{
  for(const id of ['hunterTabAi','hunterTabRadar','hunterTabHistory','radarFeed','hunterRecentList','aiHealthDash']){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.match(html,/panel\.inert=singlePanel&&!active/);
  assert.ok(dock.includes('setInterval(refresh,60000)'));
  assert.ok(html.includes('id="hunterLoginLink"'));
});
