-- 0002 — 限流计数（0.0 止血 · 第二半）
--
-- 只给「真的去调 M-W」的请求记一条（D1 缓存命中不记），供 worker/src/ratelimit.js 算两个数：
--   1) 每 IP 滑动窗口：SELECT COUNT(*) ... WHERE ip = ? AND ts > <now - 60s>
--   2) 全局日配额：    SELECT COUNT(*) ... WHERE ts > <当日 0 点 UTC>
-- 表很小：一天最多几百行（到全局配额就停止插入），新 UTC 日的第一条请求会顺手清旧行。
--
-- 幂等：CREATE TABLE / CREATE INDEX 都带 IF NOT EXISTS，重复执行无副作用（不同于 0001）。
--
-- 执行：
--   cd worker
--   npx wrangler d1 execute my-reader-dict --remote --file=migrations/0002_rate_limit.sql

CREATE TABLE IF NOT EXISTS rate_limit_events (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ip_ts ON rate_limit_events (ip, ts);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_ts ON rate_limit_events (ts);