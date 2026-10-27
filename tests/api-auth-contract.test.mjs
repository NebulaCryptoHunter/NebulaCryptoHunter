import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('frontend does not embed a privileged API key or blank bearer',()=>{
 assert.doesNotMatch(html,/apiKey\s*:/);
 assert.doesNotMatch(html,/Authorization\s*['"]?\s*:\s*\x60Bearer/);
});
test('frontend uses same-origin session credentials for API calls',()=>{
 assert.match(html,/async function apiGet\(path\)[\s\S]{0,200}credentials:'same-origin'/);
 assert.match(html,/async function apiPost\(path,data\)[\s\S]{0,250}credentials:'same-origin'/);
});

test('401 and 403 are terminal responses, not retryable errors',()=>{
 assert.match(html,/\[401,403,404\]\.includes\(r\.status\)/);
 assert.match(html,/NEBULA API access denied/);
});

test('protected API routes require authorization on GET and POST',()=>{
 const api=readFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),'utf8');
 assert.match(api,/AUTH_REQUIRED\.some\(p=>path===p\|\|path\.startsWith\(p\+'\/'\)\)\&\&!isAuth\(request,env\)/);
 assert.doesNotMatch(api,/AUTH_REQUIRED\.some\([^\n]*method==='POST'/);
});

test('browser session is verified server-side against auth database',()=>{
 const api=readFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),'utf8');
 assert.match(api,/async function isSessionAdmin\(req,env\)/);
 assert.match(api,/env\.AUTH_DB\.prepare\(/);
 assert.match(api,/crypto\.subtle\.digest\('SHA-256'/);
 assert.match(api,/s\.revoked_at IS NULL AND s\.expires_at>\?/);
 assert.match(api,/u\.status='active'/);
 assert.match(api,/row\?\.role==='SUPER_ADMIN'/);
 assert.match(api,/await isSessionAdmin\(request,env\)/);
});
