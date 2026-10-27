import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const source=readFileSync(new URL('../backend/workers/nebula-api.mjs',import.meta.url),'utf8');
mkdirSync(new URL('../workers/nebula-api/',import.meta.url),{recursive:true});
writeFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),source.replace("'./provider-health.mjs'","'../../backend/workers/provider-health.mjs'"));
