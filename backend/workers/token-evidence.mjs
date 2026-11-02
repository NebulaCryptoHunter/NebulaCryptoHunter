import {providerJSON,rpcFallback} from './provider-runtime.mjs';
import {marketNumber} from './market-observation.mjs';
const positive=x=>{const n=marketNumber(x);return n!==null&&n>0?n:null};
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
export async function jupiterBatch(mints,env={},context){
 const selected=[...new Set(mints)].sort();
 if(!selected.length)return {ok:true,data:[],tokens:new Map(),provider:'jupiter'};
 const r=await providerJSON('jupiter','https://api.jup.ag/tokens/v2/search?query='+selected.join(','),{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{}},{ttl:60,timeout:2500,context});
 const rows=r.ok&&Array.isArray(r.data)?r.data.filter(t=>selected.includes(t?.id)):[];
 return {...r,tokens:new Map(rows.map(t=>[t.id,t])),data:rows};
}
export function metadataSummary(t,observedAt,timing={}){
 if(!t)return null;
  return {source:'jupiter',mint:t.id,identityVerified:typeof t.id==='string',observedAt,sourceUpdatedAt:typeof t.updatedAt==='string'?t.updatedAt:null,
  sourceAsOf:timing.sourceAsOf??null,sourceTimeBasis:timing.sourceTimeBasis||'FETCH_ONLY',
  holderCount:count(t.holderCount),organicScore:marketNumber(t.organicScore),
  liquidityUsd:positive(t.liquidity),scope:'TOKEN_AGGREGATE',
  mintAuthorityDisabled:typeof t.audit?.mintAuthorityDisabled==='boolean'?t.audit.mintAuthorityDisabled:null,
  freezeAuthorityDisabled:typeof t.audit?.freezeAuthorityDisabled==='boolean'?t.audit.freezeAuthorityDisabled:null,
  topHoldersPercentage:marketNumber(t.audit?.topHoldersPercentage),isSus:t.audit?.isSus===true};
}
// One priority token per feed, cached for five minutes. Evidence is retained without inventing SAFE risk labels.
export async function tokenEvidence(mint,env={},context,{includeRpc=true}={}){
 const evidence={},attempts=[];
 const rug=await providerJSON('rugcheck','https://api.rugcheck.xyz/v1/tokens/'+mint+'/report',{}, {ttl:300,timeout:2000,context});
 attempts.push({provider:'rugcheck',ok:rug.ok,error:rug.error||null,cached:!!rug.cached});
 if(rug.ok&&rug.data?.mint===mint)evidence.rugcheck={source:'rugcheck',mint,observedAt:rug.fetchedAt,sourceAsOf:rug.sourceAsOf??null,sourceTimeBasis:rug.sourceTimeBasis||'FETCH_ONLY',identityVerified:true,
  score:marketNumber(rug.data.score),riskCount:Array.isArray(rug.data.risks)?rug.data.risks.length:null,
  hasDanger:Array.isArray(rug.data.risks)?rug.data.risks.some(x=>String(x?.level).toLowerCase()==='danger'):null,rugged:typeof rug.data.rugged==='boolean'?rug.data.rugged:null,
  risks:Array.isArray(rug.data.risks)?rug.data.risks.slice(0,12).map(x=>({name:x?.name||null,level:x?.level||null,score:marketNumber(x?.score)})):[],status:'EVIDENCE_ONLY'};
 if(includeRpc&&env.HELIUS_API_KEY){
  const rpc=await rpcFallback({jsonrpc:'2.0',id:1,method:'getAccountInfo',params:[mint,{encoding:'jsonParsed',commitment:'confirmed'}]},env,{context,ttl:300});
  attempts.push({provider:rpc.provider||'helius',ok:rpc.ok,error:rpc.error||null,cached:!!rpc.cached});
  const parsed=rpc.data?.result?.value?.data?.parsed,info=parsed?.info;
  if(rpc.ok&&parsed?.type==='mint'&&info&&typeof info==='object')evidence.mintAccount={source:rpc.provider,mint,identityVerified:true,tokenProgram:rpc.data.result.value.owner||null,observedAt:rpc.fetchedAt,sourceAsOf:rpc.sourceAsOf??null,sourceTimeBasis:rpc.sourceTimeBasis||'FETCH_ONLY',
   supply:typeof info.supply==='string'?info.supply:null,decimals:count(info.decimals),
   mintAuthorityDisabled:Object.hasOwn(info,'mintAuthority')?info.mintAuthority===null:null,
   freezeAuthorityDisabled:Object.hasOwn(info,'freezeAuthority')?info.freezeAuthority===null:null,status:'EVIDENCE_ONLY'};
 }
 return {evidence,attempts};
}
export async function mintAccountBatch(mints,env={},context){
 const selected=[...new Set(mints)].sort().slice(0,12),evidence=new Map(),attempts=[];
 if(!selected.length||!env.HELIUS_API_KEY)return {evidence,attempts};
 const rpc=await rpcFallback({jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[selected,{encoding:'jsonParsed',commitment:'confirmed'}]},env,{context,ttl:300});
 attempts.push({provider:rpc.provider||'helius',ok:rpc.ok,error:rpc.error||null,cached:!!rpc.cached});
 const rows=rpc.data?.result?.value;
 if(rpc.ok&&Array.isArray(rows)&&rows.length===selected.length)for(let i=0;i<selected.length;i++){
  const parsed=rows[i]?.data?.parsed,info=parsed?.info;
  if(parsed?.type!=='mint'||!info||typeof info!=='object')continue;
  evidence.set(selected[i],{source:rpc.provider,mint:selected[i],identityVerified:true,tokenProgram:rows[i].owner||null,observedAt:rpc.fetchedAt,sourceAsOf:rpc.sourceAsOf??null,sourceTimeBasis:rpc.sourceTimeBasis||'FETCH_ONLY',supply:typeof info.supply==='string'?info.supply:null,decimals:count(info.decimals),
   mintAuthorityDisabled:Object.hasOwn(info,'mintAuthority')?info.mintAuthority===null:null,
   freezeAuthorityDisabled:Object.hasOwn(info,'freezeAuthority')?info.freezeAuthority===null:null,status:'EVIDENCE_ONLY'});
 }
 return {evidence,attempts};
}
