// One-time first-admin activation. The token must be delivered privately to the verified
// email owner, never pasted into a chat, logged, or stored in plaintext.
import {hashPassword} from './auth-v1.mjs';
const enc=new TextEncoder();
const sha=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
export async function activateAdmin(request,env){
 if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 const origin=new URL(request.url).origin;
 if(request.headers.get('Origin')!==origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'FORBIDDEN'},403);
 let data;try{data=await request.json()}catch{return json({error:'INVALID_JSON'},400)}
 const token=data?.token,password=data?.password;
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<12||password.length>1024)return json({error:'INVALID_INPUT'},400);
 const tokenHash=await sha(token),now=Math.floor(Date.now()/1000);
 const t=await env.DB.prepare('SELECT email FROM auth_activation_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(tokenHash,now).first();
 if(!t)return json({error:'INVALID_OR_EXPIRED_TOKEN'},400);
 const existing=await env.DB.prepare('SELECT id FROM auth_users WHERE role=? LIMIT 1').bind('SUPER_ADMIN').first();
 if(existing)return json({error:'ALREADY_ACTIVATED'},409);
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
  if(result?.[0]?.meta?.changes!==1 || result?.[1]?.meta?.changes!==1)return json({error:'ACTIVATION_FAILED'},409);
  return json({success:true,email:t.email,role:'SUPER_ADMIN'});
 }catch{return json({error:'ACTIVATION_FAILED'},409);}
}
