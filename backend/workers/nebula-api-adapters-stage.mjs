import {updateMeasuredAnalytics,readMeasuredAnalytics} from './evaluation-metrics.mjs';
import {handleScheduled} from './nebula-evaluation.mjs';
import {providerJSON} from './provider-runtime.mjs';
import {providerRoute,rpcFallback} from './provider-routes.mjs';
import {marketPairs} from './market-sources.mjs';
import {providerHealth} from './provider-health.mjs';
// =====================================================
// NEBULA API WORKER V109.1 — "Production Polish"
// =====================================================
// Deploy sebagai single bundle Cloudflare Worker
// Environment variables: API_KEY, HELIUS_API_KEY
// Binding: DB (D1 Database)
// Cron Trigger: */30 * * * *

const VERSION = 'V109.3';
function bestSolPrice(data, ca) {
  const pairs = (data?.pairs || []).filter(p => p.chainId === 'solana' && p.baseToken?.address === ca);
  pairs.sort((a,b) => (Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));
  const v = Number(pairs[0]?.priceUsd);
  return Number.isFinite(v) && v>0 ? v : 0;
}

const BUILD = '2026-07-28';
const API = '/api/v1';
const MAX_PAYLOAD = 256 * 1024;

// ==================== CONFIG ====================
const ALLOWED_ORIGINS = [
  'https://nebulacryptohunter.nebula-crypto-proxy.workers.dev',
  'https://nebula-api.nebula-crypto-proxy.workers.dev',
  'http://localhost:3000', 'http://localhost:5500', 'http://localhost:8080'
];
const ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];
const ALLOWED_RPC = new Set(['getAccountInfo','getTokenLargestAccounts','getSignaturesForAddress','getProgramAccounts','getTokenSupply','getBalance','getMultipleAccounts']);
const AUTH_REQUIRED = [`${API}/predictions`,`${API}/evaluations`,`${API}/heroes`,`${API}/watchlist`,`${API}/learning`,`${API}/market-regime`];
const DECISION = ['STRONG_BUY','BUY','ACCUMULATE','WATCH','WAIT','AVOID'];

const CFG = {
  TIMEOUT: 10000, MAX_RETRY: 3, CACHE_TTL: 60,
  CB_TIMEOUT: 30000, RATE_WINDOW: 60, RATE_MAX: 5000,
  MIN_SAMPLES_FOR_LEARNING: 50,
  LEARNING_RATE_BASE: 0.02,
  CONFIDENCE_FLOOR: 0.3,
  CONFIDENCE_CEIL: 0.9,
  DECAY_HALF_LIFE_DAYS: 30,
  CRON_BATCH_SIZE: 25,
  CRON_MAX_CONCURRENT: 10,
  EVALUATION_WINDOWS: [
    { key: '30m', ms: 30*60*1000 },
    { key: '2h', ms: 2*60*60*1000 },
    { key: '6h', ms: 6*60*60*1000 },
    { key: '24h', ms: 24*60*60*1000 },
    { key: '3d', ms: 3*24*60*60*1000 },
    { key: '7d', ms: 7*24*60*60*1000 }
  ],
  FEATURES: ['liq','vol','age','holder','wallet','momentum','security'],
  PRICE_RETRY_MAX: 2,
  PRICE_RETRY_BACKOFF: 500,
  RPC_TIMEOUT: 10000,
  PROXY_TIMEOUT: 5000,
  DEX_CACHE_TTL: 60000
};

// ==================== UTILITIES ====================
function UUID() { return crypto.randomUUID(); }
function clamp(v,min,max) { return Math.min(max, Math.max(min, v)); }
function safeDivide(a,b,fallback=0) { if (!b || !a) return fallback; return a/b; }
function currentTimestamp() { return new Date().toISOString(); }

