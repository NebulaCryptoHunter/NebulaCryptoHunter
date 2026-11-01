import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,authenticate} from '../auth-v1.mjs';
import {handleAuth} from '../auth-routes-v1.mjs';
import gateway from '../workers/frontend-gateway.mjs';
import {accountHTML} from '../workers/account-page.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const origin='https://nebulacryptohunter.nebula-crypto-proxy.workers.dev';
const login=(identifier,password)=>new Request(origin+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:identifier,password})});
const post=(url,data,headers={})=>new Request(origin+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
const cookie='__Host-nebula_session='+'a'.repeat(64);

test('bootstrap verification accepts 8-character secret only for forced-change accounts',async()=>{
 const temporary='temp6789';
 await assert.rejects(hashPassword(temporary));
 const pw=await hashPassword(temporary,undefined,undefined,{allowTemporary:true});
 const user={password_hash:pw.hash,password_salt:pw.salt,password_iterations:pw.iterations,must_change_password:1};
 assert.equal(await verifyPassword(temporary,user),true);
 assert.equal(await verifyPassword(temporary,{...user,must_change_password:0}),false);
 assert.equal(await verifyPassword('not-right',user),false);
});
test('admin username login returns forced-change session without any elevated authorization',async()=>{
 const hash=await hashPassword('temp6789',undefined,undefined,{allowTemporary:true});
 const user={id:'admin-1',email:'admin@example.test',username:'admin.nebula',role:'SUPER_ADMIN',status:'active',must_change_password:1,temporary_password_expires_at:Math.floor(Date.now()/1000)+3600,password_hash:hash.hash,password_salt:hash.salt,password_iterations:hash.iterations};
 let insertSession=false;
 const db={prepare(sql){
  let p=[];
  return {bind(...args){p=args;return this},async first(){
    if(sql.includes('auth_login_attempts'))return null;
    if(sql.includes('SELECT * FROM auth_users WHERE (username='))return p[0]===user.username?user:null;
    if(sql.includes('FROM auth_sessions s JOIN auth_users u'))return {...user,id_hash:'session'};
    return null;
   },async run(){if(sql.includes('INSERT INTO auth_sessions'))insertSession=true;return{meta:{changes:1}}}};
 }};
 const res=await handleAuth(login('admin.nebula','temp6789'),{DB:db},{frontendOrigin:origin});
 assert.equal(res.status,200);assert.equal(insertSession,true);
 const data=await res.json();assert.equal(data.user.mustChangePassword,true);assert.equal(data.user.username,'admin.nebula');
 assert.match(res.headers.get('set-cookie'),/Max-Age=900/);
 const read=await gateway.fetch(new Request(origin+'/api/auth/me',{headers:{Cookie:cookie}}),{AUTH_DB:db});
 assert.equal((await read.json()).user.mustChangePassword,true);
 const blocked=await gateway.fetch(post('/api/research/scan',{mints:['So11111111111111111111111111111111111111112']},{Cookie:cookie}),{AUTH_DB:db});
 assert.equal(blocked.status,401);assert.equal((await blocked.json()).error,'PASSWORD_CHANGE_REQUIRED');
 const write=await gateway.fetch(post('/api/v1/predictions',{value:1},{Cookie:cookie}),{AUTH_DB:db});
 assert.equal(write.status,401);assert.equal((await write.json()).error,'PASSWORD_CHANGE_REQUIRED');
});
test('expired bootstrap password cannot open an Admin session',async()=>{
 const hash=await hashPassword('temp6789',undefined,undefined,{allowTemporary:true});
 const user={id:'1',email:'admin@example.test',username:'admin.nebula',role:'SUPER_ADMIN',must_change_password:1,temporary_password_expires_at:Math.floor(Date.now()/1000)-1,password_hash:hash.hash,password_salt:hash.salt,password_iterations:hash.iterations};
 let sessionCreated=false;
 const db={prepare(sql){return{bind(){return this},async first(){return sql.includes('SELECT * FROM auth_users')?user:null},async run(){if(sql.includes('INSERT INTO auth_sessions'))sessionCreated=true;return{meta:{changes:1}}}}}};
 const res=await handleAuth(login('admin.nebula','temp6789'),{DB:db},{frontendOrigin:origin});
 assert.equal(res.status,401);assert.equal(sessionCreated,false);
});
test('first-login UI includes new-password confirmation and password-change endpoint',()=>{
 assert.match(accountHTML,/id="changeForm"/);
 assert.match(accountHTML,/id="confirmPassword"/);
 assert.match(accountHTML,/change-password/);
 assert.match(accountHTML,/mustChangePassword/);
 assert.match(accountHTML,/admin\.nebula/);
 for(const match of accountHTML.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 const migration=fs.readFileSync('backend/migrations/0009_admin_first_login.sql','utf8');
 assert.match(migration,/ADD COLUMN username/);
 assert.match(migration,/ADD COLUMN must_change_password/);
 assert.match(migration,/ADD COLUMN temporary_password_expires_at/);
});
