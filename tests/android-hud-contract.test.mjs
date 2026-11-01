import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);

test('NEBULA HUD JavaScript parses without syntax errors', () => {
  assert.ok(scripts.length, 'Page must contain its controller');
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test('Android tabs hide inactive AI and radar panels', () => {
  assert.match(html, /@media\(max-width:1199px\)\s*\{\s*\.hunter-layout > \.hunter-panel:not\(\.hunter-tab-active\)\{display:none!important/);
  assert.match(html, /panel\.inert=!active/);
  for (const tab of ['ai', 'radar', 'history']) assert.ok(html.includes('data-hunter-tab="'+tab+'"'));
});

test('Android token actions preserve the exact Solana mint and report copy errors', () => {
  assert.match(html, /return 'https:\/\/dexscreener\.com\/solana\/\+'\s*\+\s*ca/);
  assert.match(html, /async function copyToClipboard\(value\)/);
  assert.match(html, /showScanFeedback\('Alamat token gagal disalin:/);
  for (const action of ['watch', 'copyca', 'phantom', 'pump', 'dex', 'buy']) assert.ok(html.includes("data-action=\""+action+"\""));
});

test('Local WATCH does not claim a server write when read-only', () => {
  assert.match(html, /WATCH_LOCAL_KEY='nebula_local_watchlist_v1'/);
  assert.match(html, /WATCH disimpan di browser perangkat ini, bukan database server/);
  assert.match(html, /if\(window\.NEBULA_CAN_WRITE\)/);
});

test('HUD keeps feedback dismiss at 10s and token detail jump within dialog scroller', () => {
  assert.match(html, /scanFeedbackDismissTimer=setTimeout\([\s\S]{0,160},10000\)/);
  assert.match(html, /body\.scrollTo\(\{top:Math\.max\(0,body\.scrollTop/);
});