// ==================== SECURITY ====================
function corsHdr(origin) {
  const ao = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': ao,
    'Vary':'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
    'X-Worker-Version': VERSION,
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000'
  };
}
function ok(d) { return { success:true, data:d, version:VERSION, timestamp:currentTimestamp() }; }
function err(m,c='ERROR') { return { success:false, error:{code:c,message:m}, version:VERSION, timestamp:currentTimestamp() }; }
function isAuth(req,env) {
  const a=req.headers.get('Authorization');
  const k=req.headers.get('X-API-Key');
  const t=a?.startsWith('Bearer ')?a.slice(7):k;
  return typeof env.API_KEY==='string' && env.API_KEY.length>0 && typeof t==='string' && t.length>0 && t===env.API_KEY;
}
function vCA(ca) { return typeof ca==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca); }
function enforcePredictionV2(b) { if(!b||typeof b!=='object'||Array.isArray(b))return {token_ca:'',decision:'WATCH',passed_gate:0}; const o={...b}; const buy=o.decision==='BUY'||o.decision==='STRONG_BUY'; const price=typeof o.entry_price==='number'&&Number.isFinite(o.entry_price)&&o.entry_price>0; const verified=o.dex_verified===true&&o.helius_verified===true&&o.rug_verified===true&&o.rug_status==='SAFE'&&Number.isInteger(o.holder_count)&&o.holder_count>0&&typeof o.liquidity_usd==='number'&&Number.isFinite(o.liquidity_usd)&&o.liquidity_usd>=1000&&o.mint_authority_enabled===false&&o.freeze_authority_enabled===false; if(buy&&(!(o.passed_gate===1||o.passed_gate===true)||!price||!verified)){o.decision='WATCH';o.passed_gate=0;o.predicted_multiplier=0;}return o; }
function vDec(d) { return DECISION.includes(d); }

// ==================== LOGGING ====================
async function logSystem(db, level, source, message, runId='') {
  try {
    const msg = runId ? `[${runId}] ${message.substring(0, 400)}` : message.substring(0, 400);
    await db.prepare(`INSERT INTO system_log (log_level, log_source, log_message) VALUES (?,?,?)`)
      .bind(level, source, msg).run();
  } catch(e){}
}

// ==================== CACHE (hanya untuk /config) ====================
async function getCached(key) { try { const r=await caches.default.match(key); return r||null; } catch(e){ return null; } }
async function setCached(key,data) { try { const r=new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}); await caches.default.put(key,r); } catch(e){} }
function ck(path) { return `https://cache.local/${VERSION}${path}`; }

async function updateAnalyticsStats(db){return updateMeasuredAnalytics(db);}

// ==================== SAFE PROXY FETCH (V109.1 – perbaikan logging status) ====================
async function safeProxyFetch(url,serviceName,db,rid,useCache=false){
 const provider={DEX:'dexscreener',RUGCHECK:'rugcheck',PUMPFUN:'pumpfun'}[serviceName]||serviceName.toLowerCase();
 const r=await providerJSON(provider,url,{}, {ttl:provider==='rugcheck'?300:60});
 if(r.ok)return {ok:true,status:200,data:r.data};
 if(serviceName==='DEX'){
  const mint=url.split('/tokens/')[1];
  if(vCA(mint)){const m=await marketPairs([mint],{dexPaused:true});if(m.pairs.length)return {ok:true,status:200,data:{pairs:m.pairs,source:'geckoterminal'}};}
 }
 return {ok:false,status:r.status===429?429:502,error:r.error};
}

function classifyRpcError(status, isTimeout, isNetworkError) {
  if (isTimeout) return 'HELIUS_TIMEOUT';
  if (isNetworkError) return 'HELIUS_NETWORK';
  if (status === 0) return 'HELIUS_NETWORK';
  if (status === 400) return 'HELIUS_400';
  if (status === 401) return 'HELIUS_401';
  if (status === 403) return 'HELIUS_403';
  if (status === 404) return 'HELIUS_404';
  if (status === 429) return 'HELIUS_429';
  if (status === 500) return 'HELIUS_500';
  if (status === 503) return 'HELIUS_503';
  return 'HELIUS_NETWORK';
}

