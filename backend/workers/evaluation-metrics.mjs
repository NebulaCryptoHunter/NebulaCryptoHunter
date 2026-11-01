// A point-in-time return cannot measure ATH, drawdown, rug pulls or calibration.
export const EVALUATION_VERSION='V111.0.0';
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
export function pointOutcome({entryPrice,exitPrice,decision,predictedMultiplier=null}){
 if(!positive(entryPrice)||!positive(exitPrice))return null;
 const actualMultiplier=exitPrice/entryPrice,roi=(actualMultiplier-1)*100;
 if(!Number.isFinite(actualMultiplier)||!Number.isFinite(roi))return null;
 const direction=['BUY','STRONG_BUY'].includes(decision)?1:decision==='AVOID'?-1:0;
 const directionalScore=direction?(direction===1?roi>0:roi<=0)?100:0:null;
 const multiplierScore=positive(predictedMultiplier)?Math.max(0,100*(1-Math.abs(predictedMultiplier-actualMultiplier)/Math.max(predictedMultiplier,actualMultiplier))):null;
 return {roi,actualMultiplier,directionalScore,multiplierScore,successScore:directionalScore,
  timingScore:null,riskScore:null,opportunityCostScore:null,sustainabilityScore:null,confidenceCalibrationScore:null,
  maxDrawdown:null,timeToAth:null,sustainedHours:null,evaluationConfidence:null,
  outcome:roi>0?'POSITIVE_RETURN':roi<0?'NEGATIVE_RETURN':'FLAT',measurement:'POINT_IN_TIME_RETURN',isTradePnL:false};
}
export function classificationMetrics({tp=0,fp=0,fn=0,tn=0}={}){
 if([tp,fp,fn,tn].some(n=>!Number.isSafeInteger(n)||n<0))throw Error('INVALID_CONFUSION_COUNTS');
 const precision=tp+fp>0?tp/(tp+fp):null,recall=tp+fn>0?tp/(tp+fn):null;
 return {tp,fp,fn,tn,samples:tp+fp+fn+tn,precision,recall,f1:2*tp+fp+fn>0?2*tp/(2*tp+fp+fn):null,accuracy:tp+fp+fn+tn>0?(tp+tn)/(tp+fp+fn+tn):null};
}
// One decision, one horizon, one newly measured evaluation. WATCH is an abstention.
export const analyticsSQL=`WITH measured AS (
 SELECT p.id,p.decision,e.actual_roi FROM predictions p JOIN evaluations e ON e.prediction_id=p.id
 WHERE e.evaluation_window='30m' AND e.engine_version='V111.0.0' AND e.evaluation_status='COMPLETED'
 AND typeof(e.actual_roi) IN ('integer','real')
 AND e.id=(SELECT MIN(x.id) FROM evaluations x WHERE x.prediction_id=p.id AND x.evaluation_window='30m' AND x.engine_version='V111.0.0' AND x.evaluation_status='COMPLETED')
 ) SELECT (SELECT COUNT(*) FROM predictions) total_predictions,(SELECT COUNT(*) FROM evaluations) total_evaluations,
 COALESCE(SUM(CASE WHEN decision IN ('BUY','STRONG_BUY') AND actual_roi>0 THEN 1 ELSE 0 END),0) tp,
 COALESCE(SUM(CASE WHEN decision IN ('BUY','STRONG_BUY') AND actual_roi<=0 THEN 1 ELSE 0 END),0) fp,
 COALESCE(SUM(CASE WHEN decision='AVOID' AND actual_roi>0 THEN 1 ELSE 0 END),0) fn,
 COALESCE(SUM(CASE WHEN decision='AVOID' AND actual_roi<=0 THEN 1 ELSE 0 END),0) tn,
 AVG(CASE WHEN decision IN ('BUY','STRONG_BUY') THEN actual_roi END) avg_buy_roi FROM measured`;
export async function readMeasuredAnalytics(db){
 const row=await db.prepare(analyticsSQL).first();
 const metrics=classificationMetrics({tp:Number(row?.tp||0),fp:Number(row?.fp||0),fn:Number(row?.fn||0),tn:Number(row?.tn||0)});
 return {...metrics,totalPredictions:Number(row?.total_predictions||0),totalEvaluations:Number(row?.total_evaluations||0),avgBuyRoi:row?.avg_buy_roi??null,window:'30m',population:'Explicit BUY/STRONG_BUY/AVOID with V111 point-in-time observations; WATCH excluded',modelCalibrated:false};
}
export async function updateMeasuredAnalytics(db){
 const metrics=await readMeasuredAnalytics(db);
 const percent=n=>n===null?null:Math.round(n*10000)/100;
 await db.prepare(`UPDATE ai_stats SET total_predictions=?,total_evaluations=?,overall_win_rate=?,overall_avg_roi=?,overall_precision=?,overall_recall=?,overall_f1=?,updated_at=datetime('now') WHERE id=1`)
  .bind(metrics.totalPredictions,metrics.totalEvaluations,percent(metrics.precision),metrics.avgBuyRoi,percent(metrics.precision),percent(metrics.recall),percent(metrics.f1)).run();
 return metrics;
}
