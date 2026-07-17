-- my-reader 词典缓存表（wrangler d1 execute my-reader-dict --remote --file=schema.sql）
CREATE TABLE IF NOT EXISTS dict_cache (
  word TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
