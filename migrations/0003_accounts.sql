-- Per-person accounts, so several people can use the app with their own ElevenLabs keys.
--
-- The login identifier is never stored. Only its SHA-256 is kept, so a copy of this database
-- does not hand over working logins: the identifier is the credential, and treating it like a
-- password is the whole point of hashing it.
CREATE TABLE IF NOT EXISTS accounts (
    account_id TEXT PRIMARY KEY,
    identifier_hash TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    api_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    disabled INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_accounts_hash ON accounts (identifier_hash);

-- Existing rows get NULL, which belongs to nobody and is therefore visible to nobody. The
-- bootstrap claims them for the first account so the history created before this is not orphaned.
ALTER TABLE jobs ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs (account_id, created_at DESC);
