#!/usr/bin/env node
// Non-destructive smoke test. Does not log in or create accounts.
const base=process.env.NEBULA_AUTH_STAGE_URL||'https://nebula-auth-stage.nebula-crypto-proxy.workers.dev';
const tests=[
 {name:'health',path:'/health',method:'GET',expected:[200],check:j=>j?.database_ready===true},
 {name:'anonymous session rejected',path:'/api/auth/me',method:'GET',expected:[401],check:j=>j?.error==='UNAUTHENTICATED'},
 {name:'login rejects untrusted Origin',path:'/api/auth/login',method:'POST',headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({email:'invalid@example.com',password:'invalid'}),expected:[403],check:j=>j?.error==='FORBIDDEN_ORIGIN'},
 {name:'unknown route rejected',path:'/missing',method:'GET',expected:[404],check:()=>true}
];
let failed=0;
for(const t of tests){
 try{
  const r=await fetch(base+t.path,{method:t.method,headers:t.headers,body:t.body,redirect:'manual',signal:AbortSignal.timeout(12000)});
  const j=await r.json().catch(()=>null);
  const ok=t.expected.includes(r.status)&&t.check(j);
  console.log(`${ok?'PASS':'FAIL'} ${t.name}: HTTP ${r.status}`);
  if(!ok)failed++;
 }catch(e){console.error(`FAIL ${t.name}: ${e.message}`);failed++;}
}
if(failed){console.error(`${failed} smoke test(s) failed`);process.exitCode=1;}
