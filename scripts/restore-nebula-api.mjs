import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const parts=Array.from({length:8},(_,i)=>readFileSync(new URL('../workers/nebula-api/source-parts/part-'+String(i+1).padStart(2,'0')+'.txt',import.meta.url),'utf8'));
const source=parts.join('');
if(source.length!==46597||source.includes('--- TRUNCATED ---')||!source.includes('export default'))throw Error('Incomplete production API source');
mkdirSync(new URL('../workers/nebula-api/',import.meta.url),{recursive:true});
writeFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),source);
console.log('Restored complete API source:',source.length,'characters');
