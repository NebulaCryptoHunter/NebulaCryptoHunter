import {scanPairs} from './market-observation.mjs';
import {scoreCandidate} from './scoring-v2.mjs';
import {providerJSON} from './provider-runtime.mjs';
export const validMint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const positive=x=>x!==null&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0;
export function geckoPairs(payload,fetchedAt,timing={}){
 const included=new Map((payload?.included||[]).map(t=>[t.id,t.attributes||{}]));
 return (Array.isArray(payload?.data)?payload.data:[]).flatMap(p=>{
  if(p.type!=='pool'||!p.id?.startsWith('solana_'))return [];
  const a=p.attributes||{},rel=p.relationships||{},baseId=rel.base_token?.data?.id,quoteId=rel.quote_token?.data?.id;
  const base=baseId?.startsWith('solana_')?baseId.slice(7):'',quote=quoteId?.startsWith('solana_')?quoteId.slice(7):'';
  if(!validMint(base)||!validMint(quote)||!validMint(a.address)||p.id!=='solana_'+a.address||!positive(a.base_token_price_usd))return [];
  const b=included.get(baseId)||{},q=included.get(quoteId)||{};
  return [{chainId:'solana',pairAddress:a.address,dexId:rel.dex?.data?.id||null,baseToken:{address:base,name:b.name||base,symbol:b.symbol||null},quoteToken:{address:quote,name:q.name||quote,symbol:q.symbol||null},priceUsd:a.base_token_price_usd,liquidity:{usd:a.reserve_in_usd},volume:a.volume_usd,priceChange:a.price_change_percentage,txns:a.transactions,pairCreatedAt:typeof a.pool_created_at==='string'?Date.parse(a.pool_created_at):null,_source:'geckoterminal',_observedAt:fetchedAt,_sourceAsOf:timing.sourceAsOf??null,_sourceTimeBasis:timing.sourceTimeBasis||'FETCH_ONLY'}];
 });
}
export async function discoverMints(){
 const attempts=[];
 const dex=await providerJSON('dexscreener','https://api.dexscreener.com/token-profiles/latest/v1',{}, {ttl:21600});
 attempts.push({provider:'dexscreener',ok:dex.ok,error:dex.error||null});
 if(dex.ok&&Array.isArray(dex.data)){const mints=[...new Set(dex.data.filter(x=>x.chainId==='solana').map(x=>x.tokenAddress).filter(validMint))];if(mints.length)return {mints,attempts}}
 const gecko=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,quote_token,dex',{}, {ttl:300});
 attempts.push({provider:'geckoterminal',ok:gecko.ok,error:gecko.error||null});
 return {mints:[...new Set(gecko.ok?geckoPairs(gecko.data,gecko.fetchedAt).map(x=>x.baseToken.address):[])],attempts};
}
export async function marketPairs(mints,{dexPaused=false}={}){
 const selected=[...new Set(mints.filter(validMint))].slice(0,12),pairs=[],attempts=[];
 if(!selected.length)return {pairs,attempts};
 const dex=dexPaused?{ok:false,error:'COOLDOWN'}:await providerJSON('dexscreener','https://api.dexscreener.com/tokens/v1/solana/'+selected.join(','),{}, {ttl:60});
 attempts.push({provider:'dexscreener',ok:dex.ok,error:dex.error||null,retryAt:dex.retryAt||null});
 if(dex.ok&&Array.isArray(dex.data))pairs.push(...dex.data.filter(p=>p.chainId==='solana'&&selected.includes(p.baseToken?.address)).map(p=>({...p,_source:'dexscreener',_observedAt:dex.fetchedAt,_sourceAsOf:dex.sourceAsOf??null,_sourceTimeBasis:dex.sourceTimeBasis||'FETCH_ONLY'})));
 const seen=new Set(pairs.map(x=>x.baseToken.address));
 // Three fallback token-pool requests maximum per run; never 12 unbounded enrichments.
 for(const mint of selected.filter(x=>!seen.has(x)).slice(0,3)){
  const r=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+mint+'/pools?include=base_token,quote_token,dex',{}, {ttl:60});
  attempts.push({provider:'geckoterminal',mint,ok:r.ok,error:r.error||null,retryAt:r.retryAt||null});
  if(r.ok)pairs.push(...geckoPairs(r.data,r.fetchedAt,r).filter(p=>p.baseToken.address===mint));
  if(r.error==='RATE_LIMIT'||r.error==='AUTH_ERROR')break;
 }
 return {pairs,attempts};
}
// Price-only data is useful for a live feed, but never becomes a pool snapshot or AI score.
export async function freeQuotes(mints,env={}){
 const selected=[...new Set(mints.filter(validMint))].slice(0,12),items=[],attempts=[];
 if(!selected.length)return {items,attempts};
 const append=(mint,price,symbol,source,observed)=>{if(selected.includes(mint)&&positive(price)&&!items.some(x=>x.mint===mint))items.push({mint,symbol:symbol||null,pair_address:null,observed_at:observed,price_usd:Number(price),liquidity_usd:null,volume_24h:null,change_24h:null,source,score:null,decision:'WATCH',model:null,risk_verified:false,evaluation_status:'NOT_PERSISTED',dataCoverage:'PRICE_ONLY'})};
 const jup=await providerJSON('jupiter','https://api.jup.ag/tokens/v2/search?query='+selected.join(','),{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{}},{ttl:60,timeout:2500});
 attempts.push({provider:'jupiter',ok:jup.ok,error:jup.error||null});
 if(jup.ok&&Array.isArray(jup.data))for(const t of jup.data)append(t.id,t.usdPrice,t.symbol,'jupiter',jup.fetchedAt);
 if(items.length)return {items,attempts};
 const cg=await providerJSON('coingecko','https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses='+selected.join(',')+'&vs_currencies=usd',{headers:env.COINGECKO_API_KEY?{'x-cg-demo-api-key':env.COINGECKO_API_KEY}:{}},{ttl:60,timeout:2500});
 attempts.push({provider:'coingecko',ok:cg.ok,error:cg.error||null});
 if(cg.ok)for(const mint of selected)append(mint,cg.data?.[mint]?.usd,null,'coingecko',cg.fetchedAt);
 if(items.length||!env.BIRDEYE_API_KEY)return {items,attempts};
 for(const mint of selected.slice(0,2)){
  const b=await providerJSON('birdeye','https://public-api.birdeye.so/defi/price?address='+mint,{headers:{'X-API-KEY':env.BIRDEYE_API_KEY,'x-chain':'solana'}},{ttl:60,timeout:2500});
  attempts.push({provider:'birdeye',ok:b.ok,error:b.error||null});
  if(b.ok&&b.data?.success===true)append(mint,b.data.data?.value,null,'birdeye',b.fetchedAt);
  if(b.error==='RATE_LIMIT')break;
 }
 return {items,attempts};
}
export async function marketFeed(env={}){
 const discovery=await discoverMints(),m=await marketPairs(discovery.mints);
 const seen=new Set(),items=[];
 for(const c of scanPairs(m.pairs)){
  if(seen.has(c.base.mint)||!positive(c.priceUsd))continue;seen.add(c.base.mint);
  const score=scoreCandidate(c);
  items.push({mint:c.base.mint,symbol:c.base.symbol,pair_address:c.pairAddress,observed_at:c.observedAt,price_usd:c.priceUsd,liquidity_usd:c.liquidityUsd,volume_24h:c.volume24h,change_24h:c.change24h,source:c.source,timeframes:c.timeframes,...score,risk_verified:false,evaluation_status:'NOT_PERSISTED'});
 }
 const quotes=items.length?{items:[],attempts:[]}:await freeQuotes(discovery.mints,env);
 items.push(...quotes.items);
 return {items,source:'live-provider-fallback',dataStatus:'LIVE_ONLY',persisted:false,modelCalibrated:false,automaticScanning:false,counts:null,runs:[],candidates:[],evaluations:[],providerAttempts:[...discovery.attempts,...m.attempts,...quotes.attempts],generatedAt:new Date().toISOString()};
}
