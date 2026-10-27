// NEBULA multi-user-ready authentication module. Not activated until explicitly wired and tested.
// Use with Cloudflare D1 DB binding. No default credentials or registration endpoint.
const encoder = new TextEncoder();
const bytes = n => crypto.getRandomValues(new Uint8Array(n));
const hex = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => { if(!/^(?:[a-f0-9]{2})+$/i.test(h)) throw Error('Invalid hex'); return Uint8Array.from(h.match(/../g), x=>parseInt(x,16)); };
const digest = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(s))));
const eq = (a,b) => { if(a.length!==b.length)return false; let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0; };
const ITERATIONS = 100000;
async function hashPassword(password,salt=hex(bytes(16)),iterations=ITERATIONS){
  if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Invalid password length');
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const hash=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations,hash:'SHA-256'},key,256);
  return {hash:hex(new Uint8Array(hash)),salt,iterations};
}
async function verifyPassword(password,user){
  // Always use stored per-user salt and iteration count. Never return password hashes to clients.
  if(typeof password!=='string'||password.length>1024)return false;
  try {
    const h=await hashPassword(password,user.password_salt,user.password_iterations);
    return eq(unhex(h.hash),unhex(user.password_hash));
  }catch{return false;}
}
async function createSession(DB,userId,{maxAgeSeconds=86400}={}){
  const raw=hex(bytes(32)), now=Math.floor(Date.now()/1000), expires=now+maxAgeSeconds;
  await DB.prepare('INSERT INTO auth_sessions (id_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .bind(await digest(raw),userId,expires,now).run();
  return {token:raw,expires};
}
function sessionCookie(token,{maxAgeSeconds=86400}={}){
  return `__Host-nebula_session=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}
function clearSessionCookie(){
  return '__Host-nebula_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict';
}
async function authenticate(DB,request){
  const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-nebula_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!raw)return null;
  const now=Math.floor(Date.now()/1000);
  const user=await DB.prepare(`SELECT u.id,u.email,u.role,u.status,s.id_hash
    FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
    WHERE s.id_hash=? AND s.expires_at>? AND s.revoked_at IS NULL AND u.status='active'`)
    .bind(await digest(raw),now).first();
  return user||null;
}
function requireRole(user,roles=['SUPER_ADMIN']){
  return Boolean(user&&roles.includes(user.role));
}
function validMutationOrigin(request,allowedOrigins){
  const origin=request.headers.get('Origin');
  if(!origin||!allowedOrigins.includes(origin))return false;
  const contentType=request.headers.get('Content-Type')||'';
  return contentType.startsWith('application/json');
}
async function revokeSession(DB,request){
  const raw=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-nebula_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(raw)await DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE id_hash=?')
    .bind(Math.floor(Date.now()/1000),await digest(raw)).run();
}
// Integrator must add: login rate limits, generic login errors, CSRF origin checks,
// user provisioning out-of-band, logout, CORS allowlist, and route-level RBAC.
// Do not deploy this module alone: it does not protect any existing API route.

// Auth API routes for a dedicated same-origin /api/auth/* Worker handler.
// Do not expose until DB migration, first-admin provisioning and integration tests pass.
const enc=new TextEncoder();
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const now=()=>Math.floor(Date.now()/1000);
const getIP=r=>r.headers.get('CF-Connecting-IP')||'unknown';
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const emailNorm=e=>e.trim().toLowerCase();
const allowedOrigin=(r,origin)=>Boolean(origin&&r.headers.get('Origin')===origin);
const publicUser=u=>({id:u.id,email:u.email,role:u.role});
async function throttle(db,key){
 const row=await db.prepare('SELECT attempts,window_started,blocked_until FROM auth_login_attempts WHERE key_hash=?').bind(key).first();
 return row?.blocked_until>now();
}
async function failure(db,key){
 const t=now();
 await db.prepare(`INSERT INTO auth_login_attempts(key_hash,attempts,window_started,blocked_until)
 VALUES (?,1,?,0)
 ON CONFLICT(key_hash) DO UPDATE SET
 attempts=CASE WHEN ?-window_started>900 THEN 1 ELSE attempts+1 END,
 window_started=CASE WHEN ?-window_started>900 THEN ? ELSE window_started END,
 blocked_until=CASE WHEN ?-window_started<=900 AND attempts>=4 THEN ?+900 ELSE 0 END`)
 .bind(key,t,t,t,t,t,t).run();
}
async function clearFailures(db,key){await db.prepare('DELETE FROM auth_login_attempts WHERE key_hash=?').bind(key).run();}
async function handleAuth(request,env,{frontendOrigin}={}){
 if(!env.DB||!frontendOrigin)return json({success:false,error:'AUTH_NOT_CONFIGURED'},503);
 const u=new URL(request.url),path=u.pathname.replace(/\/$/,'');
 if(!path.startsWith('/api/auth/'))return null;
 const method=request.method;
 if(method==='OPTIONS')return new Response(null,{status:204,headers:{'Allow':'GET, POST, OPTIONS','Cache-Control':'no-store'}});
 if(method==='GET'&&path==='/api/auth/me'){
   const user=await authenticate(env.DB,request);
   return user?json({success:true,user:publicUser(user)}):json({success:false,error:'UNAUTHENTICATED'},401);
 }
 if(method!=='POST')return json({success:false,error:'METHOD_NOT_ALLOWED'},405);
 if(!validMutationOrigin(request,[frontendOrigin]))return json({success:false,error:'FORBIDDEN_ORIGIN'},403);
 if(path==='/api/auth/logout'){
   await revokeSession(env.DB,request);
   return json({success:true},200,{'Set-Cookie':clearSessionCookie()});
 }
 if(path==='/api/auth/login'){
   let body;
   try{body=await request.json();}catch{return json({success:false,error:'INVALID_JSON'},400);}
   if(!validEmail(body?.email)||typeof body?.password!=='string'||body.password.length>1024)return json({success:false,error:'INVALID_INPUT'},400);
   const email=emailNorm(body.email),key=await hash(getIP(request)+'|'+email);
   if(await throttle(env.DB,key))return json({success:false,error:'TOO_MANY_ATTEMPTS'},429);
   const user=await env.DB.prepare('SELECT * FROM auth_users WHERE email=? AND status=?').bind(email,'active').first();
   const verified=user?await verifyPassword(body.password,user):false;
   if(!verified){await failure(env.DB,key);return json({success:false,error:'INVALID_CREDENTIALS'},401);}
   await clearFailures(env.DB,key);
   const session=await createSession(env.DB,user.id);
   return json({success:true,user:publicUser(user)},200,{'Set-Cookie':sessionCookie(session.token)});
 }
 if(path==='/api/auth/users'){
   const actor=await authenticate(env.DB,request);
   if(actor?.role!=='SUPER_ADMIN')return json({success:false,error:'FORBIDDEN'},403);
   let body;try{body=await request.json();}catch{return json({success:false,error:'INVALID_JSON'},400);}
   if(!validEmail(body?.email)||!['USER','FREE_USER'].includes(body?.role)||typeof body?.password!=='string'||body.password.length<12||body.password.length>1024)
     return json({success:false,error:'INVALID_INPUT'},400);
   const pw=await hashPassword(body.password);
   const id=crypto.randomUUID();
   try{
     await env.DB.prepare('INSERT INTO auth_users(id,email,password_hash,password_salt,password_iterations,role,status) VALUES (?,?,?,?,?,?,?)')
       .bind(id,emailNorm(body.email),pw.hash,pw.salt,pw.iterations,body.role,'active').run();
   }catch{return json({success:false,error:'CREATE_FAILED'},409);}
   return json({success:true,user:{id,email:emailNorm(body.email),role:body.role}},201);
 }
 return json({success:false,error:'NOT_FOUND'},404);
}

// One-time first-admin activation. The token must be delivered privately to the verified
// email owner, never pasted into a chat, logged, or stored in plaintext.

const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const activationJson=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
async function activateAdmin(request,env){
 if(request.method!=='POST')return activationJson({error:'METHOD_NOT_ALLOWED'},405);
 const origin=new URL(request.url).origin;
 if(request.headers.get('Origin')!==origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return activationJson({error:'FORBIDDEN'},403);
 let data;try{data=await request.json()}catch{return activationJson({error:'INVALID_JSON'},400)}
 const token=data?.token,password=data?.password;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>1024)return activationJson({error:'INVALID_INPUT'},400);
 const tokenHash=await sha(token),now=Math.floor(Date.now()/1000);
 const t=await env.DB.prepare('SELECT email FROM auth_activation_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(tokenHash,now).first();
 if(!t)return activationJson({error:'INVALID_OR_EXPIRED_TOKEN'},400);
 const existing=await env.DB.prepare('SELECT id FROM auth_users WHERE role=? LIMIT 1').bind('SUPER_ADMIN').first();
 if(existing)return activationJson({error:'ALREADY_ACTIVATED'},409);
 const pw=await hashPassword(password),id=crypto.randomUUID();
 // Atomic transaction ensures token cannot be used twice. Only one admin is bootstrapped.
 const statements=[
  env.DB.prepare('UPDATE auth_activation_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(now,tokenHash,now),
  env.DB.prepare(`INSERT INTO auth_users(id,email,password_hash,password_salt,password_iterations,role,status)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT changes())=1 AND NOT EXISTS (SELECT 1 FROM auth_users WHERE role='SUPER_ADMIN')`)
    .bind(id,t.email,pw.hash,pw.salt,pw.iterations,'SUPER_ADMIN','active')
 ];
 try{
  const result=await env.DB.batch(statements);
  if(result?.[0]?.meta?.changes!==1 || result?.[1]?.meta?.changes!==1)return activationJson({error:'ACTIVATION_FAILED'},409);
  return activationJson({success:true,email:t.email,role:'SUPER_ADMIN'});
 }catch{return activationJson({error:'ACTIVATION_FAILED'},409);}
}

const FRONTEND_ORIGIN='https://nebula-auth-stage.nebula-crypto-proxy.workers.dev';const html="<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>Aktivasi Admin NEBULA</title><style>body{font:16px system-ui;background:#090e19;color:#eaf2ff;display:grid;place-items:center;min-height:100vh;margin:0}.panel{width:min(420px,90vw);background:#151e31;padding:28px;border:1px solid #31405b;border-radius:16px}h1{font-size:24px}label{display:block;margin:14px 0 6px}input,button{box-sizing:border-box;width:100%;padding:13px;border-radius:9px;font:inherit}input{background:#0c1425;color:white;border:1px solid #45516b}button{margin-top:20px;background:#5b8eff;border:0;color:#fff;font-weight:700;cursor:pointer}p{line-height:1.5;color:#b4c3db}#status{min-height:30px}</style></head><body><main class=\"panel\"><h1>Aktivasi NEBULA</h1><p>Super Admin — Pilar Prima Tech. Tautan aktivasi hanya berlaku sekali.</p><form id=\"form\"><label for=\"pw\">Password baru (minimal 12 karakter)</label><input id=\"pw\" type=\"password\" minlength=\"12\" maxlength=\"1024\" autocomplete=\"new-password\" required><label for=\"confirm\">Ulangi password</label><input id=\"confirm\" type=\"password\" minlength=\"12\" maxlength=\"1024\" autocomplete=\"new-password\" required><button type=\"submit\">Aktifkan akun</button></form><p id=\"status\" role=\"status\" aria-live=\"polite\"></p></main><script>const token=new URL(location.href).hash.slice(1);history.replaceState(null,'',location.pathname);const form=document.getElementById('form'),status=document.getElementById('status');if(!/^[a-f0-9]{64}$/.test(token)){form.hidden=true;status.textContent='Tautan aktivasi belum tersedia atau tidak valid.'}form.addEventListener('submit',async e=>{e.preventDefault();const pw=document.getElementById('pw').value;if(pw!==document.getElementById('confirm').value){status.textContent='Password tidak sama.';return}const btn=form.querySelector('button');btn.disabled=true;try{const r=await fetch('/api/auth/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:pw}),credentials:'same-origin',cache:'no-store'});const d=await r.json();status.textContent=r.ok?'Akun berhasil diaktifkan.':'Aktivasi gagal: '+(d.error||r.status);if(r.ok)form.hidden=true}catch{status.textContent='Koneksi gagal, silakan coba lagi.'}finally{document.getElementById('pw').value='';document.getElementById('confirm').value='';btn.disabled=false}});</script></body></html>";export default {async fetch(request,env){const u=new URL(request.url);if(request.method==='GET'&&u.pathname==='/activate'){return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}})}if(request.method==='GET'&&u.pathname==='/health'){try{await env.DB.prepare('SELECT COUNT(*) FROM auth_users').first();return new Response(JSON.stringify({success:true,service:'nebula-auth-stage',database_ready:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})}catch{return new Response(JSON.stringify({success:false,database_ready:false}),{status:503,headers:{'Content-Type':'application/json'}})}}if(u.pathname==='/api/auth/activate')return activateAdmin(request,env);if(u.pathname.startsWith('/api/auth/'))return handleAuth(request,env,{frontendOrigin:FRONTEND_ORIGIN});return new Response('Not Found',{status:404})}};