async function rpcFetch(url, body, env, db, rid) {
  if (!env.HELIUS_API_KEY) {
    return { ok: false, status: 0, data: null, errorCode: 'CONFIG_ERROR', errorMsg: 'HELIUS_API_KEY missing' };
  }

  let isTimeout = false;
  let status = 0;
  let rawBody = '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => { isTimeout = true; controller.abort(); }, CFG.RPC_TIMEOUT);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    status = res.status;
    rawBody = await res.text();

    if (status !== 200) {
      await logSystem(db, 'ERROR', 'rpc', `HELIUS ${status}: ${rawBody.substring(0, 300)}`, rid);
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch(e) {
      data = { raw: rawBody };
      await logSystem(db, 'ERROR', 'rpc', `Helius response not JSON: ${rawBody.substring(0, 200)}`, rid);
    }

    if (res.ok) {
      return { ok: true, status, data };
    } else {
      return {
        ok: false, status, data,
        errorCode: classifyRpcError(status, false, false),
        errorMsg: `Helius returned ${status}: ${rawBody.substring(0, 200)}`
      };
    }
  } catch(e) {
    await logSystem(db, 'ERROR', 'rpc', `Helius fetch error: ${e.message}`, rid);
    return {
      ok: false, status: 0, data: null,
      errorCode: classifyRpcError(0, isTimeout, true),
      errorMsg: e.message
    };
  }
}

