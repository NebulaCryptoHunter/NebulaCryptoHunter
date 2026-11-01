import {pointOutcome,updateMeasuredAnalytics,EVALUATION_VERSION} from './evaluation-metrics.mjs';
import {providerJSON} from './provider-runtime.mjs';
import {evaluateResearch} from './research-evaluation.mjs';
// =====================================================
// NEBULA WORKER 2: EVALUATION ENGINE (V110.2.1)
// Deploy sebagai Worker terpisah: nebula-evaluation
// Cron Trigger: */30 * * * *
// Binding: DB (D1 Database)
// =====================================================

const VERSION = EVALUATION_VERSION;
const BUILD = '2026-10-26';

const CFG = {
  CRON_BATCH_SIZE: 4,        // Maksimal prediksi per batch per window
  CRON_MAX_CONCURRENT: 2,     // Dikurangi untuk mengurangi beban resource
  CRON_TIMEOUT_MS: 18000,     // 25 detik timeout untuk Cron (aman di bawah 30s limit)
  EVALUATION_WINDOWS: [
    { key: '30m', ms: 30*60*1000 },
    { key: '2h', ms: 2*60*60*1000 },
    { key: '6h', ms: 6*60*60*1000 },
    { key: '24h', ms: 24*60*60*1000 },
    { key: '3d', ms: 3*24*60*60*1000 },
    { key: '7d', ms: 7*24*60*60*1000 }
  ],
  PRICE_RETRY_MAX: 0,
  PRICE_RETRY_BACKOFF: 500,
  DEX_CACHE_TTL: 60000
};

// ==================== UTILITIES ====================
function UUID() { return crypto.randomUUID(); }
function clamp(v,min,max) { return Math.min(max, Math.max(min, v)); }
function safeDivide(a,b,fallback=0) { if (!b || !a) return fallback; return a/b; }

// ==================== LOGGING ====================
async function logSystem(db, level, source, message, runId='') {
  try {
    const msg = runId ? `[${runId}] ${message.substring(0, 400)}` : message.substring(0, 400);
    await db.prepare(`INSERT INTO system_log (log_level, log_source, log_message) VALUES (?,?,?)`)
      .bind(level, source, msg).run();
  } catch(e){}
}

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
function bestSolPrice(data, ca) {
  const pairs = (data?.pairs || []).filter(p => p.chainId === 'solana' && (p.baseToken?.address === ca));
  pairs.sort((a,b) => (Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));
  const p = pairs[0];
  if (!p) return 0;
  const v = p.baseToken?.address === ca ? Number(p.priceUsd) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export async function getTokenPrice(ca,budget){
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca))return null;
 if(budget.pending.has(ca))return budget.pending.get(ca);
 if(budget.remaining<=0)return null;
 budget.remaining--;
 const work=(async()=>{
  const dex=await providerJSON('dexscreener','https://api.dexscreener.com/latest/dex/tokens/'+ca,{}, {ttl:60,timeout:2500});
  if(dex.ok){const price=bestSolPrice(dex.data,ca);if(price>0)return {price,cached:!!dex.cached,source:'dexscreener',observedAt:dex.fetchedAt}}
  const gecko=await providerJSON('geckoterminal','https://api.geckoterminal.com/api/v2/networks/solana/tokens/'+ca,{}, {ttl:60,timeout:2500});
  const price=Number(gecko.data?.data?.attributes?.price_usd);
  return gecko.ok&&gecko.data?.data?.id==='solana_'+ca&&Number.isFinite(price)&&price>0?{price,cached:!!gecko.cached,source:'geckoterminal',observedAt:gecko.fetchedAt}:null;
 })();
 budget.pending.set(ca,work);return work;
}

