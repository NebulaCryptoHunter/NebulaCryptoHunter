# NEBULA first-login account (2026-11-01)

## Requirements
- Username: `admin.nebula` as a case-insensitive alias on `auth_users.username`; associated email is retained for recovery.
- Bootstrap-only login credential limited to 8+ characters; **never commit password or hash**. Password must be changed before any privileged writes or manual scans.
- `must_change_password=1` restricts authenticated sessions to password reset; session maximum 15 minutes.
- Bootstrap credentials expire after 24 hours unless first login occurs earlier. A new secure activation process is needed if expired.
- New password must be >=12 characters and different from the temporary password; password hash stays PBKDF2-SHA256 100,000 rounds with unique 16-byte salt.
- On successful change all existing sessions for user are revoked and browser returns to login.
- Admin access only after changing the password and signing in again.

## Deployment order
1. Verify tests on PR. Apply additive D1 migration **only** on auth DB `nebula-auth-stage` (`9b09e549-5532-4019-ac72-a0a0f6c755be`).
2. Deploy first-login code to frontend (Cloudflare Worker `nebulacryptohunter`) and inspect active version.
3. Only after successful deployment: provision `admin.nebula` on auth DB using one-time salted hash, mark `must_change_password=1`, apply temporary expiry, confirm username exists.
4. Verify anonymous privilege denied, login UI accessible, scanner cron intact and unchanged. Do not perform the user's password change for them.
5. Account owner logs in and changes password privately; no passwords in logs or chat output.

## Precautions
- `admin123` is a weak, chat-exposed temporary credential. The account must not have elevated access until it is replaced. Recommend rotating immediately upon first login. Prefer one-time activation token or random bootstrap password for future releases.
- Do not touch research database or scanner Cron.
