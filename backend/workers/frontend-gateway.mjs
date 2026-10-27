import {researchData} from './research-api.mjs';
import {authenticate,validMutationOrigin} from '../auth-v1.mjs';
import {handleAuth} from '../auth-routes-v1.mjs';
import {activateAdmin} from '../auth-activation-v1.mjs';
import {transformFrontend} from './frontend-transform.mjs';
import {accountHTML} from './account-page.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const mintOK=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const publicReads=new Set(['/api/v1/predictions','/api/v1/evaluations','/api/v1/stats','/api/v1/heroes','/api/v1/watchlist','/api/v1/learning','/api/v1/market-regime','/api/v1/config']);
export default {async fetch(request,env){
 try{
 const u=new URL(request.url),path=u.pathname,method=request.method;
 if(method==='POST'){
  if(!validMutationOrigin(request,[u.origin]))return json({error:'FORBIDDEN_ORIGIN'},403);
  const reader=request.body?.getReader(),chunks=[];let size=0;if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();return json({error:'PAYLOAD_TOO_LARGE'},413)}chunks.push(value)}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}const text=new TextDecoder().decode(bytes);
  try{JSON.parse(text)}catch{return json({error:'INVALID_JSON'},400)}
  request=new Request(request.url,{method,headers:request.headers,body:text});
 }
 const authEnv={DB:env.AUTH_DB};
 if(path==='/api/auth/activate')return activateAdmin(request,authEnv);
 if(path.startsWith('/api/auth/'))return await handleAuth(request,authEnv,{frontendOrigin:u.origin});
 if(path==='/account'&&method==='GET')return new Response(accountHTML,{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}});
 if(path==='/api/research/providers'&&method==='GET'){if(!env.API)return json({error:'API_BINDING_MISSING',providers:[]},503);const r=await env.API.fetch('https://api.internal/provider-health');const out=new Response(r.body,r);out.headers.set('Cache-Control','no-store');return out;}
 if(path==='/health')return json({service:'frontend-gateway',research:!!env.RESEARCH_DB,api:!!env.API});
 if(path==='/api/research/latest'&&method==='GET'){
  if(!env.RESEARCH_DB)return json({error:'RESEARCH_DB_NOT_CONFIGURED'},503);
  return json({...await researchData(env.RESEARCH_DB),automaticScanning:env.SCANNER_CRON==='enabled',intervalMinutes:env.SCANNER_CRON==='enabled'?30:null});
 }
 if(path==='/api/research/scan'&&method==='POST'){
  const user=await authenticate(env.AUTH_DB,request);if(user?.role!=='SUPER_ADMIN')return json({error:'ADMIN_REQUIRED'},401);
  if(!env.SCANNER||!env.INTERNAL_TOKEN)return json({error:'SCANNER_NOT_CONFIGURED'},503);
  const b=await request.json();if(!Array.isArray(b?.mints)||b.mints.length<1||b.mints.length>5||!b.mints.every(mintOK))return json({error:'INVALID_MINTS'},400);
  const results=[];for(const mint of [...new Set(b.mints)]){const r=await env.SCANNER.fetch('https://scanner.internal/pipeline?persist=1&mint='+mint,{headers:{Authorization:'Bearer '+env.INTERNAL_TOKEN}});const d=await r.json();results.push({mint,status:r.status,data:d});if(r.status===429)return json({error:'UPSTREAM_RATE_LIMITED',results},429);}
  return json({success:results.every(r=>r.status===200),results},results.every(r=>r.status===200)?200:502);
 }
 const isProxy=path.startsWith('/api/v1/')||/^\/(helius|dex|rugcheck|pumpfun)(\/|$)/.test(path);
 if(isProxy){
  if(!['GET','POST'].includes(method))return json({error:'METHOD_NOT_ALLOWED'},405);
  if(method==='POST'&&path!=='/helius/rpc'){
   const user=await authenticate(env.AUTH_DB,request);if(user?.role!=='SUPER_ADMIN')return json({error:'ADMIN_REQUIRED'},401);
  }
  if(method==='GET'&&path.startsWith('/api/v1/')&&!publicReads.has(path)&&!/^\/api\/v1\/(providers|holders)\//.test(path))return json({error:'NOT_FOUND'},404);
  const headers=new Headers(request.headers);headers.delete('Cookie');headers.delete('Authorization');headers.delete('X-API-Key');headers.delete('Origin');
  if(method==='POST'&&path.startsWith('/api/v1/')&&!env.API_KEY)return json({error:'WRITE_SERVICE_NOT_CONFIGURED'},503);
  if(method==='POST'&&path.startsWith('/api/v1/'))headers.set('Authorization','Bearer '+env.API_KEY);
  if(!env.API)return json({error:'API_BINDING_MISSING'},503);
  const response=await env.API.fetch(new Request('https://nebula-api.nebula-crypto-proxy.workers.dev'+path+u.search,{method,headers,body:method==='POST'?request.body:undefined,duplex:method==='POST'?'half':undefined}));
  const out=new Response(response.body,response);out.headers.set('Cache-Control','no-store');return out;
 }
 if(!env.ASSETS)return json({error:'ASSETS_BINDING_MISSING'},503);
 const response=await env.ASSETS.fetch(request);
 if(!response.headers.get('Content-Type')?.includes('text/html'))return response;
 const html=transformFrontend(await response.text()),headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('ETag');headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');return new Response(html,{status:response.status,headers});
 }catch(e){console.error('gateway_request_failed',e?.name);return json({error:'SERVICE_UNAVAILABLE'},503);}
}};
