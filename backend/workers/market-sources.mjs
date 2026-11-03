import {withPerformance} from './performance-metrics.mjs';
import {scanPairs,marketNumber} from './market-observation.mjs';
import {scoreCandidate} from './scoring-v2.mjs';
import {providerJSON,createProviderContext} from './provider-runtime.mjs';
import {jupiterBatch,metadataSummary,tokenEvidence,mintAccountBatch} from './token-evidence.mjs';
export const validMint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const positive=x=>{const n=marketNumber(x);return n!==null&&n>0};
const unique=(mints,limit=12)=>[...new Set((Array.isArray(mints)?mints:[]).filter(validMint))].slice(0,Math.min(30,limit));
const attempt=r=>({provider:r.provider,ok:r.ok,error:r.error||null,retryAt:r.retryAt||null,cached:!!r.cached,fromCooldown:!!r.fromCooldown});
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

export async function discoverMints({context=createProviderContext()}={}){
 const attempts=[],mints=[],pairs=[];
 const dex=await providerJSON('dexscreener','https://api.dexscreener.com/token-profiles/latest/v1',{}, {ttl:1800,context});
 attempts.push(attempt(dex));
 if(dex.ok&&Array.isArray(dex.data))mints.push(...dex.data.filter(x=>x.chainId==='solana').map(x=>x.tokenAddress).filter(validMint));
 // Discovery pools are reused by the current feed; do not fetch them a second time.
 const gecko=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/new_pools?include=base_token,quote_token,dex',{headers:{Accept:'application/json;version=20230203'}},{ttl:300,context});
 attempts.push(attempt(gecko));
 if(gecko.ok){pairs.push(...geckoPairs(gecko.data,gecko.fetchedAt,gecko));mints.push(...pairs.map(p=>p.baseToken.address))}
 // Pump.fun HTTP is discovery only. A rejected/paid endpoint is never retried in a loop.
 if(!mints.length){
  const pump=await providerJSON('pumpfun','https://frontend-api-v3.pump.fun/coins?offset=0&limit=12&sort=created_timestamp&order=DESC&includeNsfw=false',{}, {ttl:300,timeout:2000,context});
  attempts.push(attempt(pump));
  if(pump.ok&&Array.isArray(pump.data))mints.push(...pump.data.map(x=>x?.mint).filter(validMint));
 }
 return {mints:[...new Set(mints)],pairs,attempts};
}
export async function marketPairs(mints,{dexPaused=false,context=createProviderContext(),seedPairs=[],maxMints=12}={}){
 const selected=unique(mints,maxMints).sort(),pairs=seedPairs.filter(p=>selected.includes(p?.baseToken?.address)),attempts=[];
 if(!selected.length)return {pairs,attempts};
 const usable=()=>new Set(scanPairs(pairs).filter(c=>positive(c.priceUsd)).map(c=>c.base.mint));
 const appendDex=r=>{if(r.ok&&Array.isArray(r.data))pairs.push(...r.data.filter(p=>p.chainId==='solana'&&selected.includes(p.baseToken?.address)).map(p=>({...p,_source:'dexscreener',_observedAt:r.fetchedAt,_sourceAsOf:r.sourceAsOf??null,_sourceTimeBasis:r.sourceTimeBasis||'FETCH_ONLY'})))};
 const missing=selected.filter(x=>!usable().has(x));
 if(missing.length){
  const dex=dexPaused?{ok:false,provider:'dexscreener',error:'COOLDOWN'}:await providerJSON('dexscreener','https://api.dexscreener.com/tokens/v1/solana/'+missing.join(','),{}, {ttl:60,context});
  attempts.push(attempt(dex));
  appendDex(dex);
  // A bounded alternative documented route can still be available when the batch endpoint is limited.
  // Its own Retry-After is respected; there is no retry of the limited batch endpoint.
  if(!dexPaused&&dex.error==='RATE_LIMIT')for(const mint of selected.filter(x=>!usable().has(x)).slice(0,2)){
   const single=await providerJSON('dexscreener','https://api.dexscreener.com/token-pairs/v1/solana/'+mint,{}, {ttl:60,context});
   attempts.push({...attempt(single),mint,endpoint:'token-pairs'});appendDex(single);
   if(['RATE_LIMIT','AUTH_ERROR','REQUEST_BUDGET_EXHAUSTED'].includes(single.error))break;
  }
 }
 // Incomplete/dust Dex responses do not suppress an independent pool source.
 for(const mint of selected.filter(x=>!usable().has(x)).slice(0,3)){
  const r=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+mint+'/pools?include=base_token,quote_token,dex',{headers:{Accept:'application/json;version=20230203'}},{ttl:60,context});
  attempts.push({...attempt(r),mint});
  if(r.ok)pairs.push(...geckoPairs(r.data,r.fetchedAt,r).filter(p=>p.baseToken.address===mint));
  if(['RATE_LIMIT','AUTH_ERROR','REQUEST_BUDGET_EXHAUSTED'].includes(r.error))break;
 }
 return {pairs,attempts};
}
// Price-only quotes never acquire invented pool identity, liquidity, score or a positive risk verdict.
export async function freeQuotes(mints,env={}, {context=createProviderContext(),jupiter=null}={}){
 const selected=unique(mints).sort(),items=[],attempts=[];
 if(!selected.length)return {items,attempts};
 const append=(mint,price,symbol,source,observed,sourceAsOf=null,sourceTimeBasis='FETCH_ONLY')=>{
  if(selected.includes(mint)&&positive(price)&&!items.some(x=>x.mint===mint))items.push({mint,symbol:symbol||null,pair_address:null,observed_at:observed,price_usd:Number(price),liquidity_usd:null,volume_24h:null,change_24h:null,source,source_as_of:sourceAsOf,sourceTimeBasis,score:null,decision:'WATCH',model:null,risk_verified:false,evaluation_status:'NOT_PERSISTED',dataCoverage:'PRICE_ONLY'});
 };
 const jup=jupiter||await jupiterBatch(selected,env,context);
 attempts.push(attempt(jup));
 if(jup.ok)for(const t of jup.data)append(t.id,t.usdPrice,t.symbol,'jupiter',jup.fetchedAt,jup.sourceAsOf,jup.sourceTimeBasis);
 let missing=selected.filter(x=>!items.some(t=>t.mint===x));
 if(missing.length){
  const cg=await providerJSON('coingecko','https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses='+missing.join(',')+'&vs_currencies=usd&include_last_updated_at=true',{headers:env.COINGECKO_API_KEY?{'x-cg-demo-api-key':env.COINGECKO_API_KEY}:{}},{ttl:60,timeout:2500,context});
  attempts.push(attempt(cg));
  if(cg.ok)for(const mint of missing){
   const row=cg.data?.[mint],time=typeof row?.last_updated_at==='number'&&Number.isFinite(row.last_updated_at)?row.last_updated_at*1000:NaN;
   append(mint,row?.usd,null,'coingecko',cg.fetchedAt,Number.isFinite(time)&&Math.abs(time)<=8640000000000000?new Date(time).toISOString():cg.sourceAsOf,Number.isFinite(time)?'PROVIDER_PRICE_TIME':cg.sourceTimeBasis);
  }
 }
 missing=selected.filter(x=>!items.some(t=>t.mint===x));
 if(env.BIRDEYE_API_KEY)for(const mint of missing.slice(0,2)){
  const b=await providerJSON('birdeye','https://public-api.birdeye.so/defi/price?address='+mint,{headers:{'X-API-KEY':env.BIRDEYE_API_KEY,'x-chain':'solana'}},{ttl:60,timeout:2500,context});
  attempts.push({...attempt(b),mint});
  if(b.ok&&b.data?.success===true)append(mint,b.data.data?.value,null,'birdeye',b.fetchedAt,b.sourceAsOf,b.sourceTimeBasis);
  if(['RATE_LIMIT','AUTH_ERROR','FREE_PLAN_UNAVAILABLE','REQUEST_BUDGET_EXHAUSTED'].includes(b.error))break;
 }
 return {items,attempts};
}
export async function marketFeed(env={}, {mints=null,includeObservations=false,context=createProviderContext()}={}){
 const discovery=mints===null?await discoverMints({context}):{mints:unique(mints),pairs:[],attempts:[]};
 const selected=unique(discovery.mints),market=await marketPairs(selected,{context,seedPairs:discovery.pairs});
 const seen=new Set(),items=[],observations=[],poolCounts=new Map();
 for(const c of scanPairs(market.pairs)){
  if(!positive(c.priceUsd)||(poolCounts.get(c.base.mint)||0)>=3)continue;
  seen.add(c.base.mint);poolCounts.set(c.base.mint,(poolCounts.get(c.base.mint)||0)+1);observations.push(c);
 }
 const metadata=await jupiterBatch(selected,env,context);
 for(const c of observations)c.tokenMetadata=metadataSummary(metadata.tokens.get(c.base.mint),metadata.fetchedAt,metadata);
 // Fill missing prices before spending the remaining upstream budget on extra evidence.
 const quotes=await freeQuotes(selected.filter(x=>!seen.has(x)),env,{context,jupiter:metadata}),evidenceByMint=new Map();
 if(selected.length){
  const priority=[...observations].sort((a,b)=>b.liquidityUsd-a.liquidityUsd)[0]?.base.mint||selected[0];
  const evidence=await tokenEvidence(priority,env,context,{includeRpc:false});
  evidenceByMint.set(priority,evidence.evidence);market.attempts.push(...evidence.attempts);
  const mintAccounts=await mintAccountBatch(selected,env,context);
  market.attempts.push(...mintAccounts.attempts);
  for(const mint of selected)if(mintAccounts.evidence.has(mint))evidenceByMint.set(mint,{...evidenceByMint.get(mint),mintAccount:mintAccounts.evidence.get(mint)});
 }
 for(const c of observations)c.verificationEvidence=evidenceByMint.get(c.base.mint)||null;
 const displayed=new Set();
 for(const c of observations){if(displayed.has(c.base.mint))continue;displayed.add(c.base.mint);items.push({mint:c.base.mint,symbol:c.base.symbol,pair_address:c.pairAddress,observed_at:c.observedAt,price_usd:c.priceUsd,liquidity_usd:c.liquidityUsd,volume_24h:c.volume24h,change_24h:c.change24h,source:c.source,source_as_of:c.sourceAsOf,timeframes:c.timeframes,tokenMetadata:c.tokenMetadata,verificationEvidence:c.verificationEvidence||null,...scoreCandidate(c),risk_verified:false,evaluation_status:'NOT_PERSISTED'});}
 for(const item of quotes.items){item.tokenMetadata=metadataSummary(metadata.tokens.get(item.mint),metadata.fetchedAt,metadata);item.verificationEvidence=evidenceByMint.get(item.mint)||null;}
 items.push(...quotes.items);
 const feed={items,source:'live-provider-fallback',dataStatus:'LIVE_ONLY',persisted:false,modelCalibrated:false,automaticScanning:false,counts:null,runs:[],candidates:[],evaluations:[],providerAttempts:[...discovery.attempts,...market.attempts,attempt(metadata),...quotes.attempts.filter(x=>x.provider!=='jupiter')],requestBudget:{upstreamRequests:context.attempts,cacheHits:context.cacheHits,remaining:context.remaining},generatedAt:new Date().toISOString()};
 if(includeObservations)feed.observations=observations;
 return withPerformance(feed);
}
// Scanner/evaluator reuse existing server credentials through a service binding; secrets are never copied.
export async function scannerMarket(mints,env,options={}){
 const selected=unique(mints);
 if(env.MARKET_API)try{
  const r=await env.MARKET_API.fetch('https://market.internal/api/v1/market-feed?mints='+selected.join(',')+'&observations=1',{signal:AbortSignal.timeout(15000)});
  const data=await r.json();
  if(r.ok&&Array.isArray(data.observations)&&data.observations.length<=36&&data.observations.every(c=>c?.chain==='solana'&&selected.includes(c.base?.mint)&&validMint(c.quote?.mint)&&typeof c.pairAddress==='string'&&positive(c.priceUsd)&&positive(c.liquidityUsd)))
   return {pairs:[],observations:data.observations,items:data.items,attempts:data.providerAttempts||[],bridge:true};
 }catch{}
 return marketPairs(selected,options);
}
