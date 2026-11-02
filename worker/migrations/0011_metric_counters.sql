-- G5 · 四类运行计数账本（model_calls / rate_429 / abstain / cache_hits）
-- 一行 = 一个 UTC 日 + 一个计数名；只做自增，不存请求内容、IP 或词文本。
-- 幂等：CREATE TABLE IF NOT EXISTS，可重复执行。
CREATE TABLE IF NOT EXISTS metric_counters (
  day  TEXT    NOT NULL,
  name TEXT    NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);
