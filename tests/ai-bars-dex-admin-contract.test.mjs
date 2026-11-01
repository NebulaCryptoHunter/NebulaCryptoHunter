import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
test('Eight accessible AI bars use different colors without simulated calibration',()=>{
  assert.match(script,/function instrumentBar\(/);
  assert.doesNotMatch(script,/function instrumentGauge\(/);
  assert.match(html,/class="hunter-model-validation"/);
  const start=script.indexOf('const bars=[');
  assert.ok(start>=0);
  const data=script.slice(start,script.indexOf('];',start));
  const colors=[...data.matchAll(/,'(#[0-9a-f]{6})',/g)].map(x=>x[1]);
  assert.equal(colors.length,8);
  assert.equal(new Set(colors).size,8);
  assert.match(script,/known\?Math\.round\(pct\)\+'%'\:'—'/);
  assert.match(html,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important;grid-template-rows:repeat\(4,minmax\(0,1fr\)\)!important/);
});
test('Header DEX link points to exact token mint and is visible before token footer',()=>{
  const i=script.indexOf('class="token-dex-shortcut"'),footer=script.indexOf('class="token-card-footer"');
  assert.ok(i>0&&footer>i);
  assert.ok(script.includes("getTokenDexUrl(t)||'#'"));
  assert.match(script,/data-dex-mint=/);
  assert.match(script,/target="_blank" rel="noopener noreferrer"/);
});
test('Quota read warnings never become persistent feed banners on refresh',()=>{
  assert.doesNotMatch(script,/message=quota\+/);
  assert.match(script,/txt\('hunterHistoryNotice',!history&&!quota\?/);
  assert.match(script,/SCAN: snapshot tidak tersimpan akibat kuota D1/);
  assert.match(script,/scanFeedbackDismissTimer=setTimeout\([\s\S]{0,160},10000\)/);
});
test('ADMIN ON is only rendered for a server-authenticated SUPER_ADMIN session',()=>{
  assert.match(html,/id="hunterLoginLink"/);
  assert.match(script,/fetch\('\/api\/auth\/me'/);
  assert.match(script,/d\?\.user\?\.role==='SUPER_ADMIN'/);
  assert.match(script,/mustChangePassword!==true/);
  assert.match(script,/classList\.toggle\('is-admin-on',ready\)/);
  assert.match(script,/ready\?'ADMIN ON':'ADMIN SETUP'/);
});
test('Complete frontend scripts still compile',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>0);
  for(const m of scripts)assert.doesNotThrow(()=>new Function(m[1]));
});
