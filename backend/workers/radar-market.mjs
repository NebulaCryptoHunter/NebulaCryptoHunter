import {marketPairs,validMint} from './market-sources.mjs';
import {scanPairs} from './market-observation.mjs';
import {createProviderContext,providerJSON} from './provider-runtime.mjs';
import {jupiterBatch,metadataSummary,mintAccountBatch,tokenEvidence} from './token-evidence.mjs';
import {closedCandles,detectPattern} from './radar-patterns.mjs';
export async function monitorMarketRoute(request,env){
 const url=new URL(request.url);
 if(url.hostname!=='monitor.internal')return Response.json({error:'INTERNAL_SERVICE_ONLY'},{status:403});
 const mints=[...new Set((url.searchParams.get('mints')||'').split(',').filter(validMint))].slice(0,30);
 if(!mints.length)return Response.json({error:'INVALID_MINTS'},{status:400});
 const context=createProviderContext({maxRequests:8,deadlineMs:10000}),market=await marketPairs(mints,{maxMints:30,context});
 const observations=scanPairs(market.pairs,{minLiquidityUsd:0}),riskMints=(url.searchParams.get('risk')||'').split(',').filter(x=>mints.includes(x)).slice(0,12);
 if(riskMints.length&&observations.length){
  const meta=await jupiterBatch(riskMints,env,context);
  const rpc=await mintAccountBatch(riskMints,env,context);
  const rug=await tokenEvidence(riskMints[0],env,context,{includeRpc:false});
  for(const c of observations){
   if(meta.tokens.has(c.base.mint))c.tokenMetadata=metadataSummary(meta.tokens.get(c.base.mint),meta.fetchedAt,meta);
   const evidence={...(rpc.evidence.has(c.base.mint)?{mintAccount:rpc.evidence.get(c.base.mint)}:{})};
   if(c.base.mint===riskMints[0])Object.assign(evidence,rug.evidence);
   if(Object.keys(evidence).length)c.verificationEvidence=evidence;
  }
 }
 return Response.json({observations,attempts:market.attempts,budget:{requests:context.attempts,remaining:context.remaining},generatedAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
}
export async function fetchPattern(track,{now=Date.now(),context=createProviderContext()}={}){
 const r=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/pools/'+encodeURIComponent(track.pair_address)+'/ohlcv/minute?aggregate=1&limit=40&currency=usd&token=base&include_empty_intervals=true',
  {headers:{Accept:'application/json;version=20230203'}},{ttl:120,timeout:2500,context});
 const parsed=r.ok?closedCandles(r.data,{mint:track.mint,pairAddress:track.pair_address,now}):{ok:false,reason:r.error||'CANDLES_UNAVAILABLE',candles:[]};
 return {pattern:detectPattern(parsed,{now}),candles:parsed.candles,source:r.provider,error:r.error||null};
}
