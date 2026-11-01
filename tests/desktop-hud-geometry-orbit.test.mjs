import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
const correction=css.slice(css.indexOf('/* V3.0 — preserve Android'));
test('Model Validation restores the rotating visual without inventing a measured gauge',()=>{
 assert.match(html,/class="hunter-validation-orbit" aria-hidden="true"/);
 assert.match(correction,/\.hunter-validation-orbit:before\{[\s\S]*?animation:hunterValidationOrbit 9s linear infinite/);
 assert.match(correction,/\.hunter-validation-orbit:after\{[\s\S]*?animation:hunterValidationOrbit 18s linear infinite reverse/);
 assert.match(correction,/@media\(prefers-reduced-motion:reduce\)\{[\s\S]*?\.hunter-validation-orbit:before,\.hunter-validation-orbit:after\{animation:none!important\}/);
 assert.doesNotMatch(script,/function instrumentGauge\(/);
 assert.match(script,/function instrumentBar\(/);
 assert.match(script,/calibrated\?'READY':'PENDING'/);
});
test('Desktop AI panel budgets height and keeps 2 × 4 bars individually legible',()=>{
 assert.match(correction,/@media\(min-width:1200px\)\{/);
 assert.match(correction,/grid-template-rows:34px 79px 28px minmax\(0,1fr\) 14px 31px!important/);
 assert.match(correction,/\.hunter-ai-panel #aiHealthDash\{[\s\S]*?grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
 assert.match(correction,/\.hunter-ai-panel #aiHealthDash\{[\s\S]*?grid-template-rows:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(correction,/\.hunter-ai-panel #aiHealthDash \.instrument-bar\{[\s\S]*?overflow:hidden!important/);
 assert.match(correction,/\.hunter-ai-panel \.instrument-bar-head\{min-height:12px!important/);
 assert.match(correction,/@media\(min-width:1200px\) and \(max-height:740px\)/);
});
test('Radar reserves viewport for token heading, market telemetry, scrolling metrics and fixed action row',()=>{
 assert.match(correction,/grid-template-rows:35px 43px auto minmax\(0,1fr\)!important/);
 assert.match(correction,/\.radar-grid>\.hud-card>\.token-card-head\{[\s\S]*?flex:0 0 51px!important/);
 assert.match(correction,/\.radar-grid>\.hud-card>\.token-market-hero\{[\s\S]*?flex:0 0 62px!important/);
 assert.match(correction,/\.radar-grid>\.hud-card>\.token-card-body\{[\s\S]*?flex:1 1 0!important/);
 assert.match(correction,/\.token-card-body \.token-card-metrics\{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important/);
 assert.match(correction,/\.radar-grid>\.hud-card \.score-ring-container\{[\s\S]*?width:44px!important/);
 assert.match(correction,/\.radar-grid>\.hud-card>\.token-card-footer\{[\s\S]*?grid-template-rows:32px!important/);
 assert.match(correction,/\.token-card-footer \.token-card-actions\{[\s\S]*?repeat\(6,minmax\(0,1fr\)\)!important/);
 assert.match(html,/class="action-btn-text action-dex"/);
 assert.match(html,/id="radarFeed"/);
});
test('Android AI bar layout remains unchanged and new height changes target only desktop',()=>{
 assert.match(css,/@media\(max-width:767px\)\{[\s\S]*?\.hunter-ai-panel #aiHealthDash\{gap:3px!important\}/);
 const desktopRules=correction.slice(correction.indexOf('@media(min-width:1200px){'));
 assert.doesNotMatch(desktopRules,/@media\(max-width:767px\)/);
 for(const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(m[1]));
});
