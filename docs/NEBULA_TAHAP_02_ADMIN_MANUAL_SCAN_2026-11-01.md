# NEBULA Tahap 02 — Aktivasi Admin dan Scanner Manual

Tanggal: 1 November 2026 (WIB)

## Arsitektur dan proteksi
- Frontend `nebulacryptohunter` memanggil scanner produksi melalui Cloudflare **Service Binding** `SCANNER`.
- Hanya sesi `SUPER_ADMIN` terautentikasi yang boleh memanggil `POST /api/research/scan`; cookie HttpOnly dan pemeriksaan Origin tetap berlaku.
- Hanya 1–5 mint Solana valid (Base58) per permintaan; identitas mint dipertahankan case-sensitive.
- Credential khusus `MANUAL_SCAN_TOKEN` tersimpan sebagai **secret** pada frontend dan scanner, tidak pernah di-commit atau dikirim ke browser. Tidak memakai `INTERNAL_TOKEN` cron/AI.
- Scanner menerima token khusus tersebut hanya di endpoint `/pipeline`; `/run` tetap membutuhkan `INTERNAL_TOKEN`.
- Hasil HTTP dipadatkan menjadi status, jumlah observasi, dan indikator persistensi; tidak mengekspos payload provider atau secret. Status 429 tidak dilaporkan sukses.
- UI `SCAN MANUAL · ADMIN` terpisah dari tombol `SINKRON` untuk pembacaan D1.

## Aktivasi akun
- Auth DB terpisah `nebula-auth-stage`; akun SUPER_ADMIN belum tersedia saat audit.
- Aktivasi pertama menggunakan token sekali pakai yang **hanya disimpan sebagai SHA-256** pada `auth_activation_tokens`, dikirim ke pemilik email terverifikasi, dan kedaluwarsa dalam 24 jam.
- Password Admin harus dipilih oleh pemilik melalui halaman `/account#<token>` (minimal 12 karakter); jangan minta atau simpan password di chat, Gmail, GitHub, dan Cloudflare config.
- Login belum dianggap aktif sampai pengguna menyelesaikan aktivasi dan sesi dapat diuji.

## Deployment dan rollback
1. Jalankan GitHub regression tests pada PR, cek status.
2. Deploy kode frontend dan scanner via pipeline yang sudah ada (hanya setelah lulus tes).
3. Konfigurasikan `MANUAL_SCAN_TOKEN` yang sama pada 2 Worker sebagai secret (tanpa mencetak nilai), pertahankan binding produksi lain, cron `*/30 * * * *`, dan historical D1.
4. Periksa active deployed version, service binding, endpoint `/health`, login protection, dan D1 counts.
5. Jika scanner utama bermasalah, rollback kedua Worker ke versi terakhir yang diketahui sehat, **jangan restore/overwrite database D1**.

## Batasan
- Endpoint manual memanggil provider publik DexScreener; HTTP 429 atau tidak adanya pool valid dapat menghasilkan nol observasi, bukan error database.
- Tidak ada auto trading.
- Aktivasi Admin memerlukan tindakan pemilik email melalui tautan pribadi; tidak ada password default.
