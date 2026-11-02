import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const v=html.indexOf('/* V3.9 — RADAR CARD GEOMETRY FIX.');
const css=html.slice(v,html.indexOf('</style>',v));
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);

test('all four essential token metrics are visible in each radar card',()=>{
 assert.ok(v>=0);
 for(const metric of ['LIKUIDITAS','VOLUME 24J','Δ 24 JAM','SKOR HEURISTIK']){
  assert.ok(html.includes("metric('"+metric+"'"),metric);
 }
 assert.match(css,/\.radar-grid>\.hud-card>\.token-card-body\{[\s\S]*?overflow:visible!important/);
 assert.match(css,/\.radar-grid>\.hud-card \.token-card-metrics\{[\s\S]*?repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.radar-grid>\.hud-card \.token-card-metric dd\{/);
 assert.match(css,/@media\(max-width:1199px\)\{[\s\S]*?repeat\(2,minmax\(0,1fr\)\)!important/);
});
test('BUY-SELL 1-hour comparison is permanently visible, not part of a modal',()=>{
 assert.match(html,/function tokenOrderFlow\(t\)\{/);
 assert.match(html,/flow-labels/);
 assert.match(html,/ORDER FLOW · 1 JAM/);
 assert.match(html,/innerHTML\+=tokenOrderFlow\(t\);/);
 assert.match(css,/\.radar-grid>\.hud-card \.token-order-flow\{[\s\S]*?display:grid!important/);
 assert.match(css,/\.radar-grid>\.hud-card \.flow-labels\{[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\)!important/);
 assert.match(css,/\.radar-grid>\.hud-card \.flow-track\{[\s\S]*?height:6px!important/);
});
test('no inner scroll; wheel pages one token; full details remain available via existing dialog',()=>{
 assert.match(css,/flex:1 1 0!important;height:auto!important;min-height:0!important/);
 assert.match(css,/overflow:visible!important;overscroll-behavior:auto!important/);
 assert.doesNotMatch(html,/const detail=e\.target\.closest\('\.token-card-body'\)/);
 assert.match(html,/const detail=e\.target\.closest\('\.card-detail-section'\);/);
 assert.match(html,/advanceToken\(list,Math\.sign\(wheelAccum\)\)/);
 assert.match(html,/div\.querySelector\('\[data-token-detail\]'\)\.addEventListener\('click'/);
});
test('card still shows price, momentum, timestamps, risk, contract address and all six actions',()=>{
 for(const value of ['token-price-console','tokenPulse(t)','token-card-provenance','RISIKO BELUM DIVERIFIKASI','token-card-address',
  'data-action="watch"','data-action="copyca"','data-action="phantom"','data-action="pump"','data-action="dex"','DETAIL ↗']) assert.ok(html.includes(value),value);
 assert.match(css,/@media\(min-width:1200px\) and \(max-height:780px\)/);
 assert.match(css,/@media\(max-width:767px\) and \(max-height:760px\)/);
});
test('source frontend JavaScript still parses',()=>{
 assert.ok(scripts.length>0);
 for(const code of scripts)assert.doesNotThrow(()=>new Script(code));
});
