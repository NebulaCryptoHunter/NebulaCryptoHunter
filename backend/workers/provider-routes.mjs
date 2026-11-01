import {providerJSON,rpcFallback} from './provider-runtime.mjs';
import {validMint,marketFeed,marketPairs} from './market-sources.mjs';
const positive=x=>x!==null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0;
export async function tokenSource(provider,mint,env={}){
 let url,options={headers:{Accept:'application/json'}};
 if(provider==='jupiter'){url='https://api.jup.ag/tokens/v2/search?query='+encodeURIComponent(mint);if(env.JUPITER_API_KEY)options.headers['x-api-key']=env.JUPITER_API_KEY}
 else if(provider==='gecko')url='https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+mint;
 else if(provider==='birdeye'){if(!env.BIRDEYE_API_KEY)return {ok:false,provider,error:'API_KEY_REQUIRED'};url='https://public-api.birdeye.so/defi/price?address='+mint;options.headers['X-API-KEY']=env.BIRDEYE_API_KEY;options.headers['x-chain']='solana'}
 else if(provider==='coingecko'){url='https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses='+mint+'&vs_currencies=usd';if(env.COINGECKO_API_KEY)options.headers['x-cg-demo-api-key']=env.COINGECKO_API_KEY}
 else if(provider==='coinpaprika')url='https://api.coinpaprika.com/v1/contracts/solana/'+mint;
 else if(provider==='dex'){const r=await marketPairs([mint]);const p=r.pairs.filter(p=>p.baseToken.address===mint).sort((a,b)=>Number(b.liquidity?.usd)-Number(a.liquidity?.usd))[0];return p?{ok:true,provider:p._source,token_ca:mint,price_usd:Number(p.priceUsd),holder_count:null,holder_count_verified:false,checked_at:p._observedAt}:{ok:false,provider,error:'PRICE_UNAVAILABLE'}}
 else return {ok:false,provider,error:'UNKNOWN_PROVIDER'};
 const r=await providerJSON(provider==='gecko'?'geckoterminal':provider,url,options,{ttl:60,timeout:2500});
 if(!r.ok)return {...r,data:undefined};
 let price=null,holders=null,id=null;
 if(provider==='jupiter'){const t=Array.isArray(r.data)?r.data.find(t=>t.id===mint):null;if(!t)return {ok:false,provider,error:'TOKEN_NOT_FOUND'};price=t.usdPrice;holders=Number.isInteger(t.holderCount)&&t.holderCount>=0?t.holderCount:null}
 if(provider==='gecko'){if(r.data?.data?.id!=='solana_'+mint)return {ok:false,provider,error:'TOKEN_MISMATCH'};price=r.data.data.attributes?.price_usd}
 if(provider==='birdeye'){if(r.data?.success!==true)return {ok:false,provider,error:'PROVIDER_REJECTED'};price=r.data.data?.value}
 if(provider==='coingecko')price=r.data?.[mint]?.usd; // Solana addresses are case-sensitive.
 if(provider==='coinpaprika')id=r.data?.id||null;
 return {ok:positive(price)||holders!==null||!!id,provider,token_ca:mint,price_usd:positive(price)?Number(price):null,holder_count:holders,holder_count_verified:provider==='jupiter'&&holders!==null,coinpaprika_id:id,checked_at:r.fetchedAt,error:positive(price)||holders!==null||!!id?null:'TOKEN_NOT_FOUND'};
}
export async function providerRoute(path,env){
 if(path==='/api/v1/market-feed'){const feed=await marketFeed(env);return Response.json(feed,{status:feed.items.length?200:503,headers:{'Cache-Control':'no-store'}})}
 const m=/^\/api\/v1\/(providers\/([^/]+)|holders)(?:\/([^/]+))?$/.exec(path);
 if(!m)return null;
 const kind=m[2]||'holders',mint=m[3]||'';
 const out=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(kind==='pump_ws')return out({success:false,provider:kind,error:'FREE_DISCOVERY_ONLY',detail:'Only subscribeNewToken/subscribeMigration are free. Trade subscriptions disabled.'},501);
 if(kind==='solana_rpc'||kind==='ankr'){
  if(kind==='ankr'&&!env.ANKR_RPC_URL)return out({success:false,provider:kind,error:'API_KEY_REQUIRED'},503);
  const payload={jsonrpc:'2.0',id:1,method:'getHealth',params:[]};
  const r=kind==='solana_rpc'?await providerJSON('solana_rpc','https://api.mainnet.solana.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},{ttl:300,timeout:2500}):await providerJSON('ankr',env.ANKR_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},{ttl:300,timeout:2500});
  return out({success:r.ok&&r.data?.result==='ok',verified:r.ok&&r.data?.result==='ok',provider:kind,error:r.error||null},r.ok&&r.data?.result==='ok'?200:503);
 }
 if(!['market','holders','jupiter','gecko','birdeye','coingecko','coinpaprika'].includes(kind))return out({success:false,error:'UNKNOWN_PROVIDER'},404);
 if(!validMint(mint))return out({success:false,error:'INVALID_MINT'},400);
 const order=kind==='market'?['dex','gecko','jupiter','birdeye','coingecko']:kind==='holders'?['jupiter']:[kind];
 const attempts=[];let selected=null;
 for(const p of order){const r=await tokenSource(p,mint,env);attempts.push({provider:r.provider,ok:r.ok,error:r.error||null,retryAt:r.retryAt||null});if(r.ok&&(kind==='holders'?r.holder_count_verified:kind==='coinpaprika'?!!r.coinpaprika_id:positive(r.price_usd))){selected=r;break}}
 return out({success:!!selected,data:selected,attempts,verified:kind==='holders'?!!selected?.holder_count_verified:!!selected},selected?200:attempts.some(x=>x.error==='RATE_LIMIT')?429:503);
}
export {rpcFallback};
