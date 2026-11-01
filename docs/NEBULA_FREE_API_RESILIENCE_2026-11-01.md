# NEBULA — isolasi 12 koneksi API pada mode gratis

Tanggal: 1 November 2026. Produksi: https://nebulacryptohunter.nebula-crypto-proxy.workers.dev

## Penyebab

Scanner sebelumnya hanya memakai DexScreener. `scanner_state.cooldown_until` menghentikan seluruh putaran, termasuk permintaan manual, sehingga provider lain tidak pernah menggantikannya. Pemeriksaan status hanya mencakup 10 dari 12 koneksi. Solana RPC sebenarnya menggunakan endpoint Helius sehingga bukan cadangan independen. Retry HTTP 429 memperbanyak permintaan. Sebagian endpoint membutuhkan kredensial atau akses yang tidak tersedia pada paket gratis. Cloudflare D1 juga sudah mengembalikan kode 7500 (daily row read limit) ketika audit.

## Perubahan produksi

- Transport bersama tanpa retry 429, timeout mencakup pembacaan body, batas payload 2 MiB, cache sukses 30–60 detik, Retry-After detik maupun tanggal HTTP, serta cooldown per provider. Kredensial di-hash dalam identitas cache dan tidak dikembalikan ke browser.
- Penolakan paket HTTP 402 hanya memblokir endpoint tersebut, bukan endpoint gratis lain milik provider yang sama. CoinPaprika ticker gratis kembali berhasil.
- Scanner tetap memakai batch maksimal 12 mint. Ketika DexScreener dibatasi, GeckoTerminal menyediakan data pool yang cocok. Maksimal tiga permintaan token-pool cadangan per putaran. Identitas jaringan, base mint, quote mint, alamat pool, sumber dan waktu observasi dipertahankan.
- Helius dapat beralih ke RPC Solana publik dan endpoint Ankr bila dikonfigurasi. Respons HTTP 200 dengan error JSON-RPC tidak lagi dianggap sukses.
- Feed harga independen memakai Jupiter, CoinGecko, lalu Birdeye jika data pool tidak tersedia. Harga saja ditandai PRICE_ONLY; tidak diubah menjadi likuiditas, transaksi, snapshot pool, skor AI atau hasil evaluasi rekaan.
- Feed publik dapat tetap berjalan jika D1 dibatasi atau snapshot riset terakhir sudah lebih dari satu jam. Status LIVE_ONLY dan persisted=false berarti observasi belum tersimpan. Riwayat dan statistik historis tetap terpisah; jumlah historis tidak diganti angka nol atau hitungan token live.
- Jumlah agregat D1 dicache satu jam untuk mengurangi pemindaian ulang tabel historis pada tiap refresh HUD. Respons menyertakan countsAsOf.
- Status mencakup tepat 12 koneksi. Probe independen memakai maksimal empat koneksi sekaligus dan cache 10 menit. PumpPortal hanya menguji subscribeNewToken gratis; tidak ada langganan trade berbayar.
- Update dilakukan melalui endpoint Worker /content, sehingga binding, secret, database dan jadwal tidak diganti. Cron scanner tetap */30 * * * *.

## Hasil pemeriksaan produksi

Pemeriksaan 13:00:31 UTC / 20:00:31 WIB tercatat di `NEBULA_FREE_API_HEALTH_2026-11-01.json`.

| Koneksi | Status saat diperiksa | Fungsi / batasan |
|---|---|---|
| DexScreener | HEALTHY | Discovery dan pool batch |
| Helius | HEALTHY | RPC/on-chain |
| Jupiter | HEALTHY | Token dan harga; akses tanpa key berhasil |
| Birdeye | HEALTHY | Harga dengan key yang sudah ada |
| CoinGecko | HEALTHY | Harga umum/token yang tercakup |
| Rugcheck | HEALTHY | Data risiko; bukan pengganti harga |
| CoinPaprika | HEALTHY | Ticker gratis; cakupan kontrak token terpisah |
| PumpPortal WebSocket | HEALTHY | SubscribeNewToken berhasil diakui; koneksi probe ditutup |
| GeckoTerminal | RATE_LIMITED / 429 | Cooldown hanya sumber ini; lainnya tetap bekerja |
| Pump.fun REST | AUTH_ERROR / 403 | Endpoint v3 menolak request dari Worker; sumber lain tetap aktif |
| Solana RPC publik | AUTH_ERROR / 403 | Endpoint publik menolak request dari Worker; Helius masih sehat |
| Ankr | CONFIG_ERROR | ANKR_RPC_URL belum tersedia; perlu endpoint/key gratis milik pengguna |

Status bergantung pada cakupan, izin, lokasi server dan kuota masing-masing provider. Delapan koneksi sehat tidak berarti delapan sumber menyediakan data pool atau harga token yang identik. Tidak ada perubahan paket/billing atau upaya melewati penolakan provider.

## Verifikasi

- 108 tes lulus (`node --test tests/*.test.mjs backend/tests/*.test.mjs`).
- Uji nyata staging: GeckoTerminal HTTP 429 sementara DexScreener tetap memberi tiga token nyata.
- Uji nyata produksi: endpoint `/api/v1/market-feed` memberi token nyata, waktu sumber, WATCH, score=null dan persisted=false.
- Tes mencakup timeout, 429/Retry-After, HTTP 402 per endpoint, JSON-RPC error dalam HTTP 200, ketepatan huruf mint Solana, identitas pool, cadangan Gecko yang tetap disimpan saat Dex dibatasi, 12 status independen, feed saat D1 limit, dan feed harga tanpa likuiditas/skor rekaan.
- Binding produksi dan cron dibaca ulang setelah deployment. Tidak ada penghapusan atau migrasi data historis.
- Persistensi D1 setelah reset kuota dan pemulihan alami provider belum diverifikasi karena kuota masih dibatasi selama audit.

## Versi pemulihan sebelum perubahan

- API: 5594844c-c5b4-495f-af61-21c1f94cd843
- Scanner: faa411ed-5849-4e67-9d09-f4f1ba175a97
- Frontend: 774c87a6-e61d-4903-8f79-d3c08ffedf22
