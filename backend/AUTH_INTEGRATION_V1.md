# NEBULA Auth V1 integration and release plan

Status: **SOURCE MODULE ONLY — NOT LIVE**. No D1 migration executed and no production Worker changed.

## Target architecture
- Multi-user ready, only SUPER_ADMIN provisioned at initial launch.
- Users: SUPER_ADMIN, USER, FREE_USER. No self-registration in V1.
- Browser authentication uses a Secure, HttpOnly, SameSite=Strict cookie on the **same origin** as the UI. If frontend and API are on separate workers.dev hosts, use a same-origin API proxy or custom shared origin before enabling cookie login. Do not assume cross-subdomain cookies work.
- Provider secrets remain Cloudflare Worker secrets. The browser-embedded legacy API key must be removed and rotated only after verified cutover.
- Route authorization: public safe reads explicitly allowlisted; mutations require a valid session, role, and Origin/JSON checks. BUY control stays visible but backend verifies authorization and the existing fail-closed BUY decision gate. UI BUY currently queues evaluation; it is **not** wallet execution.
- Login: 12+ character password, rate limiting per account and IP, generic failures, session renewal policy, session revocation on logout, CSRF Origin validation. Provision the first admin using a secured one-time CLI/admin process, never a hardcoded default.
- Session TTL currently 24h; adjust for requirements after review. Password algorithm is PBKDF2-SHA256 with 310k iterations; evaluate performance in Cloudflare Workers before production.

## Safe deployment
1. Export/back up D1 and record current production Worker deployment version IDs.
2. Apply migrations/0003_auth_multiuser.sql **only to staging D1** first. Check tables and indexes, no impact on existing records.
3. Integrate auth-v1.mjs into the backend's fetch handler; enforce access control on each route. Add rate limits and admin provisioning workflow. Do not consider the module alone sufficient.
4. Serve UI and /api through same origin or an authenticated reverse proxy; ensure all browser requests use credentials:'include', and avoid wildcard CORS for authenticated endpoints.
5. Verify unauthorized requests fail with 401/403, including forged client BUY claims; check allowed roles and no leakage of password/session token.
6. Run tests for login, logout, expired/revoked sessions, CSRF, rate limits, password verification, cross-user data isolation, frontend scanner, evaluation cron, provider failures and D1 historical reads.
7. Promote to production with an explicit rollback target. Keep old API authentication available only during the tested migration window; rotate the exposed legacy key immediately after successful cutover.
8. Rollback Worker versions if smoke tests fail. Avoid rolling back D1 by dropping auth tables; additive schema can remain.

## Unfinished / blockers
- Production and staging auth routes have **not** been wired.
- No first admin account exists.
- Login UI and same-origin routing have **not** been implemented.
- No integration tests have been executed.
- Production deployment has **not** happened.

Files: backend/auth-v1.mjs, backend/migrations/0003_auth_multiuser.sql.
