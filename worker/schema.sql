-- my-reader 词典缓存表（wrangler d1 execute my-reader-dict --remote --file=schema.sql）
CREATE TABLE IF NOT EXISTS dict_cache (
  word TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- 跨设备同步：syncing key → 单词数据快照（code 和 word 复合主键）
CREATE TABLE IF NOT EXISTS sync_data (
  code TEXT NOT NULL,
  word TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (code, word)
);
