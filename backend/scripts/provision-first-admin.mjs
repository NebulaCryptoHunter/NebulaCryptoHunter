#!/usr/bin/env node
// Provision NEBULA's first SUPER_ADMIN using local interactive terminal input.
// Run locally, never in CI. Password is never committed, echoed, or sent to ChatGPT.
// Node 20+ required. Output SQL contains a password hash: treat it as sensitive.
// PBKDF2 must match Workers WebCrypto cap (100,000 iterations), otherwise login fails.
import {pbkdf2Sync, randomBytes, randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {stdin, stdout, stderr} from 'node:process';
const email=process.env.NEBULA_ADMIN_EMAIL?.trim().toLowerCase();
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
const password=await hiddenPrompt('New admin password (minimum 12 characters): ');
const confirm=await hiddenPrompt('Repeat password: ');
if(password!==confirm||password.length<12||password.length>1024){
 stderr.write('Password mismatch or invalid length.\n');process.exit(1);
}
const salt=randomBytes(16).toString('hex'),iterations=100000;
const hash=pbkdf2Sync(password,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
const id=randomUUID();
const quote=x=>"'"+x.replaceAll("'","''")+"'";
stdout.write('\n-- Sensitive: contains a password hash. Apply only to nebula-auth-stage.\n');
stdout.write(`INSERT INTO auth_users(id,email,password_hash,password_salt,password_iterations,role,status) SELECT ${[id,email,hash,salt].map(quote).join(',')},${iterations},'SUPER_ADMIN','active' WHERE NOT EXISTS (SELECT 1 FROM auth_users WHERE role='SUPER_ADMIN');\n`);
