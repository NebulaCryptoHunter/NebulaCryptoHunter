# NEBULA — audit dan perbaikan algoritma V2

Tanggal: 1 November 2026. Model baru: `heuristic-v2.0.0`; pengukur return legacy: `V111.0.0`.

## Temuan dan koreksi

| Masalah terverifikasi dari kode | Koreksi |
|---|---|
| Skor V1 hanya memakai volume/likuiditas dan kenaikan 24 jam. Volume tinggi tetap menaikkan skor ketika harga jatuh. | Komponen likuiditas, aktivitas yang dibatasi, momentum pendek, serta tekanan beli yang diperkecil menuju netral untuk sampel kecil. Penurunan, tekanan jual, turnover ekstrem dan momentum terlalu panas diberi penalti eksplisit. |
| Nilai transaksi yang hilang berubah menjadi nol. Field m5/h1 dibuang. | Satu normalizer bersama mempertahankan m5/h1/h24; nilai hilang tetap null. Boolean, angka tidak valid dan harga nonpositif tidak diperlakukan sebagai data pasar valid. |
| Pool dengan rasio volume/likuiditas tinggi diprioritaskan meskipun dangkal. | Prioritas pool menurut likuiditas, kemudian volume; pasangan duplikat dibuang. Identitas mint tetap peka huruf besar/kecil. |
| Rotasi 12 mint per 30 menit dapat kembali ke token terlalu lambat untuk evaluasi 30–90 menit. | Hingga enam slot diprioritaskan untuk kandidat yang perlu diamati ulang; sisa slot meneruskan rotasi/discovery. Batas total tetap 12 mint, jadwal tetap 30 menit. |
| Jumlah snapshot dilaporkan dari jumlah item yang dicoba, termasuk INSERT OR IGNORE yang tidak menambah baris. | Jumlah snapshot baru diambil dari meta.changes hasil batch D1 untuk statement snapshot. |
| Skor AI dapat disimpan tanpa memvalidasi rentang atau keputusan hasil worker. | Validasi identitas, model, keputusan dan skor 0–100; INSUFFICIENT_DATA harus score=null. |
| Evaluasi SQL dapat menerima teks atau boolean JSON sebagai harga dan mencampur payload dengan identitas baris berbeda. | Harga harus bertipe JSON integer/real, positif, dengan identitas payload sama; waktu masa depan, JSON rusak dan window yang salah ditolak. Pilihan exit memakai waktu lalu id sebagai pemecah seri. |
| Ukuran yang tidak teramati (drawdown, ATH, sustainability, confidence) diisi angka bawaan dan digabung menjadi success score. Kerugian besar disebut rugged tanpa bukti on-chain. | Simpan return titik pengamatan; ukuran yang tidak teramati null. Outcome POSITIVE_RETURN/NEGATIVE_RETURN/FLAT tidak mengklaim rug pull, ATH atau trade P&L. |
| Precision/recall/F1 memakai penyebut berbeda dan menjumlahkan beberapa window untuk satu prediksi. | TP/FP/FN/TN dari satu window 30m, satu pengukuran V111 per prediksi; WATCH adalah abstain. Denominator kosong menghasilkan null. API statistik membaca definisi yang sama. |
| Worker API mempunyai implementasi evaluasi dan pembaruan bobot lain yang dapat menyimpang dari evaluator utama. | Worker API mendelegasikan cron ke evaluator bersama. Pembaruan bobot otomatis yang tidak memiliki atribusi fitur atau uji di luar sampel tidak dipakai. |
| Browser masih mempunyai jalur rumus lama yang dapat menghitung ulang observasi server. | Observasi server tidak masuk enrichment/perhitungan lama di browser. Skor server dipertahankan. |
| D1 limit membuat feed hanya berisi harga tanpa pemeringkatan walaupun data pool memadai. | Feed sementara memakai normalizer dan scorer V2 yang sama secara lokal di Worker, tanpa biaya inferensi. Data price-only tetap tidak memiliki skor/pool/likuiditas rekaan. |

## Definisi pemeringkatan

