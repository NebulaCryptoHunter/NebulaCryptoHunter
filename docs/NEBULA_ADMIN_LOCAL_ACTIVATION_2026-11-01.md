# NEBULA — Aktivasi lokal Admin `admin.nebula`

**Status:** hanya dijalankan oleh pemilik akun pada komputer pribadi. Password tidak dicatat di chat, GitHub, Cloudflare config, atau email.

## Prasyarat
- Node.js 22+ dan Wrangler tersedia; autentikasi ke akun Cloudflare NEBULA yang benar.
- Migrasi auth `0009_admin_first_login.sql` telah diterapkan pada `nebula-auth-stage` (bukan `nebula-db`).
- Kode first-login sudah ter-deploy di Worker `nebulacryptohunter`.
- Tabel `auth_users` belum punya `SUPER_ADMIN`.

## Aktivasi melalui PowerShell (Windows)
Buka terminal pada folder repositori NEBULA terbaru. Jalankan:

```powershell
$env:NEBULA_ADMIN_EMAIL="heru.suzuki.official@gmail.com"
$env:NEBULA_ADMIN_USERNAME="admin.nebula"
$env:NEBULA_TEMPORARY_FIRST_LOGIN="1"
$env:NEBULA_ADMIN_SQL_FILE="nebula-admin-private.sql"
node backend/scripts/provision-first-admin.mjs
npx wrangler whoami
npx wrangler d1 execute nebula-auth-stage --remote --file=nebula-admin-private.sql --config=wrangler.jsonc
Remove-Item -Force nebula-admin-private.sql
Remove-Item Env:\NEBULA_TEMPORARY_FIRST_LOGIN
Remove-Item Env:\NEBULA_ADMIN_SQL_FILE
```

Pada prompt Node, ketik password sementara yang hanya diketahui pemilik. Password tidak akan ditampilkan. File SQL harus tidak pernah di-commit, dibagikan, atau diunggah ke Drive. Jalankan perintah SQL hanya sekali di akun Cloudflare yang benar.

Password sementara hanya valid selama 24 jam dan, saat login, hanya memperoleh sesi terbatas 15 menit. Pengguna langsung diarahkan mengganti password dengan yang baru, unik dan minimal 12 karakter. Semua sesi lama dicabut. Login ulang melalui:

https://nebulacryptohunter.nebula-crypto-proxy.workers.dev/account

## Verifikasi
- D1 `auth_users` punya tepat 1 `SUPER_ADMIN` dengan `username=admin.nebula`, `must_change_password=1` (sampai pemilik melakukan perubahan).
- Selama `must_change_password=1`, semua operasi Admin (termasuk manual scan) diblokir oleh server.
- Setelah penggantian berhasil, `must_change_password=0`, `temporary_password_expires_at=NULL`, dan sesi lama dicabut.
- Jumlah historis `predictions` dalam `nebula-db` tidak berubah akibat aktivasi.

### Jika token 24 jam habis
Jangan ulangi insert langsung. Gunakan alur pemulihan akun yang terautentikasi / administrasi yang diverifikasi terlebih dahulu.

### Catatan
Password sementara yang mudah ditebak tidak aman untuk dipakai dalam produksi. Gunakan hanya untuk proses lokal yang sangat singkat, kemudian segera ganti menjadi password pribadi kuat.
