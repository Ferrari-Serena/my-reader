-- 0015_feedback_response_times.sql —— 反馈首读／首响时间（2026-11-21）
--
-- first_response_at：首次从 new 变为 read/closed 时写入，之后不再改动。
-- read_at：首次从 new 变为 read 时写入；直接 new→closed 时保持 NULL。
-- 已有库：执行本迁移；新建库：migrations 全量跑完后 schema.sql 已含同名列。
ALTER TABLE feedback ADD COLUMN first_response_at INTEGER;
ALTER TABLE feedback ADD COLUMN read_at INTEGER;
