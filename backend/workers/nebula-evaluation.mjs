// =====================================================
// NEBULA WORKER 2: EVALUATION ENGINE (V110.2.1)
// Deploy sebagai Worker terpisah: nebula-evaluation
// Cron Trigger: */30 * * * *
// Binding: DB (D1 Database)
// =====================================================

const VERSION = 'V110.3.3';
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
  const pairs = (data?.pairs || []).filter(p => p.chainId === 'solana' && (p.baseToken?.address === ca || p.quoteToken?.address === ca));
  pairs.sort((a,b) => (Number(b.liquidity?.usd)||0)-(Number(a.liquidity?.usd)||0));
  const p = pairs[0];
  if (!p) return 0;
  const v = p.baseToken?.address === ca ? Number(p.priceUsd) : 0;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

async function getTokenPrice(ca) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return null;
  const cached = getCachedDex(ca);
  if (cached && cached.pairs && cached.pairs.length > 0) {
    const price = bestSolPrice(cached, ca);
    if (price > 0) return { price, cached: true };
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
            if (price > 0) return { price, cached: false };
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
  const { id, token_ca, entry_price, predicted_multiplier, decision, confidence } = prediction;
  if (!entry_price || entry_price <= 0) return { skipped: true, reason: 'No entry price' };

  const priceResult = await getTokenPrice(token_ca);
  if (priceResult === null) return { skipped: true, reason: 'Price unavailable' };

  const { price: currentPrice, cached } = priceResult;
  const roi = ((currentPrice - entry_price) / entry_price) * 100;
  const actualMultiplier = currentPrice / entry_price;

  // Directional score (0-100)
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

  // Multiplier score (0-100)
  let multiplierScore = 0;
  if (predicted_multiplier && predicted_multiplier > 0 && actualMultiplier > 0) {
    const error = Math.abs(predicted_multiplier - actualMultiplier) / Math.max(predicted_multiplier, actualMultiplier);
    multiplierScore = Math.round(clamp((1 - error) * 100, 0, 100));
  } else {
    multiplierScore = 50;
  }

  // Timing score (0-100)
  let timingScore = 50;
  if (windowKey === '30m' && roi > 5) timingScore = 80;
  else if (windowKey === '2h' && roi > 20) timingScore = 85;
  else if (windowKey === '6h' && roi > 50) timingScore = 90;
  else if (windowKey === '24h' && roi > 100) timingScore = 95;

  // Risk score
  const riskScore = clamp(Math.round(100 - Math.abs(roi) * 0.2), 10, 100);

  // Opportunity cost
  let opportunityCostScore = 100;
  if (decision === 'AVOID' && roi > 20) opportunityCostScore = 30;
  else if (decision === 'WAIT' && roi > 30) opportunityCostScore = 40;

  // Sustainability
  const ageHours = (Date.now() - new Date(prediction.created_at).getTime()) / (60*60*1000);
  const sustainedHours = null; // Not measurable from one spot-price observation.
  const sustainabilityScore = 50; // Neutral; unobserved trajectory.

  // Confidence calibration
  const confidenceCalibrationScore = clamp(Math.round(100 - Math.abs((confidence||50) - (roi>0?100:0))), 10, 100);

  // Overall success score (weighted)
  const successScore = Math.round(
    directionalScore * 0.25 +
    multiplierScore * 0.30 +
    timingScore * 0.15 +
    riskScore * 0.10 +
    opportunityCostScore * 0.10 +
    sustainabilityScore * 0.05 +
    confidenceCalibrationScore * 0.05
  );

  // Check for existing evaluation for this window
  const existing = await db.prepare(`SELECT id FROM evaluations WHERE prediction_id=? AND evaluation_window=?`)
    .bind(id, windowKey).first();
  if (existing) return { skipped: true, reason: 'Already evaluated' };

  // Determine win/loss status
  let winLoss = 'PENDING';
  if (roi >= 100) winLoss = 'WIN';
  else if (roi <= -90) winLoss = 'RUGGED';
  else if (roi > 0) winLoss = 'ACTIVE';
  else winLoss = 'LOSS';

  // Store evaluation
  await db.prepare(`INSERT INTO evaluations (
    prediction_id, token_ca, directional_score, multiplier_score, timing_score,
    risk_score, opportunity_cost_score, sustainability_score,
    confidence_calibration_score, success_score, actual_roi, actual_multiplier,
    max_drawdown, time_to_ath, sustained_hours, evaluation_confidence,
    market_regime, evaluation_window, engine_version, notes, evaluated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,50,?,?,?,?,datetime('now'))`)
    .bind(id, token_ca, directionalScore, multiplierScore, timingScore,
      riskScore, opportunityCostScore, sustainabilityScore,
      confidenceCalibrationScore, successScore, roi, actualMultiplier,
      sustainedHours, prediction.market_regime||'SIDEWAY', windowKey, VERSION,
      `POINT_IN_TIME_ONLY; sustainability/drawdown/ATH unmeasured; WL:${winLoss} ROI:${roi.toFixed(1)}%`)
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

    await logSystem(db, 'INFO', 'analytics', `Stats: Preds ${totalPreds}, Evals ${totalEvals}, F1 ${Math.round(f1*100)}%, ROI ${avgROI}%`, runId);
  } catch(e) {
    await logSystem(db, 'ERROR', 'analytics', `Failed to update stats: ${e.message}`, runId);
  }
}

// ==================== CRON HANDLER ====================
async function handleScheduled(env, ctx) {
  const db = env.DB;
  const runId = UUID();
  const cronStartTime = Date.now();
  const now = Date.now();
  
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
        evaluatePrediction(db, pred, window.key, runId)
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
    ctx.waitUntil(handleScheduled(env, ctx));
  }
};
