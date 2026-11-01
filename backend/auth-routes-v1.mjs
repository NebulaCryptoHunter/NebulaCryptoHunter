// Auth API routes for a dedicated same-origin /api/auth/* Worker handler.
// Do not expose until DB migration, first-admin provisioning and integration tests pass.
import {authenticate,verifyPassword,createSession,sessionCookie,clearSessionCookie,revokeSession,hashPassword,validMutationOrigin} from './auth-v1.mjs';
const enc=new TextEncoder();
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const now=()=>Math.floor(Date.now()/1000);
const getIP=r=>r.headers.get('CF-Connecting-IP')||'unknown';
const validEmail=e=>typeof e==='string'&&e.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const emailNorm=e=>e.trim().toLowerCase();
const allowedOrigin=(r,origin)=>Boolean(origin&&r.headers.get('Origin')===origin);
const publicUser=u=>({id:u.id,email:u.email,username:u.username||null,role:u.role,mustChangePassword:Number(u.must_change_password)===1});
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
export async function handleAuth(request,env,{frontendOrigin}={}){
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
   const identifier=typeof body?.username==='string'?body.username.trim().toLowerCase():(typeof body?.email==='string'?body.email.trim().toLowerCase():'');
   if((!validEmail(identifier)&&!/^[a-z][a-z0-9._-]{2,39}$/.test(identifier))||typeof body?.password!=='string'||body.password.length>1024)return json({success:false,error:'INVALID_INPUT'},400);
   const key=await hash(getIP(request)+'|'+identifier),ipKey=await hash('ip|'+getIP(request));
   if(await throttle(env.DB,key)||await throttle(env.DB,ipKey))return json({success:false,error:'TOO_MANY_ATTEMPTS'},429);
   const user=await env.DB.prepare('SELECT * FROM auth_users WHERE (username=? OR email=?) AND status=? LIMIT 1').bind(identifier,identifier,'active').first();
   const validTemporary=Number(user?.must_change_password)!==1||Number(user.temporary_password_expires_at)>now();
   const verified=user&&validTemporary?await verifyPassword(body.password,user):false;
   if(!verified){await failure(env.DB,key);await failure(env.DB,ipKey);return json({success:false,error:'INVALID_CREDENTIALS'},401);}
   await clearFailures(env.DB,key);
   const session=await createSession(env.DB,user.id,{maxAgeSeconds:Number(user.must_change_password)===1?900:86400});
   return json({success:true,user:publicUser(user)},200,{'Set-Cookie':sessionCookie(session.token,{maxAgeSeconds:Number(user.must_change_password)===1?900:86400})});
 }
 if(path==='/api/auth/change-password'){
   const actor=await authenticate(env.DB,request);
   if(!actor)return json({success:false,error:'UNAUTHENTICATED'},401);
   let body;try{body=await request.json();}catch{return json({success:false,error:'INVALID_JSON'},400);}
   if(typeof body?.currentPassword!=='string'||typeof body?.newPassword!=='string'||body.newPassword.length<12||body.newPassword.length>1024||body.newPassword===body.currentPassword)
     return json({success:false,error:'INVALID_PASSWORD'},400);
   const user=await env.DB.prepare('SELECT * FROM auth_users WHERE id=? AND status=?').bind(actor.id,'active').first();
   if(!user||!await verifyPassword(body.currentPassword,user))return json({success:false,error:'INVALID_CREDENTIALS'},401);
   const pw=await hashPassword(body.newPassword);
   const changed=await env.DB.prepare(`UPDATE auth_users SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,temporary_password_expires_at=NULL,updated_at=datetime('now') WHERE id=? AND status='active' AND password_hash=?`).bind(pw.hash,pw.salt,pw.iterations,actor.id,user.password_hash).run();
   if(changed?.meta?.changes!==1)return json({success:false,error:'PASSWORD_UPDATE_CONFLICT'},409);
   await env.DB.prepare('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').bind(now(),actor.id).run();
   return json({success:true,reloginRequired:true},200,{'Set-Cookie':clearSessionCookie()});
 }
 if(path==='/api/auth/users'){
   const actor=await authenticate(env.DB,request);
   if(actor?.role!=='SUPER_ADMIN'||Number(actor.must_change_password)===1)return json({success:false,error:'FORBIDDEN'},403);
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
