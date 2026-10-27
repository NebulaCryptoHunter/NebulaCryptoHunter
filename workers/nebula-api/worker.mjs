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
    if(origin&&!ALLOWED_ORIGINS.includes(ori --- TRUNCATED --- 46,580 chars