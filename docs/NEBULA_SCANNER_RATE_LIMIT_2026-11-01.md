# NEBULA Scanner — penyebab HTTP 429 dan perbaikan umpan balik (1 November 2026)

## Temuan produksi (read-only)
- 13:00 WIB: pemindaian cron sukses 12 kandidat, 2 snapshot.
- 13:30 WIB: pemindaian cron menghadapi batch pricing HTTP 429 dari upstream dan menerapkan 60 menit backoff.
- 14:23 WIB: pemindaian manual menghasilkan status RATE_LIMITED tanpa permintaan upstream baru karena backoff belum berakhir.
- 14:30 WIB: cron dimulai beberapa detik sebelum cooldown berakhir, sehingga tetap RATE_LIMITED tanpa permintaan upstream.
- Data historis 6.952 prediksi dan 205 snapshot aman ketika diperiksa.
- Keterbatasan berasal dari provider upstream, tidak boleh diakali dengan permintaan agresif.

## Koreksi logika
- Pemindaian SCAN manual kini memeriksa `scanner_state.cooldown_until` terlebih dahulu; ketika cooldown aktif, langsung merespons HTTP 429 `PROVIDER_COOLDOWN` dengan `retryAt` dan **tidak membuat record run manual** sehingga tidak menghabiskan jatah satu putaran per interval 15 menit.
- Status `SKIPPED_DUPLICATE` kini dibedakan sebagai `MANUAL_SCAN_COOLDOWN` dan memberi waktu interval 15 menit berikutnya.
- Frontend gateway meneruskan status dan `retryAt` yang valid, tanpa mengekspos secret atau payload sumber.
- Antarmuka SCAN menampilkan alasan dalam bahasa Indonesia dan waktu berikutnya dalam zona Asia/Jakarta jika diketahui. Hindari mengklaim berhasil saat masih 429.
- Cron otomatis tiap 30 menit tetap aktif. Status dan data lama tidak diubah. Tidak ada pemindaian otomatis tambahan atau transaksi kripto.

## Validasi
- Tes integrasi: cooldown awal tidak melakukan penulisan ke D1, kode provider vs manual dibedakan, `retryAt` diteruskan, kredensial tidak bocor.
- Tes lama untuk UI Desktop v111, admin, pipeline dan cron harus tetap lulus.
- Setelah merge deploy Worker frontend lewat pipeline; Worker `nebula-scanner` secara terpisah dengan binding dan cron tetap sama.
- Audit status produksi, jangan menghapus atau mengubah snapshot historis.
