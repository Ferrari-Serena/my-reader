-- my-reader D1 schema（权威源，供新建库使用）
--
-- 新建库：wrangler d1 execute my-reader-dict --remote --file=schema.sql
-- 已有库：本文件里的 CREATE TABLE IF NOT EXISTS 对已存在的表不生效，
--         加列/改列必须跑 migrations/ 下的增量脚本（见该目录 README）。
--         顺序：先跑 migrations 把结构补齐，再跑本文件（幂等，无副作用）。

-- 词典缓存
CREATE TABLE IF NOT EXISTS dict_cache (
  word TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- 跨设备同步：同步码 → 单词数据快照（code 和 word 复合主键）
-- word = '__meta__' 是哨兵行，其 updated_at 即该同步码的「最后活动时刻」，
-- push / pull 都会刷新它；90 天无活动才整码清除。
-- deleted_at 非空即墓碑：该词已被删除，updated_at = deleted_at = 删除时刻。
CREATE TABLE IF NOT EXISTS sync_data (
  code TEXT NOT NULL,
  word TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (code, word)
);

-- 阅读 / 音频进度（每个 key 一条）
-- key 形如 'reading:<bookId>' 或 'audio:<bookId>/<chapterId>'
CREATE TABLE IF NOT EXISTS sync_progress (
  code TEXT NOT NULL,
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (code, key)
);
