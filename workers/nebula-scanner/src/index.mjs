// NEBULA scanner: deterministic token identity and pool-specific discovery.
// No trading, D1 writes or production dependencies.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const number=x=>{const n=Number(x);return Number.isFinite(n)?n:null};
export function scanPairs(pairs,{minLiquidityUsd=10000}={}){
 const results=[];
 for(const p of Array.isArray(pairs)?pairs:[]){
  if(p?.chainId!=="solana"||!p?.pairAddress)continue;
  const base=p.baseToken,quote=p.quoteToken;
  if(!base?.address||!quote?.address)continue;
  const liq=number(p.liquidity?.usd);
  if(liq===null||liq<minLiquidityUsd)continue;
  const change24h=number(p.priceChange?.h24),volume24h=number(p.volume?.h24);
  const tx=p.txns?.h24||{};
  const buys=number(tx.buys)||0,sells=number(tx.sells)||0;
  results.push({chain:"solana",pairAddress:p.pairAddress,dexId:p.dexId||null,
   base:{mint:base.address,symbol:base.symbol||null,name:base.name||null},
   quote:{mint:quote.address,symbol:quote.symbol||null,name:quote.name||null},
   priceUsd:number(p.priceUsd),liquidityUsd:liq,volume24h,change24h,
   buys24h:buys,sells24h:sells,
   momentum:{volumeLiquidityRatio:volume24h!==null&&liq>0?volume24h/liq:null,
    transactionBuyRatio:buys+sells>0?buys/(buys+sells):null},
   risk:{rugCheck:"UNKNOWN",whaleConcentration:"UNKNOWN"},
   source:"dexscreener",observedAt:new Date().toISOString()});
 }
 return results.sort((a,b)=>(b.momentum.volumeLiquidityRatio??-1)-(a.momentum.volumeLiquidityRatio??-1));
}
export default {async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==="/health")return reply({service:"nebula-scanner",status:"ok"});
 if(u.pathname!=="/scan"||request.method!=="POST")return reply({error:"NOT_FOUND"},404);
 // Private Worker-to-Worker service token; do not expose public scan endpoint.
 if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.INTERNAL_TOKEN}`)return reply({error:"UNAUTHORIZED"},401);
 let payload;try{payload=await request.json()}catch{return reply({error:"INVALID_JSON"},400)}
 if(!Array.isArray(payload?.pairs)||payload.pairs.length>200)return reply({error:"INVALID_PAIRS"},400);
 return reply({items:scanPairs(payload.pairs),count:payload.pairs.length});
}};