// ==================== MAIN WORKER ====================
export default {
  async fetch(request, env, ctx) {
    const rid = UUID();
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    const origin = request.headers.get('Origin');
    const h = corsHdr(origin);
    const db = env.DB;

    if(!ALLOWED_METHODS.includes(method)) return new Response(JSON.stringify(err('Method not allowed','METHOD')),{status:405,headers:h});
    if(origin&&!ALLOWED_ORIGINS.includes(origin)&&!path.startsWith('/helius')&&!path.startsWith('/dex')&&!path.startsWith('/rugcheck')&&!path.startsWith('/pumpfun')) return new Response(JSON.stringify(err('Origin not allowed','ORIGIN')),{status:403,headers:h});
    if(method==='OPTIONS') return new Response(null,{status:204,headers:h});
    if(method==='POST') {
      if(!(request.headers.get('Content-Type')||'').includes('application/json')) return new Response(JSON.stringify(err('Content-Type must be application/json','CONTENT_TYPE')),{status:415,headers:h});
      if(parseInt(request.headers.get('Content-Length')||'0')>MAX_PAYLOAD) return new Response(JSON.stringify(err('Payload too large','PAYLOAD')),{status:413,headers:h});
    }

    if(method==='POST') {
      const reader=request.body?.getReader();let size=0;const chunks=[];
      if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_PAYLOAD){await reader.cancel();return new Response(JSON.stringify(err('Payload too large','PAYLOAD')),{status:413,headers:h});}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      try{const parsed=JSON.parse(new TextDecoder().decode(bytes));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();}catch{return new Response(JSON.stringify(err('Invalid JSON object','VALIDATION')),{status:400,headers:h});}
      request=new Request(request.url,{method,headers:request.headers,body:bytes});
    }
    try {
      if(path==='/provider-health'&&method==='GET')return providerHealth(request,env,'staging');
      if(path==='/health') {
        const dbOk = await db.prepare(`SELECT 1`).first();
        return new Response(JSON.stringify({status:dbOk?'healthy':'degraded',version:VERSION,build:BUILD,db:dbOk?'connected':'error'}),{headers:{...h,'Cache-Control':'no-store'}});
      }

      if(AUTH_REQUIRED.some(p=>path===p||path.startsWith(p+'/'))&&method==='POST'&&!isAuth(request,env)) return new Response(JSON.stringify(err('Unauthorized','AUTH')),{status:401,headers:h});

      // ==================== PREDICTIONS ====================
      if(path===`${API}/predictions`&&method==='POST') {
        const b = enforcePredictionV2(await request.json());
        // SERVER_GATE_V3_FAIL_CLOSED: never trust client-supplied BUY verification
        if(b.decision==='BUY'||b.decision==='STRONG_BUY'){b.decision='WATCH';b.passed_gate=0;b.predicted_multiplier=0;}
        if(!vCA(b.token_ca)) return new Response(JSON.stringify(err('Invalid token_ca','VALIDATION')),{status:400,headers:h});
        if(!vDec(b.decision)) return new Response(JSON.stringify(err('Invalid decision','VALIDATION')),{status:400,headers:h});
        const r = await db.prepare(`INSERT INTO predictions (token_ca,token_name,token_symbol,decision,confidence,entry_price,predicted_multiplier,ai_score,quality,opportunity,market_regime,risk_index,passed_gate,learning_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`)
          .bind(b.token_ca,b.token_name||'',b.token_symbol||'',b.decision,b.confidence||0,b.entry_price||0,b.predicted_multiplier||0,b.ai_score||0,b.quality||0,b.opportunity||0,b.market_regime||'SIDEWAY',b.risk_index||0,b.passed_gate||0).run();
        await updateAnalyticsStats(db, rid);
        return new Response(JSON.stringify(ok({id:r.meta.last_row_id})),{headers:h});
      }

      if(path===`${API}/predictions/bulk`&&method==='POST') {
        const { predictions } = await request.json();
        if(!Array.isArray(predictions)||predictions.length===0||predictions.length>100) return new Response(JSON.stringify(err('Array of 1 to 100 predictions required','VALIDATION')),{status:400,headers:h});
        const batch = [];
        for(const item of predictions) {
          const p=enforcePredictionV2(item);
          if(p.decision==='BUY'||p.decision==='STRONG_BUY'){p.decision='WATCH';p.passed_gate=0;p.predicted_multiplier=0;}
          if(!vCA(p.token_ca)||!vDec(p.decision)) return new Response(JSON.stringify(err('Invalid prediction item','VALIDATION')),{status:400,headers:h});
          batch.push(db.prepare(`INSERT INTO predictions (token_ca,token_name,token_symbol,decision,confidence,entry_price,predicted_multiplier,ai_score,quality,opportunity,market_regime,risk_index,passed_gate,learning_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING')`)
            .bind(p.token_ca,p.token_name||'',p.token_symbol||'',p.decision,p.confidence||0,p.entry_price||0,p.predicted_multiplier||0,p.ai_score||0,p.quality||0,p.opportunity||0,p.market_regime||'SIDEWAY',p.risk_index||0,p.passed_gate||0));
        }
        await db.batch(batch);
        await updateAnalyticsStats(db, rid);
        return new Response(JSON.stringify(ok({inserted:predictions.length})),{headers:h});
      }

      if(path===`${API}/predictions`&&method==='GET') {
        const lm = Math.max(1,Math.min(parseInt(url.searchParams.get('limit'))||100,500));
        const of = Math.max(0,parseInt(url.searchParams.get('offset'))||0);
        const {results} = await db.prepare(`SELECT * FROM predictions ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(lm,of).all();
        return new Response(JSON.stringify(ok({predictions:results,limit:lm,offset:of})),{headers:h});
      }

      // ==================== EVALUATIONS ====================
      if(path===`${API}/evaluations`&&method==='POST') {
        const b = await request.json();
        if(!b.prediction_id||!b.token_ca) return new Response(JSON.stringify(err('prediction_id and token_ca required','VALIDATION')),{status:400,headers:h});
        await db.batch([
          db.prepare(`INSERT INTO evaluations (prediction_id,token_ca,directional_score,multiplier_score,timing_score,risk_score,opportunity_cost_score,sustainability_score,confidence_calibration_score,success_score,actual_roi,actual_multiplier,max_drawdown,time_to_ath,sustained_hours,evaluation_confidence,market_regime,evaluation_window,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(b.prediction_id,b.token_ca,b.directional_score||0,b.multiplier_score||0,b.timing_score||0,b.risk_score||0,b.opportunity_cost_score||0,b.sustainability_score||0,b.confidence_calibration_score||0,b.success_score||0,b.actual_roi||0,b.actual_multiplier||0,b.max_drawdown||0,b.time_to_ath||0,b.sustained_hours||0,b.evaluation_confidence||100,b.market_regime||'SIDEWAY',b.evaluation_window||'7d',b.notes||''),
          db.prepare(`UPDATE predictions SET learning_status='EVALUATED',success_score=?,evaluated_at=datetime('now') WHERE id=?`).bind(b.success_score||0,b.prediction_id)
        ]);
        await updateAnalyticsStats(db, rid);
        return new Response(JSON.stringify(ok({status:'evaluated'})),{headers:h});
      }

      if(path===`${API}/evaluations/bulk`&&method==='POST') {
        const { evaluations } = await request.json();
        if(!Array.isArray(evaluations)||evaluations.length===0||evaluations.length>100) return new Response(JSON.stringify(err('Array of 1 to 100 evaluations required','VALIDATION')),{status:400,headers:h});
        const batch = []; const updateBatch = [];
        for(const e of evaluations) {
          if(!e.prediction_id||!e.token_ca) return new Response(JSON.stringify(err('prediction_id and token_ca required','VALIDATION')),{status:400,headers:h});
          batch.push(db.prepare(`INSERT INTO evaluations (prediction_id,token_ca,directional_score,multiplier_score,timing_score,risk_score,opportunity_cost_score,sustainability_score,confidence_calibration_score,success_score,actual_roi,actual_multiplier,max_drawdown,time_to_ath,sustained_hours,evaluation_confidence,market_regime,evaluation_window,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(e.prediction_id,e.token_ca,e.directional_score||0,e.multiplier_score||0,e.timing_score||0,e.risk_score||0,e.opportunity_cost_score||0,e.sustainability_score||0,e.confidence_calibration_score||0,e.success_score||0,e.actual_roi||0,e.actual_multiplier||0,e.max_drawdown||0,e.time_to_ath||0,e.sustained_hours||0,e.evaluation_confidence||100,e.market_regime||'SIDEWAY',e.evaluation_window||'7d',e.notes||''));
          updateBatch.push(db.prepare(`UPDATE predictions SET learning_status='EVALUATED',success_score=?,evaluated_at=datetime('now') WHERE id=?`).bind(e.success_score||0,e.prediction_id));
        }
        await db.batch([...batch, ...updateBatch]);
        await updateAnalyticsStats(db, rid);
        return new Response(JSON.stringify(ok({inserted:evaluations.length})),{headers:h});
      }

      if(path===`${API}/evaluations`&&method==='GET') {
        const lm = Math.max(1,Math.min(parseInt(url.searchParams.get('limit'))||100,500));
        const {results} = await db.prepare(`SELECT * FROM evaluations ORDER BY evaluated_at DESC LIMIT ?`).bind(lm).all();
        return new Response(JSON.stringify(ok({evaluations:results})),{headers:h});
      }

      // ==================== STATS (REAL-TIME, NO CACHE) ====================
      if(path===`${API}/stats`) {
        const metrics=await readMeasuredAnalytics(db),percent=x=>x===null?null:Math.round(x*10000)/100;
        return new Response(JSON.stringify(ok({total_predictions:metrics.totalPredictions,total_evaluations:metrics.totalEvaluations,overall_precision:percent(metrics.precision),overall_recall:percent(metrics.recall),overall_f1:percent(metrics.f1),overall_win_rate:percent(metrics.precision),overall_avg_roi:metrics.avgBuyRoi,measurement:'POSITIVE_SPOT_RETURN_30M',isTradePnL:false,modelCalibrated:false,measured_samples:metrics.samples,population:metrics.population})),{headers:{...h,'Cache-Control':'no-store'}});
      }

      // ==================== HEROES (REAL-TIME, NO CACHE) ====================
      if(path===`${API}/heroes`) {
        if(method==='GET') {
          const {results} = await db.prepare(`SELECT * FROM heroes WHERE active=1 ORDER BY promoted_at DESC LIMIT 1`).all();
          return new Response(JSON.stringify(ok(results[0]||null)),{headers:{...h,'Cache-Control':'no-store'}});
        }
        if(method==='POST') {
          const b = await request.json();
          const rs = await db.batch([
            db.prepare(`UPDATE heroes SET active=0 WHERE active=1`),
            db.prepare(`INSERT INTO heroes (token_ca,token_name,ai_score,multiplier,confidence,risk_index) VALUES (?,?,?,?,?,?)`).bind(b.token_ca,b.token_name||'',b.ai_score||0,b.multiplier||0,b.confidence||0,b.risk_index||0)
          ]);
          await db.prepare(`INSERT INTO hero_history (hero_id,token_ca,ai_score) VALUES (?,?,?)`).bind(rs[1].meta.last_row_id,b.token_ca,b.ai_score||0).run();
          return new Response(JSON.stringify(ok({id:rs[1].meta.last_row_id})),{headers:{...h,'Cache-Control':'no-store'}});
        }
      }

      // ==================== WATCHLIST ====================
      if(path===`${API}/watchlist`) {
        if(method==='GET') { const {results}=await db.prepare(`SELECT * FROM watchlist ORDER BY updated_at DESC`).all(); return new Response(JSON.stringify(ok({watchlist:results})),{headers:h}); }
        if(method==='POST') { const b=await request.json(); await db.prepare(`INSERT OR REPLACE INTO watchlist (token_ca,token_name,token_symbol,last_ai_score,last_decision,updated_at) VALUES (?,?,?,?,?,datetime('now'))`).bind(b.token_ca,b.token_name||'',b.token_symbol||'',b.last_ai_score||0,b.last_decision||'WATCH').run(); return new Response(JSON.stringify(ok({status:'added'})),{headers:h}); }
      }

      // ==================== LEARNING ====================
      if(path===`${API}/learning`) {
        if(method==='GET') { const {results}=await db.prepare(`SELECT * FROM learning_weights ORDER BY feature_name`).all(); return new Response(JSON.stringify(ok({weights:results})),{headers:h}); }
        if(method==='POST') { const b=await request.json(); if(!b.feature_name) return new Response(JSON.stringify(err('feature_name required','VALIDATION')),{status:400,headers:h}); await db.batch([db.prepare(`UPDATE learning_weights SET weight_value=?,sample_count=?,success_count=?,success_rate=?,last_updated_at=datetime('now') WHERE feature_name=?`).bind(b.weight_value||0,b.sample_count||0,b.success_count||0,b.success_rate||0,b.feature_name),db.prepare(`INSERT INTO learning_history (feature_name,old_weight,new_weight,change_reason,sample_size,success_rate) VALUES (?,?,?,?,?,?)`).bind(b.feature_name,b.old_weight||0,b.weight_value||0,b.change_reason||'',b.sample_count||0,b.success_rate||0)]); return new Response(JSON.stringify(ok({status:'updated'})),{headers:h}); }
      }

      // ==================== CONFIG (CACHE OK) ====================
      if(path===`${API}/config`) {
        const c = ck('/config'); const cached = await getCached(c);
        if(cached) return new Response(await cached.text(),{headers:{...h,'X-Cache':'HIT'}});
        const {results} = await db.prepare(`SELECT * FROM config ORDER BY config_key`).all();
        const d = ok({config:results});
        ctx.waitUntil(setCached(c,d));
        return new Response(JSON.stringify(d),{headers:{...h,'X-Cache':'MISS'}});
      }

      // ==================== MARKET REGIME ====================
      if(path===`${API}/market-regime`&&method==='POST') { const b=await request.json(); await db.prepare(`INSERT INTO market_regimes (regime,heat,season) VALUES (?,?,?)`).bind(b.regime||'SIDEWAY',b.heat||50,b.season||'').run(); return new Response(JSON.stringify(ok({status:'recorded'})),{headers:h}); }

      // ==================== LOGS ====================
      if(path===`${API}/logs`) { const lm=Math.min(parseInt(url.searchParams.get('limit'))||50,200); const {results}=await db.prepare(`SELECT * FROM system_log ORDER BY created_at DESC LIMIT ?`).bind(lm).all(); return new Response(JSON.stringify(ok({logs:results})),{headers:h}); }

      if(method==='GET'){const response=await providerRoute(path,env);if(response){const out=new Response(response.body,response);for(const [key,value] of Object.entries(h))out.headers.set(key,value);return out;}}
      // ==================== PROXY ====================
      // Helius RPC
      if(path==='/helius/rpc'&&method==='POST') {
        let body;
        try { body = await request.json(); } catch(e) { return new Response(JSON.stringify(err('Invalid JSON','PARSE')),{status:400,headers:h}); }
        if(!body?.jsonrpc||!body.method||!body.params) return new Response(JSON.stringify(err('Invalid JSON-RPC','VALIDATION')),{status:400,headers:h});
        if(!ALLOWED_RPC.has(body.method)) return new Response(JSON.stringify(err(`Method ${body.method} not allowed`,'VALIDATION')),{status:400,headers:h});

        const r=await rpcFallback(body,env);
        if(!r.ok)return new Response(JSON.stringify(err('All configured RPC sources are unavailable','RPC_SOURCES_UNAVAILABLE')),{status:503,headers:h});
        return new Response(JSON.stringify(r.data),{headers:{...h,'Cache-Control':'no-store','X-NEBULA-Provider':r.provider}});
      }

      // DEX with caching and retry for rate limit
      if(path.startsWith('/dex/')) {
        const tk = path.split('/dex/')[1];
        if (!tk) return new Response(JSON.stringify(err('Token required','VALIDATION')),{status:400,headers:h});
        const result = await safeProxyFetch(`https://api.dexscreener.com/latest/dex/tokens/${tk}`, 'DEX', db, rid, true);
        if (!result.ok) {
          return new Response(JSON.stringify(err(result.error||'DEX proxy failed','PROXY_ERROR')),{status:result.status,headers:h});
        }
        return new Response(JSON.stringify(result.data||{}),{headers:{...h,'Cache-Control':'public, max-age=30'}});
      }

      // Rugcheck
      if(path.startsWith('/rugcheck/')) {
        const tk = path.split('/rugcheck/')[1];
        if (!tk) return new Response(JSON.stringify(err('Token required','VALIDATION')),{status:400,headers:h});
        const result = await safeProxyFetch(`https://api.rugcheck.xyz/v1/tokens/${tk}/report`, 'RUGCHECK', db, rid, false);
        if (!result.ok) {
          return new Response(JSON.stringify(err(result.error||'Rugcheck proxy failed','PROXY_ERROR')),{status:result.status,headers:h});
        }
        return new Response(JSON.stringify(result.data||{}),{headers:{...h,'Cache-Control':'public, max-age=300'}});
      }

      // Pumpfun
      if(path==='/pumpfun/coins') {
        const result = await safeProxyFetch(`https://frontend-api-v3.pump.fun/coins${url.search}`, 'PUMPFUN', db, rid, false);
        if (!result.ok) {
          return new Response(JSON.stringify(err(result.error||'Pumpfun proxy failed','PROXY_ERROR')),{status:result.status,headers:h});
        }
        return new Response(JSON.stringify(result.data),{headers:{...h,'Cache-Control':'public, max-age=30'}});
      }

      return new Response(JSON.stringify(err('Not found','NOT_FOUND')),{status:404,headers:h});
    } catch(e) {
      await logSystem(db, 'ERROR', 'worker', e.message, rid);
      return new Response(JSON.stringify(err('Internal error','INTERNAL')),{status:500,headers:h});
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env, ctx));
  }
};
