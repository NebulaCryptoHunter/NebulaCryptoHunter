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

// ==================== DEX CACHE (in-memory, TTL 60s) ====================
const dexCache = new Map();

function getCachedDex(tokenCA) {
  const entry = dexCache.get(tokenCA);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CFG.DEX_CACHE_TTL) {
    dexCache.delete(tokenCA);
    return null;
  }
  return entry.data;
}

function setCachedDex(tokenCA, data) {
  dexCache.set(tokenCA, { data, timestamp: Date.now() });
}

// ==================== PRICE SERVICE ====================
async function getTokenPrice(ca) {
  const cached = getCachedDex(ca);
  if (cached && cached.pairs && cached.pairs.length > 0) {
    const price = bestSolPrice(cached, ca);
    if (price > 0) return price;
  }

  for (let attempt = 0; attempt <= CFG.PRICE_RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const text = await res.text();
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = JSON.parse(text);
          setCachedDex(ca, data);
          if (data.pairs && data.pairs.length > 0) {
            const price = bestSolPrice(data, ca);
            if (price > 0) return price;
          }
        }
      }
    } catch(e) {}
    if (attempt < CFG.PRICE_RETRY_MAX) {
      await new Promise(r => setTimeout(r, CFG.PRICE_RETRY_BACKOFF * (attempt + 1)));
    }
  }
  return null;
}

// ==================== EVALUATION SERVICE ====================
async function evaluatePrediction(db, prediction, windowKey, runId) {
  const { id, token_ca, entry_price, predicted_multiplier, decision } = prediction;
  if (!entry_price || entry_price <= 0) return null;

  const currentPrice = await getTokenPrice(token_ca);
  if (currentPrice === null) return null;

  const roi = ((currentPrice - entry_price) / entry_price) * 100;
  const actualMultiplier = currentPrice / entry_price;

  let directionalScore = 50;
  if (decision === 'STRONG_BUY' || decision === 'BUY') {
    if (roi > 0) directionalScore = 100;
    else if (roi > -5) directionalScore = 70;
    else directionalScore = 30;
  } else if (decision === 'AVOID') {
    if (roi < 0) directionalScore = 100;
    else if (roi < 5) directionalScore = 70;
    else directionalScore = 30;
  }

  let multiplierScore = 0;
  if (predicted_multiplier && predicted_multiplier > 0 && actualMultiplier > 0) {
    const error = Math.abs(predicted_multiplier - actualMultiplier) / Math.max(predicted_multiplier, actualMultiplier);
    multiplierScore = Math.round(clamp((1 - error) * 100, 0, 100));
  } else {
    multiplierScore = 50;
  }

  const successScore = Math.round((directionalScore * 0.5) + (multiplierScore * 0.5));

  const existing = await db.prepare(`SELECT id FROM evaluations WHERE prediction_id=? AND evaluation_window=?`)
    .bind(id, windowKey).first();
  if (existing) return null;

  await db.prepare(`INSERT INTO evaluations (prediction_id, token_ca, directional_score, multiplier_score, timing_score, risk_score, opportunity_cost_score, sustainability_score, confidence_calibration_score, success_score, actual_roi, actual_multiplier, max_drawdown, time_to_ath, sustained_hours, evaluation_confidence, market_regime, evaluation_window, engine_version, notes, evaluated_at)
    VALUES (?,?,?,?,0,0,0,0,0,?,?,?,0,0,0,100,?,?,?,?,datetime('now'))`)
    .bind(id, token_ca, directionalScore, multiplierScore, successScore, roi, actualMultiplier, prediction.market_regime||'SIDEWAY', windowKey, VERSION, '').run();

  await db.prepare(`UPDATE predictions SET learning_status='EVALUATED', success_score=?, actual_multiplier=?, evaluated_at=datetime('now') WHERE id=?`)
    .bind(successScore, actualMultiplier, id).run();

  return { id, roi, actualMultiplier, predictedMultiplier: predicted_multiplier||0, successScore, directionalScore, multiplierScore, decision, confidence: prediction.confidence||50 };
}

