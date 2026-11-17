-- 0014_phrase_retract_log.sql
-- A1 phrase retraction audit log + phrase_cloud_cache provenance columns.
-- One-shot migration: SQLite has no ADD COLUMN IF NOT EXISTS, so plain ALTERs.

CREATE TABLE IF NOT EXISTS phrase_retract_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retracted_at INTEGER NOT NULL,
  cache_key_hash TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  book_id TEXT NOT NULL,
  phrase_hash TEXT NOT NULL,
  answer_rank INTEGER NOT NULL,
  schema_ver TEXT,
  model_ver TEXT,
  prompt_ver TEXT,
  lexicon_ver TEXT,
  reason TEXT NOT NULL,
  operator TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phrase_retract_hash
  ON phrase_retract_log (cache_key_hash, id DESC);

ALTER TABLE phrase_cloud_cache ADD COLUMN book_id TEXT;
ALTER TABLE phrase_cloud_cache ADD COLUMN phrase_hash TEXT;
ALTER TABLE phrase_cloud_cache ADD COLUMN schema_ver TEXT;
ALTER TABLE phrase_cloud_cache ADD COLUMN model_ver TEXT;
ALTER TABLE phrase_cloud_cache ADD COLUMN prompt_ver TEXT;
ALTER TABLE phrase_cloud_cache ADD COLUMN lexicon_ver TEXT;

CREATE INDEX IF NOT EXISTS idx_phrase_cloud_book_phrase
  ON phrase_cloud_cache (book_id, phrase_hash);