// ==================== EVALUATION SERVICE ====================
export async function evaluatePrediction(db, prediction, windowKey, runId,budget) {
  const { id, token_ca, entry_price, predicted_multiplier, decision, confidence } = prediction;
  if (!entry_price || entry_price <= 0) return { skipped: true, reason: 'No entry price' };
  const window=CFG.EVALUATION_WINDOWS.find(x=>x.key===windowKey);
  const rawTime=typeof prediction.created_at==='string'?prediction.created_at.replace(' ','T'):'';
  const entryTime=Date.parse(rawTime&&!/Z$|[+-]\d\d:\d\d$/.test(rawTime)?rawTime+'Z':rawTime);
  if(!window||!Number.isFinite(entryTime))return {skipped:true,reason:'Invalid entry time or horizon'};

  const priceResult = await getTokenPrice(token_ca,budget);
  if (priceResult === null) return { skipped: true, reason: 'Price unavailable' };
  const exitTime=Date.parse(priceResult.observedAt);
  if(!Number.isFinite(exitTime)||exitTime<entryTime+window.ms||exitTime>entryTime+window.ms+40*60000||exitTime>Date.now()+60000)return {skipped:true,reason:'Quote outside declared horizon'};

  const {price:currentPrice,cached}=priceResult;
  const measured=pointOutcome({entryPrice:entry_price,exitPrice:currentPrice,decision,predictedMultiplier:predicted_multiplier});
  if(!measured)return {skipped:true,reason:'Invalid point-in-time return'};
  const {roi,actualMultiplier,directionalScore,multiplierScore,successScore,timingScore,riskScore,opportunityCostScore,sustainabilityScore,confidenceCalibrationScore,sustainedHours}=measured;

  // Check for existing evaluation for this window
  const existing = await db.prepare(`SELECT id FROM evaluations WHERE prediction_id=? AND evaluation_window=?`)
    .bind(id, windowKey).first();
  if (existing) return { skipped: true, reason: 'Already evaluated' };

  const winLoss=measured.outcome;
  // Store evaluation
  await db.prepare(`INSERT INTO evaluations (
    prediction_id, token_ca, directional_score, multiplier_score, timing_score,
    risk_score, opportunity_cost_score, sustainability_score,
    confidence_calibration_score, success_score, actual_roi, actual_multiplier,
    max_drawdown, time_to_ath, sustained_hours, evaluation_confidence,
    market_regime, evaluation_window, engine_version, notes, evaluated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL,?,?,?,?,datetime('now'))`)
    .bind(id, token_ca, directionalScore, multiplierScore, timingScore,
      riskScore, opportunityCostScore, sustainabilityScore,
      confidenceCalibrationScore, successScore, roi, actualMultiplier,
      sustainedHours, prediction.market_regime||'SIDEWAY', windowKey, VERSION,
      `POINT_IN_TIME_V2; source:${priceResult.source}; source_observed_at:${priceResult.observedAt}; elapsed_seconds:${Math.round((exitTime-entryTime)/1000)}; legacy entry pool unspecified; OUTCOME:${winLoss}; not trade P&L; drawdown/ATH/rug/calibration unmeasured`)
    .run();

  // Hanya update status ke EVALUATED jika ini adalah window terakhir (7d)
  if (windowKey === '7d') {
    await db.prepare(`UPDATE predictions SET learning_status='EVALUATED', success_score=?, actual_multiplier=?, evaluated_at=datetime('now') WHERE id=?`)
      .bind(successScore, actualMultiplier, id).run();
  } else {
    // Update progress tapi tetap PENDING
    await db.prepare(`UPDATE predictions SET success_score=?, actual_multiplier=? WHERE id=?`)
      .bind(successScore, actualMultiplier, id).run();
  }

  return { 
    success: true, 
    id, roi, actualMultiplier, predictedMultiplier: predicted_multiplier||0, 
    successScore, decision, winLoss, windowKey, cached 
  };
}

// ==================== ANALYTICS UPDATE ====================
async function updateAnalyticsStats(db,runId){
 const summary=await updateMeasuredAnalytics(db);
 await logSystem(db,'INFO','analytics','Fixed 30m samples '+summary.samples+'; uncalibrated',runId);
 return summary;
}

