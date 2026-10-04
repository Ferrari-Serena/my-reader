-- my-reader D1 schema（权威源，供新建库使用）
--
-- 新建库：wrangler d1 execute my-reader-dict --remote --file=schema.sql
-- 已有库：本文件里的 CREATE TABLE IF NOT EXISTS 对已存在的表不生效，
--         加列/改列必须跑 migrations/ 下的增量脚本（见该目录 README）。
--         顺序：先按编号跑 migrations/ 下所有脚本把结构补齐，再跑本文件（幂等，无副作用）。
--         清单与各脚本的幂等说明见 migrations/README.md。

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

-- 限流计数（0.0 止血）：只记「真去调 M-W」的请求，用于每 IP 滑动窗口 + 全局日配额。
-- 表与索引的增量迁移见 migrations/0002_rate_limit.sql，逻辑见 src/ratelimit.js。
CREATE TABLE IF NOT EXISTS rate_limit_events (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ip_ts ON rate_limit_events (ip, ts);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ts ON rate_limit_events (ts);

-- ── 账号与会话（第 2 步「开门」；增量迁移：migrations/0003_users_sessions.sql）──
-- 时间列一律 INTEGER = epoch 毫秒。详细口径写在 0003 的注释里，这里只放最终形态。

-- users：账号本体（Phase 1 = 邮箱 + 密码）
--   password_hash = PHC 风格单串 pbkdf2-sha256$<迭代数>$<盐b64>$<哈希b64>（盐与参数同列，不分列）
--   email = trim + 小写（唯一约束靠它）；sync_code = 账号主码（一账号一条，NULL = 未认领）
--   email_verified_at 非空 = 邮箱已验证；deleted_at 非空 = 已申请注销、处于冷静期
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  email_verified_at INTEGER,
  sync_code         TEXT,
  deleted_at        INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email     ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_sync_code ON users (sync_code);

-- sessions：登录会话；只存 sha256(令牌) hex，令牌原文只活在 httpOnly cookie 里
--   已裁口径（2026-10-04）：30 天滚动 ＋ 180 天绝对上限（续期锚点 = created_at）
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- login_attempts：登录 / 重置的失败计数（scope = 'ip' | 'email'；逐条日志 + COUNT）
CREATE TABLE IF NOT EXISTS login_attempts (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  ts    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (scope, key, ts);

-- auth_tokens：邮件类一次性令牌（邮箱验证 / 重置密码共用；只存 sha256(令牌) hex，kind = 'verify' | 'reset'）
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, kind);
