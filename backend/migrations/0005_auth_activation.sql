CREATE TABLE IF NOT EXISTS auth_activation_tokens (
 token_hash TEXT PRIMARY KEY,
 email TEXT NOT NULL COLLATE NOCASE,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_activation_expiry ON auth_activation_tokens(expires_at);
