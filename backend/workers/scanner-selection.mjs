const valid=s=>typeof s==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export function selectScanMints(pool,followups=[],{cursor=0,limit=12,followupLimit=6}={}){
 const unique=[...new Set(pool.filter(valid))],due=[...new Set(followups.filter(valid))];
 const selected=due.slice(0,Math.min(limit,followupLimit));
 let visited=0,start=unique.length?Math.max(0,Math.floor(cursor)||0)%unique.length:0;
 while(selected.length<limit&&visited<unique.length){const mint=unique[(start+visited)%unique.length];visited++;if(!selected.includes(mint))selected.push(mint)}
 return {selected,nextCursor:unique.length?(start+visited)%unique.length:0,followupCount:Math.min(selected.length,due.length,followupLimit)};
}
