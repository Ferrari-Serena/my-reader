-- 0008 · 词组运行时云端终判的 D1 缓存表（幂等）
--
-- 只存「摘要键 → 义项 rank」，不存请求句子：
--   cache_key = 'public:' + sha256(canonical payload)   公开内置书，可跨用户共享
--   cache_key = 'user:<userId>:' + sha256(canonical payload)  BYO 书，按用户隔离
-- 表行不含 userId、bookId、sentence，只有不可逆摘要，见 src/phrase.js。

CREATE TABLE IF NOT EXISTS phrase_cloud_cache (
  cache_key  TEXT PRIMARY KEY,
  rank       INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phrase_cloud_created ON phrase_cloud_cache (created_at);
