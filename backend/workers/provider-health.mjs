import {providerJSON} from './provider-runtime.mjs';
const mint='So11111111111111111111111111111111111111112';
const rpcOptions={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth',params:[]})};
async function freePumpSocket(){
 let socket,timer;
 try{
  const r=await fetch('https://pumpportal.fun/api/data',{headers:{Upgrade:'websocket'},signal:AbortSignal.timeout(2500)});
  if(r.status!==101||!r.webSocket){await r.body?.cancel();return {name:'PumpPortal WebSocket',status:r.status===429?'RATE_LIMITED':r.status===402?'FREE_PLAN_UNAVAILABLE':'UNAVAILABLE',httpStatus:r.status,detail:'Free discovery socket could not connect; trade subscriptions disabled'}}
  socket=r.webSocket;socket.accept();
  const acknowledged=await new Promise(resolve=>{
   timer=setTimeout(()=>resolve(false),1500);
   socket.addEventListener('message',e=>{try{const data=JSON.parse(e.data);if(data.mint||/successfully subscribed|subscribed to token creation/i.test(data.message||''))resolve(true);else if(data.error)resolve(false)}catch{}});
   socket.addEventListener('error',()=>resolve(false));socket.addEventListener('close',()=>resolve(false));
   socket.send(JSON.stringify({method:'subscribeNewToken'}));
  });
  return {name:'PumpPortal WebSocket',status:acknowledged?'HEALTHY':'NOT_TESTED',httpStatus:101,detail:acknowledged?'Free new-token subscription acknowledged; trade subscriptions disabled':'Connected; no subscription acknowledgement within probe window'};
 }catch{return {name:'PumpPortal WebSocket',status:'UNAVAILABLE',httpStatus:null,detail:'Free discovery socket failed or timed out'}}
 finally{clearTimeout(timer);try{socket?.close(1000,'Free discovery health probe complete')}catch{}}
}
export async function providerHealth(request,env,namespace){
 const key=new Request('https://nebula.internal/provider-health-free-v5/'+encodeURIComponent(namespace));
 try{const cached=await caches.default.match(key);if(cached)return cached}catch{}
 const specs=[
 ['Pump.fun','pumpfun','https://frontend-api-v3.pump.fun/coins?offset=0&limit=1&sort=created_timestamp&order=DESC&includeNsfw=false',{},j=>Array.isArray(j)],
 ['DexScreener','dexscreener','https://api.dexscreener.com/token-pairs/v1/solana/'+mint,{},j=>Array.isArray(j)&&j.length>0],
 ['Helius','helius',env.HELIUS_API_KEY?'https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(env.HELIUS_API_KEY):null,rpcOptions,j=>j.result==='ok'],
 ['Jupiter','jupiter','https://api.jup.ag/tokens/v2/search?query='+mint,{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{}},j=>Array.isArray(j)&&j.some(x=>x.id===mint)],
 ['GeckoTerminal','geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+mint,{},j=>j.data?.id==='solana_'+mint],
 ['Birdeye','birdeye',env.BIRDEYE_API_KEY?'https://public-api.birdeye.so/defi/price?address='+mint:null,{headers:{'X-API-KEY':env.BIRDEYE_API_KEY||'','x-chain':'solana'}},j=>j.success===true&&Number(j.data?.value)>0],
 ['Ankr','ankr',env.ANKR_RPC_URL||null,rpcOptions,j=>j.result==='ok'],
 ['Solana RPC','solana_rpc','https://api.mainnet.solana.com',rpcOptions,j=>j.result==='ok'],
 ['CoinGecko','coingecko','https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',{headers:env.COINGECKO_API_KEY?{'x-cg-demo-api-key':env.COINGECKO_API_KEY}:{}},j=>Number(j.solana?.usd)>0],
 ['Rugcheck','rugcheck','https://api.rugcheck.xyz/v1/tokens/'+mint+'/report',{},j=>!!j.token],
 ['CoinPaprika','coinpaprika','https://api.coinpaprika.com/v1/tickers/sol-solana?quotes=USD',{},j=>j.id==='sol-solana'&&Number(j.quotes?.USD?.price)>0]
 ];
 const probe=async([name,provider,url,options,valid])=>{
  const start=Date.now();
  if(!url)return {name,status:'CONFIG_ERROR',httpStatus:null,detail:'Free API credential not configured; other providers continue'};
  const r=await providerJSON(provider,url,options,{ttl:0,timeout:2500});
  return {name,status:r.error==='RATE_LIMIT'?'RATE_LIMITED':r.error==='FREE_PLAN_UNAVAILABLE'?'FREE_PLAN_UNAVAILABLE':r.error==='AUTH_ERROR'?'AUTH_ERROR':r.ok&&valid(r.data||{})?'HEALTHY':'UNAVAILABLE',httpStatus:r.status||null,latencyMs:Date.now()-start,retryAt:r.retryAt||null,detail:r.error||(r.ok&&!valid(r.data||{})?'Unexpected probe data':null)};
 };
 const results=[];
 // Independent batches, at most four simultaneous connections; no fail-fast Promise.all.
 for(let i=0;i<specs.length;i+=4){const batch=await Promise.allSettled(specs.slice(i,i+4).map(probe));for(let j=0;j<batch.length;j++){const r=batch[j];results.push(r.status==='fulfilled'?r.value:{name:specs[i+j][0],status:'UNAVAILABLE',detail:'Probe failed independently'})}}
 results.push(await freePumpSocket());
 const out=Response.json({checkedAt:new Date().toISOString(),cacheSeconds:600,mode:'FREE',providerCount:12,providers:results},{headers:{'Cache-Control':'public,max-age=600'}});
 try{await caches.default.put(key,out.clone())}catch{}
 return out;
}
