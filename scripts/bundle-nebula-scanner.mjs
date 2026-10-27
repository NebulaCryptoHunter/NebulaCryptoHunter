import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base=new URL('../backend/workers/',import.meta.url);
const scanner=readFileSync(new URL('nebula-scanner.mjs',base),'utf8').replace("import {evaluateResearch} from './research-evaluation.mjs';",'');
const evaluation=readFileSync(new URL('research-evaluation.mjs',base),'utf8').replace('export async function','async function');
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});
writeFileSync(new URL('../dist/nebula-scanner.mjs',import.meta.url),evaluation+'\n'+scanner);
