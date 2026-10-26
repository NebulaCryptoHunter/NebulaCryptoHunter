// NEBULA Scanner V1 — discovery and market-data normalization only.
// No wallet actions, prediction, or production database mutations.
const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function normalizePair(pair){
 if(pair?.chainId!=='solana')return null;
 const base=pair.baseToken?.address,quote=pair.quoteToken?.address;
 if(!MINT.test(base||'')||!MINT.test(quote||''))return null;
 const n=x=>{const v=Number(x);return Number.isFinite(v)&&v>=0?v:null;};
 return {pairAddress:pair.pairAddress||null,dexId:pair.dexId||null,
  baseMint:base,quoteMint:quote,baseSymbol:pair.baseToken?.symbol||null,quoteSymbol:pair.quoteToken?.symbol||null,
  priceUsd:n(pair.priceUsd),liquidityUsd:n(pair.liquidity?.usd),
  volumeH1:n(pair.volume?.h1),volumeH24:n(pair.volume?.h24),
  changeH1:Number.isFinite(Number(pair.priceChange?.h1))?Number(pair.priceChange.h1):null,
  changeH24:Number.isFinite(Number(pair.priceChange?.h24))?Number(pair.priceChange.h24):null,
  buysH1:n(pair.txns?.h1?.buys),sellsH1:n(pair.txns?.h1?.sells),
  observedAt:new Date().toISOString()};
}
export function scanPairs(pairs){return (Array.isArray(pairs)?pairs:[]).map(normalizePair).filter(Boolean);}
export default {async fetch(request){const path=new URL(request.url).pathname;if(path==='/health')return Response.json({service:'nebula-scanner',status:'ready',mode:'read-only'});return Response.json({error:'NOT_FOUND'}, {status:404});}};
