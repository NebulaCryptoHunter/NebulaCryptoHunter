const mint='So11111111111111111111111111111111111111112';
export async function providerHealth(request,env,namespace){
 const key=new Request('https://nebula.internal/provider-health-v2/'+encodeURIComponent(namespace));
 const cached=await caches.default.match(key);if(cached)return cached;
 const specs=[
 ['DexScreener','https://api.dexscreener.com/token-pairs/v1/solana/'+mint,{},j=>Array.isArray(j)&&j.length>0],
 ['Helius',env.HELIUS_API_KEY?'https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(env.HELIUS_API_KEY):null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})},j=>j.result==='ok'],
 ['Jupiter',env.JUPITER_API_KEY?'https://api.jup.ag/tokens/v2/search?query='+mint:null,{headers:{'x-api-key':env.JUPITER_API_KEY||''}},j=>Array.isArray(j)&&j.some(x=>x.id===mint)],
 ['GeckoTerminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+mint,{},j=>j.data?.id==='solana_'+mint],
 ['Birdeye',env.BIRDEYE_API_KEY?'https://public-api.birdeye.so/defi/price?address='+mint:null,{headers:{'X-API-KEY':env.BIRDEYE_API_KEY||'','x-chain':'solana'}},j=>j.success===true&&Number(j.data?.value)>0],
 ['CoinGecko','https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',{headers:env.COINGECKO_API_KEY?{'x-cg-demo-api-key':env.COINGECKO_API_KEY}:{}},j=>Number(j.solana?.usd)>0],
 ['Rugcheck','https://api.rugcheck.xyz/v1/tokens/'+mint+'/report',{},j=>!!j.token],
 ['CoinPaprika','https://api.coinpaprika.com/v1/tickers/sol-solana',{},j=>j.id==='sol-solana']
 ];
 const results=[];
 // Sequential probes, no retries; cached for ten minutes.
 for(const [name,url,options,valid] of specs){const start=Date.now();if(!url){results.push({name,status:'CONFIG_ERROR',httpStatus:null,latencyMs:null,detail:'Required credential not configured'});continue;}
 try{const r=await fetch(url,{...options,signal:AbortSignal.timeout(5000)});let j;try{j=await r.json()}catch{};results.push({name,status:r.status===429?'RATE_LIMITED':[401,403].includes(r.status)?'AUTH_ERROR':r.ok&&valid(j||{})?'HEALTHY':'UNAVAILABLE',httpStatus:r.status,latencyMs:Date.now()-start,detail:r.ok&&!valid(j||{})?'Probe data unavailable or unexpected response':null});}catch{results.push({name,status:'UNAVAILABLE',httpStatus:null,latencyMs:Date.now()-start,detail:'Network failure or timeout'});}}
 results.push({name:'Ankr',status:env.ANKR_RPC_URL?'NOT_TESTED':'DISABLED'},{name:'PumpPortal WebSocket',status:'NOT_TESTED',detail:'WebSocket session not probed'});
 const out=Response.json({checkedAt:new Date().toISOString(),cacheSeconds:600,providers:results},{headers:{'Cache-Control':'public,max-age=600'}});await caches.default.put(key,out.clone());return out;
}