// ==================== LEARNING SERVICE ====================
async function updateLearningWeights(db, runId) {
  const features = CFG.FEATURES;
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const { results: evaluations } = await db.prepare(`
    SELECT e.*, p.decision, p.confidence, p.predicted_multiplier, p.created_at as pred_created_at
    FROM evaluations e JOIN predictions p ON e.prediction_id = p.id
  `).all();

  if (!evaluations || evaluations.length < CFG.MIN_SAMPLES_FOR_LEARNING) return;

  for (const feat of features) {
    const { results: contributions } = await db.prepare(`
      SELECT fc.*, e.success_score, e.actual_multiplier, e.predicted_multiplier,
             p.confidence, p.decision, p.created_at as pred_created_at
      FROM feature_contributions fc
      JOIN evaluations e ON fc.prediction_id = e.prediction_id
      JOIN predictions p ON e.prediction_id = p.id
      WHERE fc.feature_name = ?
    `).bind(feat).all();

    if (!contributions || contributions.length < CFG.MIN_SAMPLES_FOR_LEARNING) continue;

    const sampleCount = contributions.length;
    let totalErrorWeight = 0;
    let successCount = 0;

    for (const c of contributions) {
      const confidence = c.confidence || 50;
      const predictedMultiplier = c.predicted_multiplier || 1;
      const actualMultiplier = c.actual_multiplier || 1;

      const maxVal = Math.max(predictedMultiplier, actualMultiplier);
      const predictionError = maxVal > 0 ? Math.abs(predictedMultiplier - actualMultiplier) / maxVal : 0;

      let confidenceFactor = clamp(confidence / 100, CFG.CONFIDENCE_FLOOR, CFG.CONFIDENCE_CEIL);
      const normalizedConf = (confidenceFactor - CFG.CONFIDENCE_FLOOR) / (CFG.CONFIDENCE_CEIL - CFG.CONFIDENCE_FLOOR);
      confidenceFactor = CFG.CONFIDENCE_FLOOR + Math.pow(normalizedConf, 1.5) * (CFG.CONFIDENCE_CEIL - CFG.CONFIDENCE_FLOOR);

      let sampleModifier = 0.3;
      if (sampleCount >= 1000) sampleModifier = 1.0;
      else if (sampleCount >= 200) sampleModifier = 0.7;
      else if (sampleCount >= 50) sampleModifier = 0.5;

      const predAgeDays = (now - new Date(c.pred_created_at).getTime()) / dayMs;
      const decayFactor = Math.exp(-Math.log(2) * predAgeDays / CFG.DECAY_HALF_LIFE_DAYS);

      const direction = actualMultiplier > predictedMultiplier ? 1 : -1;
      const errorWeight = predictionError * confidenceFactor * sampleModifier * decayFactor;
      totalErrorWeight += errorWeight * direction;
      if (c.success_score >= 60) successCount++;
    }

    const avgErrorWeight = totalErrorWeight / sampleCount;
    const successRate = successCount / sampleCount;

    const current = await db.prepare(`SELECT * FROM learning_weights WHERE feature_name=?`).bind(feat).first();
    const oldWeight = current?.weight_value || 0.1;
    const changeAmount = CFG.LEARNING_RATE_BASE * avgErrorWeight;
    let newWeight = clamp(oldWeight + changeAmount, 0.01, 0.5);

    await db.prepare(`UPDATE learning_weights SET weight_value=?, sample_count=?, success_count=?, success_rate=?, last_updated_at=datetime('now') WHERE feature_name=?`)
      .bind(newWeight, sampleCount, successCount, Math.round(successRate*100), feat).run();
    await db.prepare(`INSERT INTO learning_history (feature_name, old_weight, new_weight, change_reason, sample_size, success_rate, engine_version, created_at)
      VALUES (?,?,?,?,?,?,?,datetime('now'))`)
      .bind(feat, oldWeight, newWeight, 'refined-learning', sampleCount, Math.round(successRate*100), VERSION).run();
  }
}

