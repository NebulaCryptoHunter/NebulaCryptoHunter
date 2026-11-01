# NEBULA Crypto Hunter — HUD Assets V2

**Tanggal:** 1 November 2026  
**Tema:** `HUNT BEFORE THE HYPE.` · Cyberpunk spaceship tactical HUD  
**Status:** Four HD original WebP assets now used by the Hunter frontend.

## Empat gambar independen

| No. | File | Dimensi intrinsik | Background | Penempatan |
|---|---|---|---|---|
| 01 | `01_background_nebula_hd.webp` | 1672×941 | Opaque | Background penuh, `background-size:cover` |
| 02 | `02_spaceship_hunter_hd.webp` | 1536×1024 | Transparan | Header atas-kiri, jangan menutupi navigasi |
| 03 | `03_planet_hologram_hd.webp` | 1254×1254 | Transparan | Dekorasi planet di bagian kanan atas |
| 04 | `04_cockpit_console_hd.webp` | 2172×724 | Transparan | Foreground bagian bawah / footer HUD |

**Empat aset HD merupakan gambar WebP asli**, tiga dengan transparansi. Bukan screenshot dashboard atau data riset; semua tombol tetap berasal dari kode.

## Susunan layer yang disarankan

```
z-index: 0   -> 01_background_nebula_hd.webp (background)
z-index: 1   -> 03_planet_hologram_hd.webp (kanan, opsional pada mobile)
z-index: 1   -> 02_spaceship_hunter_hd.webp (kiri, opsional pada mobile)
z-index: 2   -> dashboard HTML/CSS dan radar interaktif asli
z-index: 3   -> 04_cockpit_console_hd.webp (hiasan footer; pointer-events:none)
```

Gunakan `pointer-events:none` pada semua aset dekoratif. Beri lapisan gelap transparan antara background dan kartu data supaya teks tetap terbaca. Jangan membuat layar atau tombol bergambar yang menggantikan kontrol aplikasi.

## Cara ambil gambar dari GitHub

Setelah PR aset digabung ke `main`, gunakan prefix:

```
https://raw.githubusercontent.com/NebulaCryptoHunter/NebulaCryptoHunter/main/assets/nebula-hunter-v2/
```

Contoh:

```css
.nebula-backdrop {
  background-image: url('/assets/nebula-hunter-v2/01_background_nebula_hd.webp');
  background-size: cover;
  background-position: center;
}
```

**Catatan deployment:** Jalur `/assets/...` baru bisa dipakai di website bila konfigurasi static asset Worker telah menyajikan folder tersebut. Saat ini yang dijamin adalah file tersimpan di GitHub; tidak ada perubahan jalur produksi.

## Penjagaan NEBULA

- Sumber statistik tetap database D1 produksi asli.
- SCAN / SINKRON / AUTO tidak dimodifikasi.
- Tidak mengubah Workers, scan interval, GitHub pipeline, credential, D1, maupun AI.
- Aset WebP baru merupakan ilustrasi artistik (bukan pratinjau radar/data sesungguhnya).
