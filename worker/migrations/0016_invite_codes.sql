-- 0016_invite_codes.sql —— 邀请码注册门禁（2026-11-21）
--
-- 单次可用；used_at 非空即已用；expires_at/disabled_at 可空。
-- code 明文存储：M2 只有 Ferrari 持 D1 读权限；M3 后如需收紧再改哈希。
CREATE TABLE IF NOT EXISTS invite_codes (
  code            TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  created_by      TEXT,
  note            TEXT,
  used_at         INTEGER,
  used_by_user_id TEXT,
  expires_at      INTEGER,
  disabled_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invite_codes_created ON invite_codes (created_at);
