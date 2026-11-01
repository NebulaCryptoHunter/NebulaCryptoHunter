-- NEBULA Admin first-login security additions (auth DB only).
-- Apply once to nebula-auth-stage. Do not run against nebula-db research.
ALTER TABLE auth_users ADD COLUMN username TEXT COLLATE NOCASE;
ALTER TABLE auth_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
ALTER TABLE auth_users ADD COLUMN temporary_password_expires_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nebula_auth_username ON auth_users(username) WHERE username IS NOT NULL;
