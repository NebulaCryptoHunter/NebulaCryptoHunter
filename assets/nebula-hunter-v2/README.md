# NEBULA Crypto Hunter — HUD Assets V2

**Tanggal:** 1 November 2026  
**Tema:** `HUNT BEFORE THE HYPE.` · Cyberpunk spaceship tactical HUD  
**Status:** Asset library only — **not deployed into existing HUD**.

## Empat gambar independen

| No. | File | Dimensi intrinsik | Background | Penempatan |
|---|---|---|---|---|
| 01 | `01_background_nebula.svg` | 1920×1080 | Opaque | Background penuh, `background-size:cover` |
| 02 | `02_spaceship_hunter.svg` | 1200×700 | Transparan | Header atas-kiri, jangan menutupi navigasi |
| 03 | `03_planet_hologram.svg` | 1000×1000 | Transparan | Dekorasi planet di bagian kanan atas |
| 04 | `04_cockpit_console.svg` | 1920×620 | Transparan | Foreground bagian bawah / footer HUD |

**Keempat aset merupakan SVG resolusi fleksibel**, bukan screenshot dashboard atau data riset. SVG dapat dipakai langsung oleh browser dan tetap tajam pada layar desktop maupun Android. Tidak mengandung statistik buatan, teks angka, atau tombol sehingga UI asli tetap interaktif.

## Susunan layer yang disarankan

```
z-index: 0   -> 01_background_nebula.svg (background)
z-index: 1   -> 03_planet_hologram.svg (kanan, opsional pada mobile)
z-index: 1   -> 02_spaceship_hunter.svg (kiri, opsional pada mobile)
z-index: 2   -> dashboard HTML/CSS dan radar interaktif asli
z-index: 3   -> 04_cockpit_console.svg (hiasan footer; pointer-events:none)
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
  background-image: url('/assets/nebula-hunter-v2/01_background_nebula.svg');
  background-size: cover;
  background-position: center;
}
```

**Catatan deployment:** Jalur `/assets/...` baru bisa dipakai di website bila konfigurasi static asset Worker telah menyajikan folder tersebut. Saat ini yang dijamin adalah file tersimpan di GitHub; tidak ada perubahan jalur produksi.

## Penjagaan NEBULA

- Sumber statistik tetap database D1 produksi asli.
- SCAN / SINKRON / AUTO tidak dimodifikasi.
- Tidak mengubah Workers, scan interval, GitHub pipeline, credential, D1, maupun AI.
- Aset SVG baru merupakan ilustrasi artistik (bukan pratinjau radar/data sesungguhnya).
