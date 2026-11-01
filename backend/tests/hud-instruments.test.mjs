import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function helper(name,next){
 const source=html.slice(html.indexOf('function '+name+'('),html.indexOf('function '+next+'('));
 return new Function('escapeHTML','fmtNum',source+'; return '+name)(escapeHTML,String);
}
const gauge=helper('instrumentGauge','renderResearchIndicators');
const pulse=helper('tokenPulse','tokenOrderFlow');
const flow=helper('tokenOrderFlow','buildCard');

test('instrument gauges preserve a measured zero and distinguish absent percentages',()=>{
 const zero=gauge('POOL',0,'Data source','cyan','0 / 12 TOKEN');
 assert.match(zero,/class="val">0%/);
 assert.match(zero,/stroke-dasharray="0 100"/);
 assert.doesNotMatch(zero,/is-unknown/);
 for(const value of [null,undefined,NaN,Infinity,-1,101]){
  const absent=gauge('PRECISION',value,'No validated measurement');
  assert.match(absent,/is-unknown/);
  assert.match(absent,/class="val">—/);
  assert.doesNotMatch(absent,/class="val">0%/);
 }
});
test('instrument coverage shows the actual ratio and escapes captions',()=>{
 const output=gauge('API',8/12*100,'<source>','cyan','8 / 12 API');
 assert.match(output,/class="val">67%/);
 assert.match(output,/8 \/ 12 API/);
 assert.match(output,/&lt;source&gt;/);
});
test('momentum compares observed horizons without inventing a price path',()=>{
 const output=pulse({timeframes:{m5:{changePct:-12.5},h1:{changePct:0}},change24h:25});
 assert.match(output,/-12\.50%/);
 assert.match(output,/>0\.00%/);
 assert.match(output,/\+25\.00%/);
 assert.match(output,/class="negative" style="width:25%"/);
 assert.doesNotMatch(output,/<polyline|<canvas/);
 const missing=pulse({timeframes:{m5:{changePct:null}},change24h:null});
 assert.equal((missing.match(/<b class="">—<\/b>/g)||[]).length,3);
});
test('order flow visualizes the measured buy sell split including zero buys',()=>{
 assert.match(flow({timeframes:{h1:{buys:30,sells:10}}}),/width:75%/);
 assert.match(flow({timeframes:{h1:{buys:0,sells:10}}}),/width:0%/);
 assert.match(flow({timeframes:{h1:{buys:30,sells:10}}}),/BUY <b>30/);
});
test('missing or empty order flow never becomes an illustrated 50 50 split',()=>{
 for(const h1 of [{},{buys:null,sells:10},{buys:-1,sells:10},{buys:0,sells:0}]){
  const output=flow({timeframes:{h1}});
  assert.match(output,/is-unknown/);
  assert.doesNotMatch(output,/<i style="width:/);
 }
});
