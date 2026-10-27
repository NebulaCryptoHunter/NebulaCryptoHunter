import {researchPanel} from './research-panel.mjs';
// Compatibility transform for the retained Workers asset bundle; idempotent.
export function transformFrontend(html){
 if(html.includes('<!-- RESEARCH_PANEL -->'))return html.replace('<!-- RESEARCH_PANEL -->',researchPanel);
 if(html.includes('NEBULA_SECURE_FRONTEND_V1'))return html;
 html=html.replace(/apiKey:'[^']*'/g,"apiKey:''");
 html=html.replaceAll('https://nebula-api.nebula-crypto-proxy.workers.dev','');
 html=html.replace("const safeValue=v=>(v!==undefined&&v!==null&&!Number.isNaN(v));","const safeValue=v=>typeof v==='number'&&Number.isFinite(v);");
 html=html.replace("StorageInterface.save(cacheKey,{price:token.price", "StorageInterface.save(cacheKey,{ca:token.ca,price:token.price");
 // Escape token names only at HTML sinks; plain text/database values retain their identity.
 html=html.replace("const getName=t=>", "const escapeHTML=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));\nconst getName=t=>");
 html=html.replaceAll("'+getName(t)+'", "'+escapeHTML(getName(t))+'");
 html=html.replaceAll("'+getName(token)+'", "'+escapeHTML(getName(token))+'");
 html=html.replace("(t?getName(t):w.token_ca?.slice(0,8)||'???')", "escapeHTML(t?getName(t):w.token_ca?.slice(0,8)||'???')");
 html=html.replace("async function apiPost(path,data){try{", "async function apiPost(path,data){if(!window.NEBULA_CAN_WRITE)return null;try{");
 const panel=`<!-- NEBULA_SECURE_FRONTEND_V1 --><section style="padding:12px;color:#dcecff;background:#071426;font:13px system-ui"><a href="/account" style="color:#00ffff">Akun NEBULA</a> · <span id="sessionStatus">Memeriksa sesi…</span><details><summary>Hasil scanner server</summary><p>Data tersimpan; waktu pengamatan ditampilkan. Pemindaian otomatis setiap 30 menit; cakupan terbatas pada kandidat profil terbaru dan token pantauan.</p><form id="serverScan"><label>Alamat token Solana (maks. 5, pisahkan koma)<input id="serverMints" style="width:95%;padding:8px" required></label><button>Scan manual</button></form><p id="scanStatus"></p><div id="serverResults"></div></details></section><script>
(async()=>{window.NEBULA_CAN_WRITE=false;try{const r=await fetch('/api/auth/me',{cache:'no-store'});const d=await r.json();window.NEBULA_CAN_WRITE=r.ok&&d.user?.role==='SUPER_ADMIN';document.getElementById('sessionStatus').textContent=window.NEBULA_CAN_WRITE?'Admin aktif':'Mode baca — masuk untuk menyimpan';}catch{document.getElementById('sessionStatus').textContent='Sesi tidak tersedia; mode baca';}
async function refresh(){try{const r=await fetch('/api/research/latest',{cache:'no-store'}),d=await r.json();const target=document.getElementById('serverResults');target.replaceChildren();for(const x of d.items||[]){const row=document.createElement('p');row.textContent=[x.mint,x.decision||'BELUM DINILAI','Skor: '+(x.score??'—'),x.observed_at].join(' | ');target.append(row)}if(!d.items?.length)target.textContent='Belum ada snapshot.';}catch{document.getElementById('scanStatus').textContent='Data server tidak dapat dimuat';}}
document.getElementById('serverScan').onsubmit=async e=>{e.preventDefault();const status=document.getElementById('scanStatus');if(!window.NEBULA_CAN_WRITE){status.textContent='Masuk sebagai admin dahulu.';return}const mints=document.getElementById('serverMints').value.split(',').map(s=>s.trim()).filter(Boolean);const btn=e.target.querySelector('button');btn.disabled=true;try{const r=await fetch('/api/research/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mints})});const d=await r.json();status.textContent=r.ok?'Pemindaian selesai.':(d.error||'Pemindaian gagal');await refresh()}catch{status.textContent='Koneksi gagal'}finally{btn.disabled=false}};await refresh();})();
</script>`;
 return html.replace('<body>','<body>'+panel);
}
