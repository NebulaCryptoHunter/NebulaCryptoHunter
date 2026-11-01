import {scoreCandidate,MODEL} from './scoring-v2.mjs';
export {scoreCandidate} from './scoring-v2.mjs';
const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
export default {async fetch(request,env){
 const u=new URL(request.url);
 if(u.pathname==="/health")return reply({service:"nebula-ai-engine",status:"ok",model:MODEL});
 if(u.pathname!=="/score"||request.method!=="POST")return reply({error:"NOT_FOUND"},404);
 if(!env.INTERNAL_TOKEN||request.headers.get("Authorization")!==`Bearer ${env.INTERNAL_TOKEN}`)return reply({error:"UNAUTHORIZED"},401);
 let body;try{body=await request.json()}catch{return reply({error:"INVALID_JSON"},400)}
 if(!Array.isArray(body?.items)||body.items.length>200||body.items.some(c=>!c||typeof c!=="object"||Array.isArray(c)))return reply({error:"INVALID_ITEMS"},400);
 return reply({results:body.items.map(c=>({mint:c.base?.mint||null,pairAddress:c.pairAddress,...scoreCandidate(c)}))});
}};

