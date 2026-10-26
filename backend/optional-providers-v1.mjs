// NEBULA optional provider adapters. Read-only; no trading or D1 writes.
const mintOK = ca => typeof ca === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca);
async function request(url, options={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),6500);
  try {
    const res=await fetch(url,{...options,signal:controller.signal});
    if(res.status===429)return {ok:false,error:'RATE_LIMIT',status:429};
    if(!res.ok)return {ok:false,error:'HTTP_'+res.status,status:res.status};
    return {ok:true,data:await res.json(),status:res.status};
  } catch {return {ok:false,error:'UPSTREAM_UNAVAILABLE'};}
  finally {clearTimeout(timeout);}
}
const validPrice = p => Number.isFinite(Number(p)) && Number(p)>0;
export async function solanaRpcHealth(url='https://api.mainnet-beta.solana.com'){
  const r=await request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})});
  return r.ok && r.data?.result==='ok' ? {ok:true,provider:'solana_rpc',slot:null} : {ok:false,provider:'solana_rpc',error:r.error||r.data?.error?.message||'NOT_HEALTHY'};
}
export async function ankrRpcHealth(endpoint){
  if(!endpoint || !/^https:\/\//.test(endpoint))return {ok:false,provider:'ankr',error:'ENDPOINT_REQUIRED'};
  const r=await request(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})});
  return r.ok && r.data?.result==='ok' ? {ok:true,provider:'ankr'} : {ok:false,provider:'ankr',error:r.error||r.data?.error?.message||'NOT_HEALTHY'};
}
export async function coingeckoToken(ca,apiKey){
  if(!mintOK(ca))return {ok:false,error:'INVALID_MINT',provider:'coingecko'};
  const headers=apiKey?{'x-cg-demo-api-key':apiKey}:{};
  const r=await request('https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses='+encodeURIComponent(ca)+'&vs_currencies=usd',{headers});
  if(!r.ok)return {...r,provider:'coingecko'};
  const match=Object.entries(r.data||{}).find(([k])=>k.toLowerCase()===ca.toLowerCase());
  const price=match?.[1]?.usd;
  return validPrice(price)?{ok:true,provider:'coingecko',token_ca:ca,price_usd:Number(price)}:{ok:false,provider:'coingecko',error:'TOKEN_NOT_FOUND'};
}
export async function coinpaprikaToken(ca){
  if(!mintOK(ca))return {ok:false,error:'INVALID_MINT',provider:'coinpaprika'};
  const r=await request('https://api.coinpaprika.com/v1/contracts/solana/'+encodeURIComponent(ca));
  if(!r.ok)return {...r,provider:'coinpaprika'};
  const tokenId=r.data?.id;
  return typeof tokenId==='string' && tokenId.length>0?{ok:true,provider:'coinpaprika',token_ca:ca,coinpaprika_id:tokenId,price_usd:null}:{ok:false,provider:'coinpaprika',error:'TOKEN_NOT_FOUND'};
}
// WebSocket providers require a live socket lifecycle and cannot be truthfully checked with HTTP GET.
export function pumpPortalWebSocketInfo(){return {ok:false,provider:'pump_ws',error:'WEBSOCKET_LIFECYCLE_REQUIRED'};}

export async function optionalProviderRoute(path, env={}) {
  const match=/^\/api\/v1\/providers\/(solana_rpc|ankr|coingecko|coinpaprika|pump_ws)(?:\/([^/]+))?$/.exec(path);
  if(!match) return null;
  const provider=match[1], mint=match[2];
  if(provider==='solana_rpc') return solanaRpcHealth();
  if(provider==='ankr') return ankrRpcHealth(env.ANKR_RPC_URL);
  if(provider==='pump_ws') return pumpPortalWebSocketInfo();
  if(!mint) return {ok:false,provider,error:'MINT_REQUIRED'};
  if(provider==='coingecko') return coingeckoToken(mint,env.COINGECKO_API_KEY);
  return coinpaprikaToken(mint);
}
