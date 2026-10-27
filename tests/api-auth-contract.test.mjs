import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),'utf8');
test('frontend does not embed a privileged API key or blank bearer',()=>{
 assert.doesNotMatch(html,/apiKey\s*:/);
 assert.doesNotMatch(html,/Authorization\s*['"]?\s*:\s*\x60Bearer/);
});
test('frontend uses same-origin session credentials for API calls',()=>{
 assert.match(html,/async function apiGet\(path\)[\s\S]{0,200}credentials:'same-origin'/);
 assert.match(html,/async function apiPost\(path,data\)[\s\S]{0,250}credentials:'same-origin'/);
});
test('API rejects unauthenticated protected methods',()=>{
 assert.match(api,/AUTH_REQUIRED\.some\(/);
 assert.doesNotMatch(api,/AUTH_REQUIRED\.some\([^\n]*method\s*===?\s*['"]POST/);
});
test('API does not accept an empty configured secret',()=>{
 assert.match(api,/env\.API_KEY\.length\s*>\s*0/);
});
