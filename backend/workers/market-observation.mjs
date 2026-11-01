// Shared normalization for server scanner and unsaved live feed.
export const marketNumber=value=>{
 if(!['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim()))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
const mintOK=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const nonnegative=value=>{const n=marketNumber(value);return n!==null&&n>=0?n:null};
const count=value=>{const n=nonnegative(value);return Number.isSafeInteger(n)?n:null};
const change=value=>{const n=marketNumber(value);return n!==null&&n>=-100?n:null};
export function scanPairs(pairs,{minLiquidityUsd=10000}={}){
 const results=[],seen=new Set();
 for(const p of Array.isArray(pairs)?pairs:[]){
  if(p?.chainId!=='solana'||typeof p.pairAddress!=='string'||!p.pairAddress)continue;
  const base=p.baseToken,quote=p.quoteToken;
  if(!mintOK(base?.address)||!mintOK(quote?.address))continue;
  const key=base.address+':'+p.pairAddress;if(seen.has(key))continue;
  const liquidityUsd=nonnegative(p.liquidity?.usd);if(liquidityUsd===null||liquidityUsd<minLiquidityUsd)continue;
  seen.add(key);
  const timeframes={};
  for(const window of ['m5','h1','h24']){
   const buys=count(p.txns?.[window]?.buys),sells=count(p.txns?.[window]?.sells);
   const total=buys!==null&&sells!==null&&Number.isSafeInteger(buys+sells)?buys+sells:null;
   timeframes[window]={volumeUsd:nonnegative(p.volume?.[window]),changePct:change(p.priceChange?.[window]),buys,sells,transactions:total,buyRatio:total!==null&&total>0?buys/total:null};
  }
  const day=timeframes.h24,price=marketNumber(p.priceUsd),created=marketNumber(p.pairCreatedAt);
  results.push({chain:'solana',pairAddress:p.pairAddress,dexId:p.dexId||null,
   base:{mint:base.address,symbol:base.symbol||null,name:base.name||null},quote:{mint:quote.address,symbol:quote.symbol||null,name:quote.name||null},
   priceUsd:price!==null&&price>0?price:null,liquidityUsd,volume24h:day.volumeUsd,change24h:day.changePct,
   buys24h:day.buys,sells24h:day.sells,timeframes,poolCreatedAt:created!==null&&created>0&&created<=8640000000000000?new Date(created).toISOString():null,
   momentum:{volumeLiquidityRatio:day.volumeUsd!==null&&liquidityUsd>0?day.volumeUsd/liquidityUsd:null,transactionBuyRatio:day.buyRatio},
   risk:{rugCheck:'UNKNOWN',whaleConcentration:'UNKNOWN'},source:p._source||'dexscreener',observedAt:p._observedAt||new Date().toISOString()});
 }
 // Canonical pool priority is depth, rather than a large volume/liquidity ratio in a dust pool.
 return results.sort((a,b)=>b.liquidityUsd-a.liquidityUsd||(b.volume24h??-1)-(a.volume24h??-1)||a.pairAddress.localeCompare(b.pairAddress));
}
