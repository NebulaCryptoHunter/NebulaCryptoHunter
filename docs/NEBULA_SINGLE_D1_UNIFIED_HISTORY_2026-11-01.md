# NEBULA — Satu sumber database riset produksi
Tanggal 1 November 2026 · Tahap penyatuan data (tanpa penyalinan dan tanpa penghapusan)

## Hasil audit sebelum perubahan
- Semua Worker penelitian utama (`nebulacryptohunter` RESEARCH_DB, `nebula-api` DB, `nebula-scanner` STAGE_DB, `nebula-ai-engine` STAGE_DB, `nebula-evaluation` DB/RESEARCH_DB) memakai satu D1 produksi **nebula-db**, ID `6eeadd5e-5e58-4a8c-90d9-92d039438a8f`.
- `predictions`: 6.952 rekaman historis; `prediction_candidates`: 206 kandidat penelitian baru; `scanner_snapshots`: 206 observasi harga/pool yang menjadi bukti pendamping; `evaluations`: 86 evaluasi legacy dan `candidate_evaluations`: 56 evaluasi kandidat.
- Sebanyak 206 kandidat punya snapshot pasangan yang cocok pada mint, pair, observed_at. Snapshots TIDAK dihitung lagi sebagai prediksi.
- Tidak ada mint kandidat scanner yang cocok dengan mint pada data legacy ketika audit dijalankan. Tetap pertahankan identitas source terpisah untuk perbandingan ilmiah.

## Desain kanonis
- `nebula_unified_records_v1`: VIEW SQLite baca-saja **UNION ALL** prediksi historis dan kandidat modern. Tidak menyalin data, tidak membuat 6.952 prediksi baru, dan tidak mengubah nilai historis.
- `record_key`: `legacy:<id>` atau `scanner:<id>` untuk menghindari bentrok ID; `record_source` selalu LEGACY atau SCANNER.
- API publik baru `GET /api/research/history?limit=25&offset=0` (maks 100) dibaca langsung dari `RESEARCH_DB=nebula-db`. Frontend berhenti menggunakan dua API berbeda untuk riwayat dan statistik gabungan.
- `/api/research/latest` mengembalikan hitungan `legacy_predictions`, `candidates`, `total_records`, `total_evaluations`, `unique_mints`, dan counts snapshot lainnya. `DB` dan `PRED` HUD menggunakan total_records; `TOT` memakai unique_mints.
- Label `ARSIP LAMA` menjadi `DATABASE NEBULA`, satu linimasa 25 baris/halaman. Legacy dan scanner tetap diberi tag sumber, sehingga keputusan AVOID lama bukan label validasi pemindaian sekarang.
- `AUTH_DB` tetap terpisah secara sengaja sebagai isolasi keamanan login; bukan sumber data riset.

## Deployment aman
1. Pastikan CI, unit test SQLite, dan tidak ada regresi.
2. Terapkan `backend/migrations/0010_nebula_unified_read_model.sql` hanya ke `nebula-db`. CREATE VIEW IF NOT EXISTS bersifat aditif dan idempoten.
3. Validasi COUNT dari VIEW = COUNT predictions + COUNT prediction_candidates (dinamis), jumlah total snapshot tidak ditambahkan ke total prediksi.
4. Merge PR agar frontend Worker deploy otomatis dan verifikasi `/api/research/history` serta konten UI.
5. JANGAN melakukan migrasi COPY, DELETE, DROP tabel, atau update data historis. Cron scanner dan identitas database D1 tidak berubah.

## Risiko dan arti statistik
- Gabungan 7.158 adalah jumlah *catatan keputusan historis dan kandidat riset* saat audit; bukan 7.158 token unik, sinyal pump teruji, atau transaksi.
- WIN%, ROI, PREC, REC tidak otomatis valid setelah penggabungan: definisi evaluasi pada dua era berbeda dan sampelnya terbatas. Perlu metodologi terkalibrasi untuk agregasi metrik yang sah.
