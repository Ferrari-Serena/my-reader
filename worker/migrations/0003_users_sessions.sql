-- 0003 — 账号 / 会话 / 失败计数 / 邮件令牌（第 2 步「开门」地基）
--
-- 四张表，全部 IF NOT EXISTS，可重复执行（与 0002 同风格；0001 是一次性 ALTER，不要重跑）。
-- 时间列一律 INTEGER = epoch 毫秒（与 dict_cache.fetched_at / rate_limit_events.ts 一致），
-- 便于直接算过期；不要用 TEXT 存时间。
--
-- 执行：
--   cd worker
--   npx wrangler d1 execute my-reader-dict --remote --file=migrations/0003_users_sessions.sql
-- 新建库：直接跑 schema.sql（已含这四张表，幂等）。
--
-- 修订记录（2026-10-04，推送前）：初稿带 recovery_codes（无邮件版「恢复码」自助重置）；
--   Ferrari 裁「恢复码用户存不住，等于变相要求用户自管密码 → 仍做邮箱验证」，
--   该表未落地即撤，换成 auth_tokens（邮箱验证 / 重置密码共用一套一次性令牌）。
--   本文件从未在远端执行过，所以这是「改稿」不是「再加一个迁移」。

-- ── users：账号本体（Phase 1 = 邮箱 + 密码）────────────────────────────────
-- password_hash 存「PHC 风格单串」：pbkdf2-sha256$<迭代数>$<盐b64>$<哈希b64>
--   → 盐与参数跟哈希同住一列，将来换迭代数/换算法不用改表；绝不分列存盐、绝不存明文。
-- email 只存 trim + 小写后的形态（唯一约束靠它）；展示用回原样在客户端做。
-- email_verified_at 非空 = 邮箱已验证（走 auth_tokens 的 kind='verify'；B 块实现）。
-- sync_code = 账号的「主码」（已裁：一个账号一条主码；认领后换新码，多设备共用，
--   见第 2 步 D 块）。NULL = 尚未认领。唯一索引同时保证「一码只属一个账号」，
--   且 SQLite 的唯一索引允许多行 NULL（未认领的账号互不冲突）。
-- deleted_at 非空 = 已申请注销、处于冷静期；到期由清理逻辑真删（见第 2 步 F 块）。
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

-- ── sessions：登录会话（第 2 步 C 块）──────────────────────────────────────
-- 只存令牌的 SHA-256 十六进制；令牌原文只活在 httpOnly cookie 里 —— 库泄露也拿不到会话。
-- 已裁口径（2026-10-04）：30 天滚动 ＋ 180 天绝对上限。
--   滚动 = 每次带 cookie 访问就 last_seen_at = now、expires_at = now + 30 天；
--   绝对上限 = 续期时若 now > created_at + 180 天，不再续、直接判过期（要重登一次）。
-- 过期行由 C 块顺手清（借 idx_sessions_expires）。
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,          -- sha256(token) hex（64 字符）
  user_id      TEXT NOT NULL,
  created_at   INTEGER NOT NULL,          -- 绝对上限的锚点，续期时不许改
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

-- ── login_attempts：登录 / 重置的失败计数（防爆破 + 防枚举）────────────────
-- 与 rate_limit_events 同形（逐条日志 + COUNT），但按 (scope, key) 分桶：
--   scope = 'ip'    key = CF-Connecting-IP   挡同一台机器的广撒
--   scope = 'email' key = 小写邮箱            挡盯住一个账号的慢速爆破
-- 成功登录清掉该邮箱的失败行；老行由 B 块顺手清（只留窗口内的）。失败姿态 fail-open，
-- 与 ratelimit.js 一致：计数表读/写报错时按「没失败过」放行并打日志。
CREATE TABLE IF NOT EXISTS login_attempts (
  scope TEXT NOT NULL,
  key   TEXT NOT NULL,
  ts    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (scope, key, ts);

-- ── auth_tokens：邮件类一次性令牌（邮箱验证 / 重置密码共用；第 2 步 B 块）──
-- 已裁：做邮箱验证（发信渠道待定，见方案 §第 2 步前置）。
-- 只存 sha256(令牌) hex，令牌原文只出现在发出去的那封邮件里 —— 库泄露也拿不到。
-- kind = 'verify'（邮箱验证）| 'reset'（重置密码）；used_at 非空 = 已用过（一次性，
-- 用完作废，同一哈希不得复用）。expires_at 由 B 块定（建议 verify 24h / reset 1h）。
-- 一个用户可同时持有两类令牌；换设备/重发 = 生成新行，旧的由 B 块按 kind 作废。
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, kind);