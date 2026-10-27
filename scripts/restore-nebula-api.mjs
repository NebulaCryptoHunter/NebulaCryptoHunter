import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const parts=Array.from({length:8},(_,i)=>readFileSync(new URL('../workers/nebula-api/source-parts/part-'+String(i+1).padStart(2,'0')+'.txt',import.meta.url),'utf8'));
let source=parts.join('');
// Stage-02 security patch: apply only to the verified original source.
const authGate="AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&method==='POST'&&!isAuth(request,env)";
if(source.split(authGate).length!==2)throw Error('API auth patch anchor changed; fail closed');
source=source.replace(authGate,"AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&!isAuth(request,env)");
if(source.length!==46580||source.includes('--- TRUNCATED ---')||!source.includes('export default'))throw Error('Incomplete production API source');
mkdirSync(new URL('../workers/nebula-api/',import.meta.url),{recursive:true});
writeFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),source);
console.log('Restored complete API source:',source.length,'characters');
