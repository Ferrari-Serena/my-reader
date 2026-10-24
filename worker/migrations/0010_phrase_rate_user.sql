-- 0010 · 词组限流账本增加 user_id（一次性 ALTER，不要重跑）
--
-- 0009 已建出 (ip, ts)；这里只追加一列并加索引。
-- 重复执行会报 duplicate column。

ALTER TABLE phrase_rate_events ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_phrase_rate_events_user_ts ON phrase_rate_events (user_id, ts);
