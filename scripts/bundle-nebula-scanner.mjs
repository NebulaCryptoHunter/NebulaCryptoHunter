import {cpSync,mkdirSync} from 'node:fs';
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});
for(const file of ['nebula-scanner.mjs','research-evaluation.mjs','research-cache.mjs','provider-runtime.mjs','market-sources.mjs'])cpSync(new URL('../backend/workers/'+file,import.meta.url),new URL('../dist/'+file,import.meta.url));
