// NEBULA AI Engine V1: explainable heuristic baseline, NOT a trained AI model.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export function scoreCandidate(c){
 const reasons=[],risk=c?.risk||{};
 const numeric=x=>x===null||x===undefined||x===""?NaN:Number(x);
 const liq=numeric(c?.liquidityUsd),vol=numeric(c?.volume24h),change=numeric(c?.change24h);
 if(!Number.isFinite(liq)||liq<=0||!Number.isFinite(vol)||vol<0||!Number.isFinite(change))
  return {decision:"INSUFFICIENT_DATA",score:null,confidence:null,confidenceReason:"NOT_CALIBRATED",reasons:["Missing valid market data"],model:"heuristic-v1"};
 const ratio=vol/liq;
 let score=clamp(Math.log10(1+ratio)*22+Math.min(Math.max(change,0),150)*0.18,0,100);
 const unknown=risk.rugCheck!=="SAFE"||risk.whaleConcentration!=="SAFE";
 if(unknown)reasons.push("Security or whale concentration unverified");
 if(change>1000)reasons.push("Extreme 24h appreciation; elevated reversal risk");
 if(liq<50000)reasons.push("Thin liquidity");
 const gate=unknown||change>1000||liq<50000;
 return {decision:gate?"WATCH":score>=60?"REVIEW":"WATCH",
  score:Math.round(score*100)/100,confidence:null,confidenceReason:"NOT_CALIBRATED",
  reasons,model:"heuristic-v1",autoTrade:false};
}
export default {async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==="/health")return reply({service:"nebula-ai-engine",status:"ok",model:"heuristic-v1"});
 if(u.pathname!=="/score"||request.method!=="POST")return reply({error:"NOT_FOUND"},404);
 if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.INTERNAL_TOKEN}`)return reply({error:"UNAUTHORIZED"},401);
 let body;try{body=await request.json()}catch{return reply({error:"INVALID_JSON"},400)}
 if(!Array.isArray(body?.items)||body.items.length>200||body.items.some(c=>!c||typeof c!=="object"||Array.isArray(c)))return reply({error:"INVALID_ITEMS"},400);
 return reply({results:body.items.map(c=>({mint:c.base?.mint||null,pairAddress:c.pairAddress,...scoreCandidate(c)}))});
}};

