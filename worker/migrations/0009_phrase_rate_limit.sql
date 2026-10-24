-- 0009 · 词组模型调用的独立限流账本（幂等）
--
-- 只记「D1 缓存未命中、即将真的调用模型」的请求。
-- 与 rate_limit_events（M-W 查词额度）分开，避免词组调用挤占查词额度。
-- 逻辑见 src/phraseRateLimit.js。

CREATE TABLE IF NOT EXISTS phrase_rate_events (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_phrase_rate_events_ip_ts ON phrase_rate_events (ip, ts);
CREATE INDEX IF NOT EXISTS idx_phrase_rate_events_ts ON phrase_rate_events (ts);
