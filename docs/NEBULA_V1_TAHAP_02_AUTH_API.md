# NEBULA V1 — Tahap 02: API dan Autentikasi

Status: **IN PROGRESS — kontrak disusun, implementasi belum lulus pengujian**.

## Bukti source (2026-10-27)
- Frontend `index.html`: `CONFIG.API.apiKey:''`, `apiGet` dan `apiPost` menyertakan `Authorization: Bearer <apiKey>`. Browser memanggil `/api/auth/me` untuk mengatur `NEBULA_CAN_WRITE` saat role `SUPER_ADMIN`.
- API `workers/nebula-api/worker.mjs` dalam PR #2: `AUTH_REQUIRED` memuat predictions, evaluations, heroes, watchlist, learning, market-regime; patch menolak GET dan POST tanpa `API_KEY`.
- Belum ada bukti bahwa sesi auth-stage dan API produksi sudah terintegrasi. **Jangan deploy patch GET auth sendirian.**

## Kontrak akses V1 yang harus diimplementasikan
1. Browser tidak pernah menerima `API_KEY`, `INTERNAL_TOKEN`, atau kredensial provider.
2. Semua mutasi menggunakan sesi server-side yang tervalidasi dan otorisasi per endpoint; `NEBULA_CAN_WRITE` hanya kontrol UI, bukan mekanisme keamanan.
3. Endpoint publik hanya menyediakan data agregat atau DTO read-only yang memang disetujui untuk publik; endpoint sensitif membutuhkan sesi. Tidak membuat seluruh `/api/v1` publik.
4. Browser mengakses API melalui origin/proxy yang benar-benar meneruskan cookie sesi dengan aman; tidak menyimpan bearer admin di localStorage.
5. CORS memakai allowlist origin; OPTIONS ditangani sebelum pemeriksaan autentikasi; cookie `HttpOnly; Secure; SameSite` sesuai origin deployment; CSRF protection pada mutasi cookie-based.
6. Server membatasi request body, pagination, metode, dan memberi 401/403/429/5xx terstruktur; tidak membocorkan token di log.
7. Scanner -> AI Engine menggunakan service binding + INTERNAL_TOKEN; tidak membuka endpoint internal ke browser.

## Endpoint yang harus diuji
| Endpoint | Read access | Write access |
|---|---|---|
| /api/v1/stats | public DTO terkurasi atau authenticated | tidak berlaku |
| /api/v1/predictions | authenticated kecuali DTO publik eksplisit | authenticated + role |
| /api/v1/watchlist | authenticated | authenticated + role |
| /api/v1/heroes | authenticated kecuali DTO publik eksplisit | authenticated + role |
| /api/v1/learning | authenticated | authenticated + role |
| /api/v1/evaluations | authenticated kecuali DTO publik eksplisit | authenticated + role |
| /api/auth/me | session inspection | tidak berlaku |
| /api/auth/login, logout | flow autentikasi | validasi sesi, CSRF dan rate limit |

## Pekerjaan implementasi berurutan
1. Tentukan origin frontend aktual dan jalur routing /api/auth serta /api/v1.
2. Pastikan skema sesi produksi, cookie, role, masa berlaku, revocation dan CSRF.
3. Implementasi API gateway/session verification dan read-only DTO untuk data yang boleh publik.
4. Ganti frontend `apiGet`/`apiPost` agar menggunakan sesi/gateway, bukan bearer kosong.
5. Tambahkan tes unauthorized GET/POST, role, CORS, CSRF, expiry, public DTO dan frontend smoke.
6. Deploy staging dahulu; dokumentasikan bukti PASS dan versi artifact. Production tetap tidak berubah hingga gate lulus.

## Kriteria selesai Tahap 02
- Semua endpoint terklasifikasi publik/privat; GET privat 401 tanpa sesi.
- Admin berhak POST, pengguna tanpa izin menerima 403; browser tidak menyimpan secret.
- Dashboard memuat data dengan sesi yang benar dan menampilkan keadaan logged-out dengan jelas.
- Tes regresi autentikasi, CORS dan CSRF lulus di staging.

## Known blockers
- Source API besar terpotong oleh batas hasil konektor pada pembacaan penuh; jangan mengubah file dari teks parsial.
- Jalur routing frontend produksi dan koneksi sesi auth-stage belum tervalidasi.

**Tidak ada klaim implementasi atau deployment selesai dari dokumen ini.**

## Verifikasi CI (2026-10-27)
- GitHub Actions workflow `NEBULA V1 regression`, run #8, run ID 40473906171: **success**.
- Langkah `Syntax check` dan `Regression tests` keduanya **success**.
- Bukti: https://github.com/NebulaCryptoHunter/NebulaCryptoHunter/actions/runs/40473906171
- **Batas cakupan**: source `workers/nebula-api/worker.mjs` dihapus dari PR karena salinan terpotong. Workflow ini tidak menguji API produksi maupun integrasi session/cookie. Tahap 02 belum FINAL.

## Pemeriksaan implementasi sesi (2026-10-27)
- Source API asli dipulihkan dari Cloudflare dalam 8 bagian, lalu direkonstruksi otomatis dan lolos syntax check.
- Commit `4ae22b0` menambahkan `isSessionAdmin`: SHA-256 token cookie `nebula_session`, query `AUTH_DB.auth_sessions` + `auth_users`, expiry, revoked, status active, role SUPER_ADMIN.
- GitHub Actions run 40474827233: **success** (rekonstruksi, sintaks, regresi).
- Audit Cloudflare read-only: `nebula-api` saat ini memiliki binding `DB` ke production D1 tetapi **belum memiliki `AUTH_DB`**; `nebula-auth-stage` memakai database autentikasi sebagai `DB`.
- **Release gate**: staging Worker dengan binding `AUTH_DB` ke D1 autentikasi; cocokkan nama cookie & hashing dengan auth Worker yang sesungguhnya; uji login/GET/POST/CSRF/role; baru rencanakan deployment produksi.
- **Security note**: binding staging auth DB langsung ke produksi dapat membuat staging session menjadi otorisasi produksi. Gunakan database auth produksi tersendiri sebelum production rollout.
