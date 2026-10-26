// NEBULA Multi-Provider V1: read-only provider adapters. No database writes.
const mintOK = ca => typeof ca === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const state = new Map();
async function jsonGet(url, headers = {}, provider = 'public', ttl = 60000) {
  const until = state.get(provider) || 0;
  if (Date.now() < until) return {ok:false,error:'COOLDOWN',provider};
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    let res;
    try { res = await fetch(url, {headers,signal:ctrl.signal}); }
    finally { clearTimeout(timer); }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'));
      state.set(provider, Date.now() + (Number.isFinite(retry) && retry>0 ? Math.min(retry,300)*1000 : 60000));
      return {ok:false,error:'RATE_LIMIT',provider};
    }
    if (!res.ok) return {ok:false,error:'HTTP_'+res.status,provider};
    return {ok:true,data:await res.json(),provider,ttl};
  } catch { return {ok:false,error:'UNAVAILABLE',provider}; }
}
export async function jupiterToken(ca, apiKey) {
  if (!mintOK(ca)) return {ok:false,error:'INVALID_MINT'};
  const headers = apiKey ? {'x-api-key':apiKey} : {};
  const r = await jsonGet('https://api.jup.ag/tokens/v2/search?query='+encodeURIComponent(ca),headers,'jupiter');
  if (!r.ok) return r;
  const token = Array.isArray(r.data) ? r.data.find(t=>t.id===ca || t.address===ca || t.mint===ca) : null;
  if (!token) return {ok:false,error:'TOKEN_NOT_FOUND',provider:'jupiter'};
  const holders = token.holderCount;
  return {ok:true,provider:'jupiter',token_ca:ca,holder_count:Number.isInteger(holders)&&holders>=0?holders:null,holder_count_verified:Number.isInteger(holders)&&holders>=0,price_usd:positive(token.usdPrice)?token.usdPrice:null,liquidity_usd:positive(token.liquidity)?token.liquidity:null,organic_score:token.organicScore??null,audit:token.audit??null,source_timestamp:Date.now()};
}
export async function geckoToken(ca) {
  if (!mintOK(ca)) return {ok:false,error:'INVALID_MINT'};
  const r = await jsonGet('https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+encodeURIComponent(ca),{'Accept':'application/json;version=20230203'},'gecko',60000);
  if (!r.ok) return r;
  const a = r.data?.data?.attributes;
  if (!a || !['solana_'+ca,ca].includes(r.data?.data?.id)) return {ok:false,error:'TOKEN_MISMATCH',provider:'gecko'};
  return {ok:true,provider:'gecko',token_ca:ca,price_usd:positive(Number(a.price_usd))?Number(a.price_usd):null,source_timestamp:Date.now()};
}
export async function birdeyeToken(ca, apiKey) {
  if (!mintOK(ca)) return {ok:false,error:'INVALID_MINT'};
  if (!apiKey) return {ok:false,error:'API_KEY_REQUIRED',provider:'birdeye'};
  const r=await jsonGet('https://public-api.birdeye.so/defi/price?address='+encodeURIComponent(ca),{'X-API-KEY':apiKey,'x-chain':'solana'},'birdeye');
  if (!r.ok) return r;
  const price=Number(r.data?.data?.value);
  return positive(price) ? {ok:true,provider:'birdeye',token_ca:ca,price_usd:price,source_timestamp:Date.now()} : {ok:false,error:'PRICE_UNAVAILABLE',provider:'birdeye'};
}
export async function marketFallback(ca, keys={}) {
  const providers=[()=>jupiterToken(ca,keys.jupiter),()=>geckoToken(ca),()=>birdeyeToken(ca,keys.birdeye)];
  const results=[];
  for(const run of providers){const r=await run();results.push(r);if(r.ok&&positive(r.price_usd))return {selected:r,attempts:results};}
  return {selected:null,attempts:results};
}
