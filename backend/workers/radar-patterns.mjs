import {finite,positive} from './radar-policy.mjs';
export const PATTERN_VERSION='ohlcv-patterns-v1.0.0';
const median=xs=>{const a=[...xs].sort((a,b)=>a-b),n=a.length;return n?n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2:0};
export function closedCandles(payload,{mint,pairAddress,now=Date.now(),intervalSeconds=60}={}){
 const list=payload?.data?.attributes?.ohlcv_list,base=payload?.meta?.base?.address;
 if(!mint||!pairAddress||base!==mint||!Array.isArray(list))return {ok:false,reason:'CANDLE_IDENTITY_UNVERIFIED',candles:[]};
 const seen=new Set(),candles=[];
 for(const row of list){
  if(!Array.isArray(row)||row.length<6||!row.slice(0,6).every(finite))return {ok:false,reason:'INVALID_OHLCV',candles:[]};
  const [time,open,high,low,close,volume]=row;
  if(!Number.isSafeInteger(time)||time%intervalSeconds!==0||!positive(open)||!positive(high)||!positive(low)||!positive(close)||high<Math.max(open,close)||low>Math.min(open,close)||low>high||volume<0)return {ok:false,reason:'INVALID_OHLCV',candles:[]};
  if(time*1000+intervalSeconds*1000>now)continue;
  if(seen.has(time))return {ok:false,reason:'DUPLICATE_CANDLE',candles:[]};
  seen.add(time);candles.push({time,open,high,low,close,volume});
 }
 candles.sort((a,b)=>a.time-b.time);
 const recent=candles.slice(-40);
 if(recent.some((c,i)=>i&&c.time-recent[i-1].time!==intervalSeconds))return {ok:false,reason:'CANDLE_GAPS',candles:recent};
 if(!recent.length||now-(recent.at(-1).time+intervalSeconds)*1000>3*intervalSeconds*1000)return {ok:false,reason:'STALE_CANDLES',candles:recent};
 return {ok:true,candles:recent};
}
export function detectPattern(input,{now=Date.now()}={}){
 const unknown=reason=>({version:PATTERN_VERSION,type:'INSUFFICIENT_DATA',reason,detectedAt:new Date(now).toISOString(),calibrated:false});
 if(!input?.ok||input.candles.length<20)return unknown(input?.reason||'NEED_20_CLOSED_CANDLES');
 const c=input.candles.slice(-40),n=c.length,last=c.at(-1),prior=c.slice(0,-3),tail=c.slice(-3);
 if(c.filter(x=>x.volume>0).length<10||c.slice(-5).every(x=>x.volume===0))return unknown('INSUFFICIENT_TRADING_ACTIVITY');
 const baseline=median(prior.slice(1).map((x,i)=>Math.abs((x.close/prior[i].close-1)*100)));
 const jump=(last.close/c[n-4].close-1)*100,priorVolume=median(prior.map(x=>x.volume));
 const volumeRatio=priorVolume>0?tail.reduce((s,x)=>s+x.volume,0)/(priorVolume*3):null;
 const result={version:PATTERN_VERSION,type:'OBSERVING',detectedAt:new Date(now).toISOString(),lastClosedAt:new Date((last.time+60)*1000).toISOString(),calibrated:false,metrics:{return3mPct:jump,volumeRatio3m:volumeRatio}};
 if(jump>=Math.max(10,baseline*6)&&volumeRatio!==null&&volumeRatio>=2){result.type='VERTICAL';return result;}
 const lows=[],highs=[];
 for(let i=2;i<n-2;i++){
  if(c[i].low<Math.min(c[i-2].low,c[i-1].low)&&c[i].low<=Math.min(c[i+1].low,c[i+2].low))lows.push(c[i]);
  if(c[i].high>Math.max(c[i-2].high,c[i-1].high)&&c[i].high>=Math.max(c[i+1].high,c[i+2].high))highs.push(c[i]);
 }
 const rising=a=>a.length>=3&&a.slice(-3).every((x,i,arr)=>!i||x>arr[i-1]*1.002);
 if(rising(lows.map(x=>x.low))&&rising(highs.map(x=>x.high))&&last.close>lows.at(-1).low&&(last.close/c[0].close-1)*100>=3){result.type='STAIRCASE';result.metrics.confirmedHigherLows=3;result.metrics.confirmedHigherHighs=3;return result;}
 const rest=c.slice(-5),range=(Math.max(...rest.map(x=>x.high))/Math.min(...rest.map(x=>x.low))-1)*100;
 const earlierGain=(c[n-6].close/c[0].close-1)*100;
 if(earlierGain>=5&&range<=Math.max(2,baseline*3)&&priorVolume>0&&rest.reduce((s,x)=>s+x.volume,0)/5<=priorVolume*1.2)result.type='CONSOLIDATION';
 return result;
}
