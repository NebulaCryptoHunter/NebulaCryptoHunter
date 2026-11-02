import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
const header=html.match(/<header class="hunter-banner"[\s\S]*?<\/header>/)?.[0]||'';
const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium'].find(existsSync);

function fixture(){
 const cleanHeader=header.replace(/<img[^>]*>/g,'');
 const script='<script>window.addEventListener("load",function(){'
  +'const banner=document.querySelector(".hunter-banner"),box=banner.querySelector(".hunter-brand");'
  +'const title=banner.querySelector(".header-row-2"),subtitle=banner.querySelector(".header-row-1");'
  +'const rect=x=>{const b=x.getBoundingClientRect();return {x:b.left,y:b.top,w:b.width,h:b.height,cx:b.left+b.width/2,cy:b.top+b.height/2,r:b.right,b:b.bottom}};'
  +'const before=getComputedStyle(box,"::before"),after=getComputedStyle(box,"::after");'
  +'const data={banner:rect(banner),box:rect(box),title:rect(title),subtitle:rect(subtitle),'
  +'before:{width:before.width,height:before.height,top:before.top,borderLeft:before.borderLeftWidth,borderRight:before.borderRightWidth},'
  +'after:{width:after.width,height:after.height,top:after.top,borderLeft:after.borderLeftWidth,borderRight:after.borderRightWidth},'
  +'boxBorder:getComputedStyle(box).borderTopWidth,boxOverflow:getComputedStyle(box).overflow};'
  +'document.querySelector("#geometry-report").textContent=JSON.stringify(data);'
  +'});</script>';
 return '<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style>'
  +'<style>.bg-nebula,.hunter-banner{background-image:none!important}.app{width:100%;max-width:none!important;padding:0!important}.sticky-nav{margin:0!important;padding:0!important}.hunter-banner{margin:0!important}body{margin:0!important}</style>'
  +'</head><body><div class="app"><div class="sticky-nav">'+cleanHeader+'</div></div><pre id="geometry-report"></pre>'+script+'</body></html>';
}

test('real browser: classic neon title box remains centered and symmetric on desktop/tablet/Android',{skip:!chrome},()=>{
 assert.ok(header);
 const dir=mkdtempSync(join(tmpdir(),'nebula-title-frame-'));
 try{
  const file=join(dir,'header.html');writeFileSync(file,fixture());
  for(const [w,h] of [[1773,900],[1366,768],[1024,768],[390,844],[375,667]]){
   const run=spawnSync(chrome,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--window-size='+w+','+h,'--virtual-time-budget=700','--dump-dom','file://'+file],
    {encoding:'utf8',timeout:25000,maxBuffer:4*1024*1024});
   assert.equal(run.status,0,'Chrome unable to load '+w+'×'+h+': '+run.stderr?.slice(-350));
   const found=run.stdout.match(/<pre id="geometry-report">([^<]+)<\/pre>/);
   assert.ok(found,'No title geometry returned for '+w+'×'+h);
   const x=JSON.parse(found[1].replace(/&quot;/g,'"'));
   const eps=1.1;
   assert.ok(Math.abs(x.banner.cx-x.box.cx)<eps,'Title frame off-center X '+JSON.stringify(x));
   assert.ok(Math.abs(x.banner.cy-x.box.cy)<eps,'Title frame off-center Y '+JSON.stringify(x));
   assert.ok(Math.abs(x.box.cx-x.title.cx)<eps,'Title text off-center '+JSON.stringify(x));
   assert.ok(Math.abs(x.box.cx-x.subtitle.cx)<eps,'Tagline off-center '+JSON.stringify(x));
   assert.ok(x.title.x>=x.box.x-1&&x.title.r<=x.box.r+1,'Title exceeds its neon frame '+JSON.stringify(x));
   assert.ok(x.subtitle.x>=x.box.x-1&&x.subtitle.r<=x.box.r+1,'Tagline exceeds its frame '+JSON.stringify(x));
   assert.ok(x.box.y>=x.banner.y-1&&x.box.b<=x.banner.b+1,'Header box vertically clipped '+JSON.stringify(x));
   assert.ok(Math.abs(parseFloat(x.before.height)-parseFloat(x.after.height))<eps,'Asymmetric corner heights '+JSON.stringify(x));
   assert.ok(Math.abs(parseFloat(x.before.width)-parseFloat(x.after.width))<eps,'Asymmetric corner widths '+JSON.stringify(x));
   assert.equal(x.before.top,x.after.top,'Brackets have different vertical anchors');
   assert.equal(x.boxBorder,'1px');
   assert.ok(x.box.w>165&&x.box.h>40,'Neon frame too small '+JSON.stringify(x));
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
});
