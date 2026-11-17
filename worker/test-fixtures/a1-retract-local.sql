DROP TABLE IF EXISTS phrase_cloud_cache;
CREATE TABLE phrase_cloud_cache (cache_key TEXT PRIMARY KEY, rank INTEGER NOT NULL, created_at INTEGER NOT NULL, book_id TEXT, phrase_hash TEXT, schema_ver TEXT, model_ver TEXT, prompt_ver TEXT, lexicon_ver TEXT);
DROP TABLE IF EXISTS phrase_retract_log;
CREATE TABLE phrase_retract_log (id INTEGER PRIMARY KEY AUTOINCREMENT, retracted_at INTEGER NOT NULL, cache_key_hash TEXT NOT NULL, scope_kind TEXT NOT NULL, book_id TEXT NOT NULL, phrase_hash TEXT NOT NULL, answer_rank INTEGER NOT NULL, schema_ver TEXT, model_ver TEXT, prompt_ver TEXT, lexicon_ver TEXT, reason TEXT NOT NULL, operator TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_phrase_retract_hash ON phrase_retract_log (cache_key_hash, id DESC);
