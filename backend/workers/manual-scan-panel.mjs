// Dedicated manual scan UI. Only displayed when /api/auth/me confirms SUPER_ADMIN.
export const manualScanPanel = `
<section id="nebulaManualScan" aria-label="Pemindaian manual Admin" style="margin:6px 0;color:#b9e6ee;font:11px 'Share Tech Mono',monospace">
<style>
#nebulaManualScan details{background:#061725;border:1px solid #145777;border-radius:7px;padding:8px 10px}
#nebulaManualScan summary{cursor:pointer;color:#53def3;font-weight:700}
#nebulaManualScan p{line-height:1.5}
#nebulaManualScan label{display:block;margin:8px 0 5px}
#nebulaManualScan input{box-sizing:border-box;width:100%;padding:10px;background:#091e31;color:#e6fbff;border:1px solid #267b93;border-radius:5px}
#nebulaManualScan button{margin:10px 0;padding:10px;background:#07425b;border:1px solid #2ab7d3;border-radius:5px;color:#f1fbff;cursor:pointer}
#nebulaManualScan button:disabled{opacity:.5;cursor:wait}
#nebulaManualForm[hidden]{display:none}
#nebulaManualScanResult{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
<details>
<summary>◈ SCAN MANUAL · ADMIN</summary>
<p id="nebulaManualStatus" role="status">Memeriksa izin Admin dan layanan scanner…</p>
<form id="nebulaManualForm" hidden>
<label for="nebulaManualMints">Alamat mint Solana (maksimal 5, pisahkan dengan koma)</label>
<input id="nebulaManualMints" autocomplete="off" spellcheck="false" placeholder="Masukkan mint token Solana" required>
<button type="submit">PINDAI &amp; SIMPAN OBSERVASI</button>
</form>
<div id="nebulaManualScanResult" role="status" aria-live="polite"></div>
<p style="color:#8fb4c4">Hasil pemindaian hanya untuk penelitian. WATCH bukan sinyal beli; tidak ada transaksi otomatis.</p>
</details>
</section>
<script>
(()=>{const get=id=>document.getElementById(id);const panel=get('nebulaManualScan');if(!panel||panel.dataset.ready)return;panel.dataset.ready='1';
const form=get('nebulaManualForm'),status=get('nebulaManualStatus'),result=get('nebulaManualScanResult');
const mintOK=s=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
async function init(){
 try{
  const [session,health]=await Promise.all([fetch('/api/auth/me',{cache:'no-store'}),fetch('/health',{cache:'no-store'})]);
  const user=await session.json(),state=await health.json();
  if(!session.ok||user.user?.role!=='SUPER_ADMIN'){status.textContent='Masuk sebagai Admin pada halaman Akun NEBULA untuk memindai. SINKRON tetap tersedia untuk semua pengguna.';return;}
  if(!health.ok||!state.manualScanAvailable){status.textContent='Akun Admin aktif, tetapi scanner manual belum siap. Scanner otomatis tetap berjalan.';return;}
  form.hidden=false;status.textContent='Admin terverifikasi. Scan manual dapat membaca maksimal 5 mint dan menyimpan observasi ke server.';
 }catch{status.textContent='Tidak dapat memverifikasi akun atau layanan. Coba muat ulang halaman.';}
}
form.addEventListener('submit',async e=>{
 e.preventDefault();const mints=[...new Set(get('nebulaManualMints').value.split(',').map(x=>x.trim()).filter(Boolean))];
 if(!mints.length||mints.length>5||!mints.every(mintOK)){result.textContent='Alamat mint tidak valid. Isi 1–5 alamat Solana dengan benar.';return;}
 const button=form.querySelector('button');button.disabled=true;result.textContent='Menghubungi scanner…';
 try{
  const response=await fetch('/api/research/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mints})});
  const data=await response.json();
  if(!response.ok){const code=data.error||'FAILED';const first=data.results?.find(x=>x.detail)?.detail;result.textContent='Scan belum berhasil: '+code+(first?' · '+first:'')+'. Periksa status API atau coba kembali sesuai cooldown.';return;}
  const lines=(data.results||[]).map(x=>x.mint.slice(0,10)+'… · '+x.observations+' observasi · '+(x.persisted?'tersimpan':'belum tersimpan'));
  result.textContent='Scan selesai. '+data.totalObservations+' observasi diproses.\\n'+lines.join('\\n')+'\\nGunakan tombol SINKRON untuk memperbarui dashboard.';
 }catch{result.textContent='Koneksi scanner gagal. Tidak ada hasil yang dapat dipastikan.'}
 finally{button.disabled=false;}
});
init();
})();
</script>`;