Bobot awal yang **belum dilatih atau divalidasi**: likuiditas 30%, aktivitas 20%, momentum 25%, tekanan beli 25%. Aktivitas dibatasi dengan logaritma; tekanan beli memakai shrinkage Beta(10,10). Komponen yang tidak tersedia tidak diisi keyakinan rekaan. Penalti dan syarat REVIEW dijelaskan melalui reasons/riskFlags.

REVIEW adalah prioritas pemeriksaan riset; model tidak mengeluarkan BUY atau STRONG_BUY. Data inti tidak valid menghasilkan INSUFFICIENT_DATA dan score=null. Keyakinan probabilistik, peluang untung, dan target multiplier tetap null. REVIEW memerlukan data segar, likuiditas minimum, sampel transaksi memadai, momentum pendek positif, tidak ada flag risiko pasar, serta verifikasi risiko.

Ambang operasional awal meliputi umur observasi maksimum 15 menit, minimum 20 transaksi untuk REVIEW, dan minimum likuiditas REVIEW USD50.000. Angka tersebut adalah kebijakan penelitian sementara, bukan hasil optimasi laba atau bukti akurasi.

## Evaluasi dan batas data

Audit historis yang benar-benar dibaca (`NEBULA_AUDIT_HISTORIS_RINGKAS.json`) memuat 2.812 observasi hasil deduplikasi, 235 mint yang terisi, 59 pool dengan minimal dua harga bertimestamp, dan 547 pasangan berurutan dalam 180 menit. Banyak pasangan tidak memiliki mint lengkap. CSV trajektori hanya berisi identitas/harga/waktu/return; tidak menyediakan seluruh fitur sebelum kejadian untuk menguji scorer V2. Jumlah pasangan tersebut bukan jumlah sinyal prospektif yang benar.

Karena itu tidak ada klaim peningkatan win rate, ketepatan deteksi pump atau validasi H1–H14. Bobot tidak di-fit pada contoh yang baru dilihat. `NEBULA_ALGORITHM_V2_REAL_INPUT_SAMPLE.json` adalah perbandingan pada satu observasi pasar nyata, bukan backtest atau prediksi sebelum dump. Contoh tersebut juga sudah berada di bawah filter likuiditas scanner.

Return riset baru tetap merupakan harga pool yang sama pada pengamatan pertama 30–90 menit berikutnya, bukan harga eksekusi, OHLCV, ATH atau profit transaksi. Evaluasi legacy mempunyai pool entry yang tidak tercatat; catatan ini dipertahankan dalam notes dan tidak dijadikan validasi model baru. Sampel masa depan yang hilang tidak diubah menjadi sukses maupun rugi.

## Validasi teknis

- 131 tes lulus, termasuk tes kebijakan legacy yang kini dimasukkan ke CI.
- Kasus mencakup volume tinggi saat harga jatuh, momentum terlalu panas, data hilang/boolean/overflow, tekanan beli sampel kecil, sumber data basi/masa depan, identitas mint/pool, slot pengamatan ulang, null untuk ukuran tak teramati, hitung ganda antar-window, rentang skor, dan fallback harga dengan anggaran request terbatas.
- Pengujian SQL memakai SQLite nyata, termasuk eksekusi INSERT evaluator dan query confusion matrix. Uji integrasi menjalankan scanner, handler AI Worker, penyimpanan skor, trigger kandidat, dan penolakan slot duplikat bersama-sama.
- Model V2 dan API adapter diuji di staging. Feed price-only tetap score=null bila tidak ada pool yang memenuhi filter.
- Uji dan deployment memakai source content; binding, secret dan jadwal tidak diganti. Semua integrasi tetap pada mode gratis.
- Persistensi cron dan pengumpulan hasil prospektif setelah reset kuota D1 masih perlu dibuktikan oleh pengamatan berikutnya. Data historis tidak dihapus atau dihitung ulang sebagai hasil V2.

Rujukan definisi metrik: https://scikit-learn.org/stable/modules/model_evaluation.html
Rujukan pencegahan kebocoran data: https://scikit-learn.org/stable/common_pitfalls.html
