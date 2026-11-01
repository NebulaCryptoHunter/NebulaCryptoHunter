# NEBULA — Tahap 01: Konsistensi Sinkronisasi Frontend

Tanggal: 1 November 2026 (WIB)

## Sasaran
Menghindari tombol SCAN yang seolah-olah menjalankan scanner manual padahal hanya membaca snapshot yang sudah tersimpan; menyamakan konfigurasi evaluation di GitHub dengan database produksi.

## Perubahan
1. Tombol HUD **SCAN** diganti menjadi **SINKRON**; keterangan secara eksplisit menyebut refresh data D1, bukan pemindaian token baru.
2. Hapus keterangan yang salah "Admin sementara NONAKTIF"; status Admin aktual ditentukan oleh server/autentikasi.
3. Konfigurasi `backend/wrangler.evaluation.jsonc` mengikat `DB` dan `RESEARCH_DB` ke database produksi yang sama, `nebula-db` (`6eeadd5e-5e58-4a8c-90d9-92d039438a8f`).
4. Regression test memeriksa label sinkronisasi, pesan status, dan kedua binding D1.

## Verifikasi yang diperlukan
- GitHub Actions: `NEBULA V1 regression` harus sukses.
- Setelah deployment frontend dilakukan, GET `/health`, GET `/api/research/latest`, dan tombol SINKRON diverifikasi pada browser desktop dan Android.
- Cron scanner produksi harus tetap berjalan `*/30 * * * *` dan data historis `predictions` tidak berubah akibat deployment.

## Batas tahap
Perubahan GitHub ini **tidak** mengaktifkan scan manual. Endpoint POST `/api/research/scan` tetap membutuhkan sesi SUPER_ADMIN, binding SCANNER, dan INTERNAL_TOKEN yang belum dikonfigurasi pada frontend produksi. Pengaktifan manual scan harus dilakukan sebagai tahap terpisah agar rahasia server tidak terungkap dan jadwal scanner tidak terganggu.

## Keamanan
Tidak ada perubahan pada isi database, token akses, pemindaian terjadwal, atau Worker production dalam commit tahap 01. Database lama tetap tersedia untuk pemulihan.
