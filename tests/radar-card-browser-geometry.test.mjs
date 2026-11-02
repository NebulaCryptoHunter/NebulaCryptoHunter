import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);

function fixture(){
 const metric=(name,value,kind)=>'<div class="token-card-metric metric-'+kind+'"><dt><svg viewBox="0 0 24 24"><path d="M3 3L21 21"/></svg>'+name+'</dt><dd>'+value+'</dd></div>';
 const card='<article class="hud-card card-watch" data-ca="7Wf1">'
 +'<div class="token-card-head"><span class="token-emblem">PU</span><div class="token-card-identity"><span class="token-card-eyebrow">TARGET 01 · SOLANA</span><span class="token-name">PUMPP</span><span class="decision-tag">WATCH</span></div><span class="token-score-instrument"><span class="score-ring-container">64</span>AI SCORE</span></div>'
 +'<div class="token-market-hero"><div class="token-price-console"><span class="token-instrument-label">MARKET PRICE · USD</span><div class="token-card-price">$0.004098</div><span class="token-price-venue">DEX</span></div><div class="token-pulse"><span class="token-instrument-label">MOMENTUM · Δ HARGA</span><div class="token-pulse-row">5M <span class="token-pulse-track"></span><b>−0.49%</b></div><div class="token-pulse-row">1J <span class="token-pulse-track"></span><b>+0.11%</b></div><div class="token-pulse-row">24J <span class="token-pulse-track"></span><b>+3.11%</b></div></div></div>'
 +'<div class="token-card-body"><dl class="token-card-metrics">'+metric('LIKUIDITAS','$13.240','liquidity')+metric('VOLUME 24J','$94.682','volume')+metric('Δ 24 JAM','+3.11%','change')+metric('SKOR HEURISTIK','64.0 / 100','score')+'</dl>'
 +'<div class="token-card-provenance"><span class="token-provenance-dot"></span>18.20 WIB · OBSERVASI SERVER <span class="token-risk-chip">RISIKO BELUM DIVERIFIKASI</span></div><div class="token-card-address">CA · 7Wfw1p2P…998nBGSQ</div></div>'
 +'<div class="token-order-flow"><div class="flow-labels"><span>BUY <b>17</b></span><span class="token-instrument-label">ORDER FLOW · 1 JAM</span><span>SELL <b>11</b></span></div><div class="flow-track"><i style="width:61%"></i></div></div>'
 +'<div class="token-card-footer"><div class="token-card-actions">'+['WATCH','SALIN CA','PHANTOM','PUMP','DEX','DETAIL ↗'].map(x=>'<button class="action-btn-text">'+x+'</button>').join('')+'</div></div><div class="card-detail-section"></div></article>';
 const nav='<div class="sticky-nav"><header class="hunter-banner"><div class="hunter-brand"><div class="header-row-2">NEBULA CRYPTO HUNTER</div><div class="header-row-1">HUNT BEFORE THE HYPE.</div></div></header><div class="endpoint-bar">'+Array.from({length:12},(_,i)=>'<span class="ep-mini">API '+i+'</span>').join('')+'</div><div class="hud-controls"><select class="hud-select"><option>AUTO</option></select><select class="hud-select"><option>BALANCED</option></select><div class="action-row">'+['SCAN','SINKRON','AUTO','HIST','WATCH','EXP','AUDIT','DBG'].map(x=>'<button>'+x+'</button>').join('')+'</div></div></div>';
 const kpi='<section class="hunter-kpi-row">'+['DATABASE','PREDICTION','UNIQUE'].map(x=>'<div class="hunter-kpi"><div class="hunter-kpi-inner"><span class="hunter-kpi-label">'+x+'</span><strong class="hunter-kpi-value">8.074</strong></div></div>').join('')+'</section>';
 const radar='<section class="hunter-panel hunter-targets-panel"><header class="hunter-panel-heading"><span class="hunter-panel-icon">⌖</span><div><h2>TACTICAL TOKEN RADAR</h2><small>REAL-TIME RESEARCH OPPORTUNITY FEED</small></div></header><div class="hunter-radar-zone"><div class="hunter-radar-scope"></div><div class="hunter-radar-status"><span class="title">HUNTER TARGETS</span><strong>50</strong><span class="hunter-radar-key">RUN RATE_LIMITED</span></div></div><div class="hunter-targets-heading"><span>◈ ACTIVE TOKEN TARGETS</span><span class="hunter-scroll-controls"><button>↑</button><button>↓</button></span></div><p class="hunter-feed-notice" hidden></p><div id="radarFeed" class="radar-grid hunter-scrollable">'+card+card+'</div></section>';
 const shell='<div class="app">'+nav+kpi+'<main class="hunter-layout"><section class="hunter-panel hunter-ai-panel">AI PERFORMANCE</section>'+radar+'<aside class="hunter-panel hunter-history-panel">DATABASE / HISTORY</aside></main><div class="hunter-console-wrap"><div class="ai-console">NEBULA ONLINE</div></div><footer class="hunter-cockpit-footer"></footer></div>';
 const check='<script>window.addEventListener("load",function(){var card=document.querySelector(".radar-grid>.hud-card"),body=card.querySelector(".token-card-body"),r=card.getBoundingClientRect();var selectors=[".token-card-head",".token-market-hero",".token-card-metrics",".token-order-flow",".token-card-provenance",".token-card-address",".token-card-footer"];var boxes=selectors.map(function(s){var x=card.querySelector(s).getBoundingClientRect();return {name:s,top:Math.round(x.top),bottom:Math.round(x.bottom),h:Math.round(x.height)}});var data={width:innerWidth,height:innerHeight,cardHeight:Math.round(r.height),bodyClientHeight:body.clientHeight,bodyScrollHeight:body.scrollHeight,overflow:getComputedStyle(body).overflowY,boxes:boxes,visible:boxes.every(function(x){return x.top>=r.top-2&&x.bottom<=r.bottom+2}),buttonCount:card.querySelectorAll(".token-card-actions button").length,metricFont:getComputedStyle(card.querySelector(".token-card-metric dd")).fontSize,momentumBottom:Math.round([...card.querySelectorAll(".token-pulse-row")].at(-1).getBoundingClientRect().bottom),flowTrackBottom:Math.round(card.querySelector(".flow-track").getBoundingClientRect().bottom),buttonsTop:Math.round(card.querySelector(".token-card-actions").getBoundingClientRect().top)};document.getElementById("geo").textContent=JSON.stringify(data)});</script>';
 return '<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style><style>.bg-nebula,.hunter-banner{background-image:none!important}</style></head><body>'+shell+'<pre id="geo"></pre>'+check+'</body></html>';
}
test('headless browser checks actual token card geometry at three desktop viewports',{skip:!chrome},()=>{
 assert.ok(css.includes('V4.0 — no-overlap tactical token card'));
 const dir=mkdtempSync(join(tmpdir(),'nebula-radar-'));
 try{
  const path=join(dir,'radar.html');writeFileSync(path,fixture());
  for(const [w,h] of [[1773,900],[1536,864],[1366,768]]){
   const run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--window-size='+w+','+h,'--virtual-time-budget=800','--dump-dom','file://'+path],{encoding:'utf8',timeout:30000,maxBuffer:8e6});
   assert.equal(run.status,0,'Chrome failed to render at '+w+'x'+h+': '+run.stderr?.slice(-300));
   const found=run.stdout.match(/<pre id="geo">([^<]+)<\/pre>/);
   assert.ok(found,'Missing browser geometry '+w+'x'+h);
   const x=JSON.parse(found[1].replace(/&quot;/g,'"'));
   assert.equal(x.buttonCount,6);
   assert.ok(x.visible,'Token content clipped '+JSON.stringify(x));
   const loc=name=>x.boxes.find(v=>v.name===name);
   assert.ok(loc('.token-market-hero').bottom<=loc('.token-card-metrics').top+1,'Momentum overlaps LIQ metrics '+JSON.stringify(x));
   assert.ok(loc('.token-card-metrics').bottom<=loc('.token-card-provenance').top+1,'LIQ metrics overlap source line '+JSON.stringify(x));
   assert.ok(loc('.token-card-provenance').bottom<=loc('.token-order-flow').top+1,'Source/risk overlaps BUY SELL '+JSON.stringify(x));
   assert.ok(loc('.token-order-flow').bottom<=loc('.token-card-footer').top+1,'BUY SELL covered by buttons '+JSON.stringify(x));
   assert.ok(loc('.token-order-flow').h>=28,'BUY SELL too small '+JSON.stringify(x));
   assert.ok(x.momentumBottom<=loc('.token-market-hero').bottom+1,'Last 24J momentum row clipped '+JSON.stringify(x));
   assert.ok(x.flowTrackBottom<=loc('.token-order-flow').bottom+1,'BUY SELL flow bar clipped '+JSON.stringify(x));
   assert.ok(x.buttonsTop>=loc('.token-order-flow').bottom-1,'Action buttons overlap BUY SELL '+JSON.stringify(x));
   assert.ok(x.bodyScrollHeight<=x.bodyClientHeight+3,'Nested card overflow '+JSON.stringify(x));
   assert.equal(x.overflow,'hidden');
   assert.ok(parseFloat(x.metricFont)>=12,'Metric text too small '+JSON.stringify(x));
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
});
