# NEBULA Crypto Hunter — Desktop HUD v111

Tanggal: 1 November 2026. Perbaikan frontend responsif berdasarkan screenshot desktop (Edge 1780px).

## Masalah yang diverifikasi
- CSS asli membatasi `.app` maksimum 740px bahkan pada monitor besar.
- Header sangat tinggi dan sticky pada desktop, menghalangi konten ketika scroll.
- Kartu token menggunakan `overflow:hidden`, bisa memotong badge/teks dan detail panjang.
- Semua grup TRADING/PERFORMANCE/DATABASE selalu tersusun vertikal, menambah tinggi awal.
- Area popup `.overlay-content` memakai tinggi dan scroll terpisah, memotong informasi panjang.

## Perbaikan (presentasi saja)
- Lebar konten tablet+ mengikuti viewport (maksimum 1480px), tetap berada di tengah.
- Header desktop non-sticky; panel provider dan kontrol lebih ringkas.
- Desktop 1024px+ menampilkan tiga grup metrik sejajar.
- Desktop 1200px+ menampilkan 12 indikator provider dalam satu baris; kontrol SCAN/SINKRON/AUTO tetap utuh pada baris kompak.
- Token card pada desktop 1200px+ disusun dalam dua kolom. Kartu dengan detail terbuka melebar dua kolom agar semua modul telemetri terbaca dalam tiga kolom.
- Badge, judul token, baris tindakan dan angka kini dapat membungkus teks tanpa disembunyikan.
- Popup desktop menggunakan satu jalur scroll halaman overlay, bukan double scrolling yang memotong bagian bawah.
- Mobile di bawah 768px menggunakan gaya lama, termasuk detail satu kolom dan navigasi non-sticky.

## Keamanan dan kompatibilitas
Tidak mengubah backend, Cloudflare Worker bindings, cron scanner, AI scoring, evaluasi, riwayat prediksi, login, D1, atau logika SCAN/SINKRON/AUTO. Tidak membuat data tiruan. Perubahan meliputi CSS adaptif dan tes regresi statis.

## QA
GitHub CI harus lulus dan script JS halaman tetap parse. Setelah merge cek active Cloudflare deployment dan konten `NEBULA Desktop HUD v111`. Uji secara visual di Edge desktop resolusi 1366px, 1600px, 1920px serta mobile 390px; pengujian browser interaktif memerlukan sesi UI dan belum dapat diklaim hanya dari tes kode.