// ==================== CRON HANDLER ====================
export async function handleScheduled(env, ctx) {
  const db = env.DB;
  const runId = UUID();
  const cronStartTime = Date.now();
  const now = Date.now();
  // Four unique token quotes maximum: at most 8 provider fetches plus bounded Cache API calls.
  const priceBudget={remaining:4,pending:new Map()};
  
  // Statistik Cron
  const stats = {
    totalSelected: 0,
    totalEvaluated: 0,
    totalSkipped: 0,
    totalFailed: 0,
    httpRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    windows: {}
  };

  await logSystem(db, 'INFO', 'cron', '========================================', runId);
  await logSystem(db, 'INFO', 'cron', `CRON STARTED (${VERSION})`, runId);
  await logSystem(db, 'INFO', 'cron', '========================================', runId);

  for (const window of CFG.EVALUATION_WINDOWS) {
    // Timeout protection: jika sudah mendekati limit, hentikan Cron
    if (Date.now() - cronStartTime > CFG.CRON_TIMEOUT_MS) {
      await logSystem(db, 'WARNING', 'cron', `TIMEOUT PROTECTION: Stopping Cron after ${Date.now() - cronStartTime}ms`, runId);
      break;
    }

    const windowStartTime = Date.now();
    const windowEnd = new Date(now - window.ms).toISOString();
    
    // Ambil prediksi yang SUDAH MEMENUHI umur untuk window tertentu,
    // tapi BELUM dievaluasi pada window ini,
    // dengan LIMIT sesuai CRON_BATCH_SIZE
    const { results } = await db.prepare(`
      SELECT p.* FROM predictions p
      LEFT JOIN evaluations e ON p.id = e.prediction_id AND e.evaluation_window = ?
      WHERE p.learning_status IN ('PENDING', 'EVALUATED')
      AND datetime(p.created_at) <= datetime(?)
      AND datetime(p.created_at) >= datetime(?)
      AND length(p.token_ca) BETWEEN 32 AND 44
      AND e.id IS NULL
      AND p.entry_price > 0
      ORDER BY p.created_at DESC
      LIMIT ?
    `).bind(window.key, windowEnd, new Date(now-window.ms-40*60*1000).toISOString(), CFG.CRON_BATCH_SIZE).all();

    if (!results || results.length === 0) {
      await logSystem(db, 'INFO', 'cron', `Window ${window.key}: 0 predictions`, runId);
      stats.windows[window.key] = { selected: 0, success: 0, failed: 0, skipped: 0, duration: 0 };
      continue;
    }

    stats.totalSelected += results.length;
    let windowSuccess = 0;
    let windowFailed = 0;
    let windowSkipped = 0;

    await logSystem(db, 'INFO', 'cron', `Window ${window.key}: ${results.length} selected`, runId);

    // Proses batch dengan concurrency terbatas
    for (let i = 0; i < results.length; i += CFG.CRON_MAX_CONCURRENT) {
      // Timeout protection
      if (Date.now() - cronStartTime > CFG.CRON_TIMEOUT_MS) {
        await logSystem(db, 'WARNING', 'cron', `TIMEOUT: Batch interrupted for window ${window.key}`, runId);
        break;
      }

      const batch = results.slice(i, i + CFG.CRON_MAX_CONCURRENT);
      const promises = batch.map(pred =>
        evaluatePrediction(db, pred, window.key, runId,priceBudget)
          .then(result => {
            if (!result) {
              windowFailed++;
              stats.totalFailed++;
            } else if (result.skipped) {
              windowSkipped++;
              stats.totalSkipped++;
            } else {
              windowSuccess++;
              stats.totalEvaluated++;
              if (result.cached) stats.cacheHits++;
              else stats.cacheMisses++;
              stats.httpRequests++;
            }
          })
          .catch(async e => { 
            windowFailed++; 
            stats.totalFailed++; 
            await logSystem(db, 'ERROR', 'cron', `Eval failed ${pred.id}: ${e.message}`, runId); 
          })
      );
      await Promise.all(promises);
    }

    const windowDuration = Date.now() - windowStartTime;
    stats.windows[window.key] = {
      selected: results.length,
      success: windowSuccess,
      failed: windowFailed,
      skipped: windowSkipped,
      duration: windowDuration
    };

    await logSystem(db, 'INFO', 'cron', 
      `Window ${window.key}: ${windowSuccess} success, ${windowFailed} failed, ${windowSkipped} skipped, ${windowDuration}ms`, 
      runId
    );
  }

  // Update analytics
  try {
    await updateAnalyticsStats(db, runId);
    await logSystem(db, 'INFO', 'cron', 'Analytics updated', runId);
  } catch(e) {
    await logSystem(db, 'ERROR', 'cron', `Analytics failed: ${e.message}`, runId);
  }

  const totalDuration = Date.now() - cronStartTime;
  
  // Log ringkasan akhir
  await logSystem(db, 'INFO', 'cron', '========================================', runId);
  await logSystem(db, 'INFO', 'cron', 'CRON FINISHED', runId);
  await logSystem(db, 'INFO', 'cron', `Selected: ${stats.totalSelected}`, runId);
  await logSystem(db, 'INFO', 'cron', `Evaluated: ${stats.totalEvaluated}`, runId);
  await logSystem(db, 'INFO', 'cron', `Skipped: ${stats.totalSkipped}`, runId);
  await logSystem(db, 'INFO', 'cron', `Failed: ${stats.totalFailed}`, runId);
  await logSystem(db, 'INFO', 'cron', `HTTP Requests: ${stats.httpRequests}`, runId);
  await logSystem(db, 'INFO', 'cron', `Cache Hits: ${stats.cacheHits}`, runId);
  await logSystem(db, 'INFO', 'cron', `Cache Misses: ${stats.cacheMisses}`, runId);
  await logSystem(db, 'INFO', 'cron', `Total Duration: ${totalDuration}ms`, runId);
  await logSystem(db, 'INFO', 'cron', '========================================', runId);

  return new Response(`Cron ${VERSION} done [${runId}]. Evaluated ${stats.totalEvaluated}, errors ${stats.totalFailed}, duration ${totalDuration}ms`);
}

// ==================== MAIN WORKER ====================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      const dbOk = await env.DB.prepare(`SELECT 1`).first();
      return new Response(JSON.stringify({
        status: dbOk ? 'healthy' : 'degraded',
        version: VERSION,
        build: BUILD,
        db: dbOk ? 'connected' : 'error'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('Worker 2: Evaluation Engine', { status: 200 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.allSettled([handleScheduled(env, ctx),evaluateResearch(env.RESEARCH_DB)]).then(results=>{for(const result of results)if(result.status==='rejected')console.warn('evaluation_task_failed',String(result.reason?.message||result.reason).slice(0,120))}));
  }
};
