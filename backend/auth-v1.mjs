// NEBULA multi-user-ready authentication module. Not activated until explicitly wired and tested.
// Use with Cloudflare D1 DB binding. No default credentials or registration endpoint.
const encoder = new TextEncoder();
const bytes = n => crypto.getRandomValues(new Uint8Array(n));
const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => { if(!/^(?:[a-f0-9]{2})+$/i.test(h)) throw Error('Invalid hex'); return Uint8Array.from(h.match(/../g), x=>parseInt(x,16)); };
const digest = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))));
const eq = (a,b) => { if(a.length!==b.length)return false; let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0; };
const ITERATIONS = 310000;
export async function hashPassword(password,salt=hex(bytes(16)),iterations=ITERATIONS){
  if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Invalid password length');
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations,hash:'SHA-256'},key,256);
  return {hash:hex(new Uint8Array(hash)),salt,iterations};
}
export async function verifyPassword(password,user){
  // Always use stored per-user salt and iteration count. Never return password hashes to clients.
  if(typeof password!=='string'||password.length>1024)return false;
  try {
    const h=await hashPassword(password,user.password_salt,user.password_iterations);
    return eq(unhex(h.hash),unhex(user.password_hash));
  }catch{return false;}
}
export async function createSession(DB,userId,{maxAgeSeconds=86400}={}){
  const raw=hex(bytes(32)), now=Math.floor(Date.now()/1000), expires=now+maxAgeSeconds;
  await DB.prepare('INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await digest(raw),userId,expires,now).run();
  return {token:raw,expires};
}
export function sessionCookie(token,{maxAgeSeconds=86400}={}){
  return `__Host-nebula_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookie(){
  return '__Host-nebula_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}
export async function authenticate(DB,request){
  const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-nebula_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!raw)return null;
  const now=Math.floor(Date.now()/1000);
  const user=await DB.prepare(`SELECT u.id,u.email,u.role,u.status,s.id_hash
    FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.status='active'`)
    .bind(await digest(raw),now).first();
  return user||null;
}
export function requireRole(user,roles=['SUPER_ADMIN']){
  return Boolean(user&&roles.includes(user.role));
}
export function validMutationOrigin(request,allowedOrigins){
  const origin=request.headers.get('Origin');
  if(!origin||!allowedOrigins.includes(origin))return false;
  const contentType=request.headers.get('Content-Type')||'';
  return contentType.startsWith('application/json');
}
export async function revokeSession(DB,request){
  const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-nebula_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(raw)await DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id_hash=?')
    .bind(Math.floor(Date.now()/1000),await digest(raw)).run();
}
// Integrator must add: login rate limits, generic login errors, CSRF origin checks,
// user provisioning out-of-band, logout, CORS allowlist, and route-level RBAC.
// Do not deploy this module alone: it does not protect any existing API route.
