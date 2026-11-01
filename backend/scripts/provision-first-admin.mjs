#!/usr/bin/env node
// Provision NEBULA's first SUPER_ADMIN using local interactive terminal input.
// Run locally, never in CI. Password is never committed, echoed, or sent to ChatGPT.
// Node 20+ required. Output SQL contains a password hash: treat it as sensitive.
// PBKDF2 must match Workers WebCrypto cap (100,000 iterations), otherwise login fails.
import {pbkdf2Sync, randomBytes, randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {writeFileSync} from 'node:fs';
import {stdin, stdout, stderr} from 'node:process';
const email=process.env.NEBULA_ADMIN_EMAIL?.trim().toLowerCase();
const username=(process.env.NEBULA_ADMIN_USERNAME||'admin.nebula').trim().toLowerCase();
const temporary=process.env.NEBULA_TEMPORARY_FIRST_LOGIN==='1';
if(!/^[a-z][a-z0-9._-]{2,39}$/.test(username)){stderr.write('Invalid NEBULA_ADMIN_USERNAME.\n');process.exit(1);}
if(temporary&&!process.env.NEBULA_ADMIN_SQL_FILE){stderr.write('For temporary passwords, NEBULA_ADMIN_SQL_FILE is mandatory. Never print the hash.\n');process.exit(1);}
if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
 stderr.write('Set NEBULA_ADMIN_EMAIL to your admin email before running.\n');process.exit(1);
}
if(!stdin.isTTY){stderr.write('Interactive terminal required.\n');process.exit(1);}
async function hiddenPrompt(prompt){
 return new Promise((resolve,reject)=>{
  const rl=createInterface({input:stdin,output:stdout,terminal:true});
  const orig=rl._writeToOutput.bind(rl);
  rl._writeToOutput=(s)=>{if(s.includes(prompt))orig(s);else if(s.includes('\n'))orig('\n');};
  rl.question(prompt,answer=>{rl.close();resolve(answer);});
  rl.on('SIGINT',()=>{rl.close();reject(Error('Cancelled'));});
 });
}
const password=await hiddenPrompt(temporary?'Temporary password (8+ characters; 24-hour expiry): ':'New admin password (minimum 12 characters): ');
const confirm=await hiddenPrompt('Repeat password: ');
if(password!==confirm||password.length<(temporary?8:12)||password.length>1024){
 stderr.write('Password mismatch or invalid length.\n');process.exit(1);
}
const salt=randomBytes(16).toString('hex'),iterations=100000;
const hash=pbkdf2Sync(password,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
const id=randomUUID();
const quote=x=>"'"+x.replaceAll("'","''")+"'";
const expiry=temporary?Math.floor(Date.now()/1000)+86400:null;
const sql=`INSERT INTO auth_users(id,email,username,password_hash,password_salt,password_iterations,role,status,must_change_password,temporary_password_expires_at) SELECT ${[id,email,username,hash,salt].map(quote).join(',')},${iterations},'SUPER_ADMIN','active',${temporary?1:0},${expiry??'NULL'} WHERE NOT EXISTS (SELECT 1 FROM auth_users WHERE role='SUPER_ADMIN');\n`;
const target=process.env.NEBULA_ADMIN_SQL_FILE;
if(target){
 try{writeFileSync(target,sql,{flag:'wx',mode:0o600});stderr.write('Private SQL generated for '+username+'. Use Wrangler D1 remote, delete the file, and perform forced password change at first login.\n');}
 catch(e){stderr.write('Could not write private SQL output: '+e.code+'\n');process.exitCode=1;}
}else{
 stdout.write('\n-- Sensitive: contains a password hash. Apply only to nebula-auth-stage.\n');
 stdout.write(sql);
}
