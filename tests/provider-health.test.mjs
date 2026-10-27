import test from 'node:test';
import assert from 'node:assert/strict';
import {providerHealth} from '../backend/workers/provider-health.mjs';
test('provider cache separates staging and production credentials', async()=>{
 const old=globalThis.caches, keys=[];
 globalThis.caches={default:{match:async key=>{keys.push(key.url);return Response.json({cached:true})}}};
 try{await providerHealth(new Request('https://api.internal/provider-health'),{},'staging');await providerHealth(new Request('https://api.internal/provider-health'),{},'production');assert.notEqual(keys[0],keys[1]);}finally{globalThis.caches=old}
});
