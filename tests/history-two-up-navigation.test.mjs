import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const newCSS=html.slice(html.indexOf('/* V3.3: Desktop DATABASE / HISTORY'));
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const historyCSS=newCSS.slice(0,newCSS.indexOf('/* V3.3 radar micro-adjustment'));

test('two whole history rows fit per desktop viewport, with pair scroll snapping',()=>{
 assert.match(historyCSS,/@media\(min-width:1200px\)/);
 assert.match(historyCSS,/#hunterRecentList>\.hunter-history-row\{/);
 assert.match(historyCSS,/flex:0 0 calc\(\(100% - 6px\)\/2\)!important/);
 assert.match(historyCSS,/height:calc\(\(100% - 6px\)\/2\)!important/);
 assert.match(historyCSS,/max-height:calc\(\(100% - 6px\)\/2\)!important/);
 assert.match(historyCSS,/#hunterRecentList>\.hunter-history-row:nth-child\(odd\)/);
 assert.match(historyCSS,/scroll-snap-align:start!important/);
 assert.match(historyCSS,/\.history-record-content\{[\s\S]*?overflow-y:auto/);
});

test('history navigation, keyboard and mouse wheel all move one pair, other panel scrolls unchanged',()=>{
 assert.match(html,/const advanceHistory=\(list,direction\)=>\{/);
 assert.match(html,/rows\.filter\(\(_,index\)=>index%2===0\)/);
 assert.match(html,/list\.scrollTo\(\{top:pageStarts\[next\],behavior:'smooth'\}\)/);
 assert.match(html,/id==='hunterRecentList'&&historyDesktop\(\)\)advanceHistory\(list,Math\.sign\(move\[e\.key\]\)\)/);
 assert.match(html,/btn\.dataset\.scrollTarget==='hunterRecentList'&&historyDesktop\(\)\)advanceHistory\(list,Number\(btn\.dataset\.scrollDirection\)\)/);
 assert.match(html,/if\(id==='hunterRecentList'\)\{[\s\S]*?list\.addEventListener\('wheel'/);
 assert.match(html,/if\(id==='radarFeed'\)advanceToken\(list,Number\(btn\.dataset\.scrollDirection\)\)/);
});

test('Tactical Radar token header fits its emblem with no clipping; mobile rules untouched',()=>{
 assert.match(newCSS,/\.token-card-head\{[\s\S]*?height:58px!important;flex:0 0 58px!important/);
 assert.match(newCSS,/\.token-card-head\{[\s\S]*?overflow:visible!important/);
 assert.match(newCSS,/\.token-emblem\{[\s\S]*?height:44px!important;width:44px!important/);
 assert.match(newCSS,/@media\(min-width:1200px\) and \(max-height:740px\)/);
 assert.match(newCSS,/height:54px!important;flex-basis:54px!important/);
 assert.ok(html.includes('class="hunter-panel hunter-targets-panel"'));
 assert.ok(html.includes('id="radarFeed"'));
});

test('all inline frontend scripts parse; database and history handlers remain',()=>{
 assert.ok(script.length>0);
 for(const src of script) assert.doesNotThrow(()=>new Script(src));
 for(const id of ['archiveStatus','hunterRecentRefresh','hunterOpenHistory','hunterRecentList','hunterTabHistory'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/el\('hunterRecentRefresh'\)\?\.addEventListener\('click',refresh\)/);
 assert.match(html,/el\('hunterOpenHistory'\)\?\.addEventListener\('click'/);
});
