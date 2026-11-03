import {cpSync,mkdirSync} from 'node:fs';
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});
for(const file of ['nebula-scanner.mjs','research-evaluation.mjs','research-cache.mjs','provider-runtime.mjs','market-sources.mjs','market-observation.mjs','scoring-v2.mjs','risk-assessment.mjs','scanner-selection.mjs','token-evidence.mjs','performance-metrics.mjs','model-validation.mjs','radar-policy.mjs','radar-patterns.mjs','radar-store.mjs','radar-market.mjs','radar-monitor.mjs'])cpSync(new URL('../backend/workers/'+file,import.meta.url),new URL('../dist/'+file,import.meta.url));
