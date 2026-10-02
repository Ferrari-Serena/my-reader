-- 0001 — 同步墓碑 + 进度表
--
-- 只跑一次！SQLite 的 ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS，
-- 重复执行会在第一条语句上报 "duplicate column name: deleted_at"。
--
-- 执行：
--   cd worker
--   npx wrangler d1 execute my-reader-dict --remote --file=migrations/0001_sync_tombstones_progress.sql
--
-- 该迁移是纯增量的：加一列 + 加一张表，旧版 Worker 完全不受影响。

-- 墓碑：NULL = 存活，非空 = 该词已被删除（值即删除时刻）
ALTER TABLE sync_data ADD COLUMN deleted_at TEXT;

-- 阅读 / 音频进度
CREATE TABLE IF NOT EXISTS sync_progress (
  code TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (code, key)
);
