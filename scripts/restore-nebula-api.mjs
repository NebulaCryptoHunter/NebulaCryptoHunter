import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const parts=Array.from({length:8},(_,i)=>readFileSync(new URL('../workers/nebula-api/source-parts/part-'+String(i+1).padStart(2,'0')+'.txt',import.meta.url),'utf8'));
let source=parts.join('');
// Stage-02 security patch: apply only to the verified original source.
const authGate="AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&method==='POST'&&!isAuth(request,env)";
if(source.split(authGate).length!==2)throw Error('API auth patch anchor changed; fail closed');
source=source.replace(authGate,"AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&!isAuth(request,env)");
// Browser sessions: validate against a dedicated D1 auth binding; never trust client-side role flags.
const authFn="function isAuth(req,env) {";
const sessionFn=`async function isSessionAdmin(req,env) {
  if(!env.AUTH_DB)return false;
  const cookie=req.headers.get('Cookie')||'';
  const match=cookie.match(/(?:^|;\\s*)nebula_session=([A-Za-z0-9_-]{32,256})(?:;|$)/);
  if(!match)return false;
  const bytes=new TextEncoder().encode(match[1]);
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const now=Math.floor(Date.now()/1000);
  const row=await env.AUTH_DB.prepare("SELECT u.role FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active' LIMIT 1").bind(hash,now).first();
  return row?.role==='SUPER_ADMIN';
}
`;
if(source.split(authFn).length!==2)throw Error('Missing session auth insertion anchor');
source=source.replace(authFn,sessionFn+authFn);
const gate="AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&!isAuth(request,env)";
if(source.split(gate).length!==2)throw Error('Missing auth gate anchor');
source=source.replace(gate,"AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&!isAuth(request,env)&&!(await isSessionAdmin(request,env))");

if(source.length<46580||source.includes('--- TRUNCATED ---')||!source.includes('export default'))throw Error('Incomplete production API source');
mkdirSync(new URL('../workers/nebula-api/',import.meta.url),{recursive:true});
writeFileSync(new URL('../workers/nebula-api/worker.mjs',import.meta.url),source);
console.log('Restored complete API source:',source.length,'characters');