// ==================== ANALYTICS SERVICE ====================
async function updateAnalyticsStats(db, runId) {
  try {
    const [tp,te,bw,tb,ar] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as c FROM predictions`).first(),
      db.prepare(`SELECT COUNT(*) as c FROM evaluations`).first(),
      db.prepare(`SELECT COUNT(*) as c FROM evaluations e JOIN predictions p ON e.prediction_id=p.id WHERE p.decision IN ('BUY','STRONG_BUY') AND e.success_score>=60`).first(),
      db.prepare(`SELECT COUNT(*) as c FROM predictions WHERE decision IN ('BUY','STRONG_BUY')`).first(),
      db.prepare(`SELECT AVG(actual_roi) as avg FROM evaluations`).first()
    ]);

    const totalPreds = tp?.c || 0;
    const totalEvals = te?.c || 0;
    const wins = bw?.c || 0;
    const buyPreds = tb?.c || 0;
    const avgROI = Math.round(ar?.avg || 0);

    const precision = buyPreds > 0 ? wins / buyPreds : 0;
    const recall = totalEvals > 0 ? wins / totalEvals : 0;
    const f1 = (precision + recall) > 0 ? 2*(precision*recall)/(precision+recall) : 0;
    const winRate = totalPreds > 0 ? wins / totalPreds : 0;

    await db.prepare(`UPDATE ai_stats SET total_predictions=?, total_evaluations=?, overall_win_rate=?, overall_avg_roi=?, overall_precision=?, overall_recall=?, overall_f1=?, updated_at=datetime('now') WHERE id=1`)
      .bind(totalPreds, totalEvals, Math.round(winRate*100), avgROI, Math.round(precision*100), Math.round(recall*100), Math.round(f1*100)).run();

    await logSystem(db, 'INFO', 'analytics', `Stats updated: Predictions ${totalPreds}, F1 ${Math.round(f1*100)}%, ROI ${avgROI}%`, runId);
  } catch(e) {
    await logSystem(db, 'ERROR', 'analytics', `Failed to update stats: ${e.message}`, runId);
    throw e;
  }
}

// ==================== CRON HANDLER ====================
async function handleScheduled(env, ctx) {
  const db = env.DB;
  const runId = UUID();
  const startTime = Date.now();
  const now = Date.now();
  let totalEvaluated = 0;
  let errors = 0;

  for (const window of CFG.EVALUATION_WINDOWS) {
    const threshold = new Date(now - window.ms).toISOString();
    const { results } = await db.prepare(
      `SELECT * FROM predictions WHERE learning_status='PENDING' AND created_at <= ?`
    ).bind(threshold).all();

    if (!results || results.length === 0) continue;

    for (let i = 0; i < results.length; i += CFG.CRON_MAX_CONCURRENT) {
      const batch = results.slice(i, i + CFG.CRON_MAX_CONCURRENT);
      const promises = batch.map(pred =>
        evaluatePrediction(db, pred, window.key, runId)
          .then(result => { if (result) totalEvaluated++; })
          .catch(e => { errors++; logSystem(db, 'ERROR', 'cron', `Eval failed ${pred.id}: ${e.message}`, runId); })
      );
      await Promise.all(promises);
    }
  }

  try {
    await updateLearningWeights(db, runId);
    await updateAnalyticsStats(db, runId);
  } catch(e) {
    await logSystem(db, 'ERROR', 'cron', `Learning/analytics failed: ${e.message}`, runId);
  }

  const duration = Date.now() - startTime;
  return new Response(`Cron ${VERSION} done [${runId}]. Evaluated ${totalEvaluated}, errors ${errors}, duration ${duration}ms`);
}

// ==================== SAFE PROXY FETCH (V109.1 – perbaikan logging status) ====================
async function safeProxyFetch(url, serviceName, db, rid, useCache = false) {
  const startTime = Date.now();
  if (useCache && serviceName === 'DEX') {
    const tokenCA = url.split('/tokens/')[1]?.split('?')[0];
    if (tokenCA) {
      const cached = getCachedDex(tokenCA);
      if (cached) {
        await logSystem(db, 'INFO', 'proxy', `DEX CACHE HIT | TOKEN=${tokenCA}`, rid);
        return { ok: true, status: 200, data: cached };
      }
    }
  }

  let retries = 0;
  const maxRetries = 2;
  let lastError;

  while (retries <= maxRetries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CFG.PROXY_TIMEOUT);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      const status = res.status;
      const contentType = res.headers.get('content-type') || '';
      let text = '';
      try { text = await res.text(); } catch(e) { text = '[STREAM READ ERROR]'; }
      const duration = Date.now() - startTime;

      if (status === 429) {
        if (useCache && serviceName === 'DEX') {
          const tokenCA = url.split('/tokens/')[1]?.split('?')[0];
          if (tokenCA) {
            const entry = dexCache.get(tokenCA);
            if (entry) {
              await logSystem(db, 'WARNING', 'proxy', `DEX 429, using stale cache for ${tokenCA}`, rid);
              return { ok: true, status: 200, data: entry.data };
            }
          }
        }
        await new Promise(r => setTimeout(r, 2000 * (retries + 1)));
        retries++;
        continue;
      }

      if (!contentType.includes('application/json')) {
        await logSystem(db, 'ERROR', 'proxy',
          `${serviceName} NON JSON | URL=${url} | HTTP=${status} | TIME=${duration}ms | BODY=${text.substring(0, 500)}`, rid);
        return { ok: false, status: 502, upstreamStatus: status, data: null, error: `${serviceName} returned non-JSON (HTTP ${status})` };
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch(e) {
        await logSystem(db, 'ERROR', 'proxy',
          `${serviceName} JSON PARSE ERROR | URL=${url} | HTTP=${status} | TIME=${duration}ms | BODY=${text.substring(0, 500)}`, rid);
        return { ok: false, status: 502, upstreamStatus: status, data: null, error: `${serviceName} returned invalid JSON` };
      }

      // Logging yang diperbaiki: 4xx/5xx bukan "OK"
      if (status >= 400) {
        await logSystem(db, 'ERROR', 'proxy',
          `${serviceName} HTTP ${status} | URL=${url} | TIME=${duration}ms | BODY=${text.substring(0, 300)}`, rid);
        if (status === 404) {
          return { ok: false, status: 404, upstreamStatus: status, data: null, error: `${serviceName} returned 404` };
        }
        if (status >= 500) {
          // Retry untuk 5xx
          if (retries < maxRetries) {
            retries++;
            await new Promise(r => setTimeout(r, 1500 * retries));
            continue;
          }
        }
        return { ok: false, status: 502, upstreamStatus: status, data: null, error: `${serviceName} returned HTTP ${status}` };
      }

      if (data === null || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && Object.keys(data).length === 0)) {
        await logSystem(db, 'WARNING', 'proxy',
          `${serviceName} EMPTY RESPONSE | URL=${url} | HTTP=${status} | TIME=${duration}ms`, rid);
      }

      if (useCache && serviceName === 'DEX' && res.ok) {
        const tokenCA = url.split('/tokens/')[1]?.split('?')[0];
        if (tokenCA) setCachedDex(tokenCA, data);
      }

      await logSystem(db, 'INFO', 'proxy',
        `${serviceName} OK | URL=${url} | HTTP=${status} | TIME=${duration}ms`, rid);

      return { ok: res.ok, status, data };

    } catch(e) {
      const duration = Date.now() - startTime;
      await logSystem(db, 'ERROR', 'proxy',
        `${serviceName} FETCH ERROR | URL=${url} | ERROR=${e.message} | TIME=${duration}ms`, rid);
      lastError = e;
      if (retries < maxRetries) {
        retries++;
        await new Promise(r => setTimeout(r, 1000 * retries));
      } else {
        break;
      }
    }
  }

  return { ok: false, status: 502, upstreamStatus: 0, data: null, error: lastError?.message || `${serviceName} failed after retries` };
}

// ==================== RPC HELPERS ====================
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
        const {results} = await db.prepare(`SELECT * FROM ai_stats WHERE id=1`).all();
        return new Response(JSON.stringify(ok(results[0]||{})),{headers:{...h,'Cache-Control':'no-store'}});
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

      // NEBULA OPTIONAL PROVIDERS V1 — read-only; BUY Gate and D1 untouched
      if(method==='GET' && /^\/api\/v1\/providers\/(solana_rpc|ankr|coingecko|coinpaprika|pump_ws)(\/|$)/.test(path)){
        const parts=path.split('/');const kind=parts[4];const mint=parts[5]||'';
        const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...h,'Content-Type':'application/json','Cache-Control':'no-store'}});
        if(kind==='pump_ws')return out({success:false,provider:kind,error:'WEBSOCKET_LIFECYCLE_REQUIRED'},501);
        if(kind==='ankr'&&!env.ANKR_RPC_URL)return out({success:false,provider:kind,error:'ENDPOINT_NOT_CONFIGURED'},503);
        if((kind==='coingecko'||kind==='coinpaprika')&&!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return out({success:false,provider:kind,error:'INVALID_MINT'},400);
        try{
          let target,opts={method:'GET',headers:{Accept:'application/json'}};
          if(kind==='solana_rpc'||kind==='ankr'){
            if(kind==='solana_rpc'&&!env.HELIUS_API_KEY)return out({success:false,provider:kind,error:'HELIUS_API_KEY_MISSING'},503);
            target=kind==='ankr'?env.ANKR_RPC_URL:'https://mainnet.helius-rpc.com/?api-key='+encodeURIComponent(env.HELIUS_API_KEY);
            opts={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getHealth'})};
          }else if(kind==='coingecko'){
            target='https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses='+encodeURIComponent(mint)+'&vs_currencies=usd';
            if(env.COINGECKO_API_KEY)opts.headers['x-cg-demo-api-key']=env.COINGECKO_API_KEY;
          }else target='https://api.coinpaprika.com/v1/contracts/solana/'+encodeURIComponent(mint);
          const resp=await fetch(target,{...opts,signal:AbortSignal.timeout(6500)});
          if(!resp.ok)return out({success:false,provider:kind,error:resp.status===429?'RATE_LIMIT':'HTTP_'+resp.status},resp.status===429?429:502);
          const data=await resp.json();
          if(kind==='solana_rpc'||kind==='ankr')return out({success:data?.result==='ok',provider:kind,verified:data?.result==='ok',error:data?.result==='ok'?null:'RPC_NOT_HEALTHY'},data?.result==='ok'?200:503);
          if(kind==='coingecko'){
            const entry=Object.entries(data||{}).find(([k])=>k.toLowerCase()===mint.toLowerCase());const price=Number(entry?.[1]?.usd);
            return out({success:Number.isFinite(price)&&price>0,provider:kind,data:Number.isFinite(price)&&price>0?{token_ca:mint,price_usd:price}:null,error:Number.isFinite(price)&&price>0?null:'TOKEN_NOT_FOUND'},Number.isFinite(price)&&price>0?200:404);
          }
          const id=data?.id;return out({success:typeof id==='string'&&!!id,provider:kind,data:id?{token_ca:mint,coinpaprika_id:id}:null,error:id?null:'TOKEN_NOT_FOUND'},id?200:404);
        }catch(e){return out({success:false,provider:kind,error:'UPSTREAM_UNAVAILABLE'},503);}
      }
      
      // NEBULA MULTIPROVIDER LIVE V1 - read-only, no D1 mutations
      if(method==='GET'&&(path.startsWith('/api/v1/providers/')||path.startsWith('/api/v1/holders/'))){
        const mint=decodeURIComponent(path.split('/').pop());
        if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return new Response(JSON.stringify({success:false,error:'INVALID_MINT'}),{status:400,headers:h});
        const kind=path.includes('/holders/')?'holders':path.split('/')[4];
        if(!['holders','jupiter','gecko','birdeye','market'].includes(kind))return new Response(JSON.stringify({success:false,error:'UNKNOWN_PROVIDER'}),{status:404,headers:h});
        const headers={'Content-Type':'application/json',...h,'Cache-Control':'public, max-age=30'};
        const query=async(provider)=>{
          try{
            let target,opts={headers:{Accept:'application/json'}};
            if(provider==='jupiter'){
              target='https://api.jup.ag/tokens/v2/search?query='+encodeURIComponent(mint);
              if(env.JUPITER_API_KEY)opts.headers['x-api-key']=env.JUPITER_API_KEY;
            }else if(provider==='gecko')target='https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+encodeURIComponent(mint);
            else if(provider==='birdeye'){
              if(!env.BIRDEYE_API_KEY)return {provider,ok:false,error:'API_KEY_MISSING'};
              target='https://public-api.birdeye.so/defi/price?address='+encodeURIComponent(mint);
              opts.headers['X-API-KEY']=env.BIRDEYE_API_KEY;opts.headers['x-chain']='solana';
            }
            const resp=await fetch(target,{...opts,signal:AbortSignal.timeout(6500)});
            if(!resp.ok)return {provider,ok:false,error:resp.status===429?'RATE_LIMIT':'HTTP_'+resp.status,retry_after:resp.headers.get('Retry-After')||null};
            const j=await resp.json();let price=null,holders=null,organic=null;
            if(provider==='jupiter'){
              const a=Array.isArray(j)?j.find(x=>x.id===mint):null;
              if(!a)return {provider,ok:false,error:'TOKEN_NOT_FOUND'};
              price=Number(a.usdPrice);holders=Number.isInteger(a.holderCount)&&a.holderCount>=0?a.holderCount:null;organic=a.organicScore??null;
            }else if(provider==='gecko'){
              if(j?.data?.id!=='solana_'+mint)return {provider,ok:false,error:'TOKEN_MISMATCH'};
              price=Number(j.data.attributes?.price_usd);
            }else{
              if(j?.success!==true)return {provider,ok:false,error:'PROVIDER_REJECTED'};
              price=Number(j.data?.value);
            }
            return {provider,ok:true,token_ca:mint,price_usd:Number.isFinite(price)&&price>0?price:null,holder_count:holders,holder_count_verified:provider==='jupiter'&&holders!==null,organic_score:organic,checked_at:new Date().toISOString()};
          }catch(e){return {provider,ok:false,error:'UPSTREAM_UNAVAILABLE'};}
        };
        const order=kind==='holders'?['jupiter']:kind==='market'?['jupiter','gecko','birdeye']:[kind];
        const attempts=[];let selected=null;
        for(const p of order){const result=await query(p);attempts.push(result);if(result.ok&&(kind==='holders'?result.holder_count_verified:result.price_usd!==null)){selected=result;break;}}
        return new Response(JSON.stringify({success:!!selected,data:selected,attempts:attempts.map(a=>({provider:a.provider,ok:a.ok,error:a.error||null})),verified:kind==='holders'?!!selected?.holder_count_verified:!!selected}),{status:selected?200:503,headers});
      }
      // ==================== PROXY ====================
      // Helius RPC
      if(path==='/helius/rpc'&&method==='POST') {
        let body;
        try { body = await request.json(); } catch(e) { return new Response(JSON.stringify(err('Invalid JSON','PARSE')),{status:400,headers:h}); }
        if(!body?.jsonrpc||!body.method||!body.params) return new Response(JSON.stringify(err('Invalid JSON-RPC','VALIDATION')),{status:400,headers:h});
        if(!ALLOWED_RPC.has(body.method)) return new Response(JSON.stringify(err(`Method ${body.method} not allowed`,'VALIDATION')),{status:400,headers:h});

        if (!env.HELIUS_API_KEY) {
          return new Response(JSON.stringify(err('HELIUS_API_KEY not configured','CONFIG_ERROR')),{status:500,headers:h});
        }

        const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
        let r = await rpcFetch(heliusUrl, body, env, db, rid);

        if (!r.ok) {
          const errorCode = r.errorCode || 'HELIUS_ERROR';
          const errorMsg = r.errorMsg || 'Helius RPC failed';
          return new Response(JSON.stringify(err(errorMsg, errorCode)),{status:503,headers:h});
        }

        return new Response(JSON.stringify(r.data),{headers:{...h,'Cache-Control':'public, max-age=30'}});
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
        const result = await safeProxyFetch(`https://frontend-api.pump.fun/coins${url.search}`, 'PUMPFUN', db, rid, false);
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
