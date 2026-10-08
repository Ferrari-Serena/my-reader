-- 0005 · 服务端合成任务表（第 17 步 块 C，设计定案 D24）—— 一章一行
--
-- 幂等（IF NOT EXISTS），可重复执行。
--
-- 粒度：**一章一行**（D24-a）。主键 =（账号主码, book_id, chapter_id）——
--   同一章重复提交 → `INSERT OR IGNORE` 撞主键、changes=0（不重复计费、不重复写）。
-- 状态机：pending → running → done ／ 出错 → 回 pending 重试（≤3 次）→ failed。
--   租约：claim 用 `UPDATE ... WHERE status='pending'` 守卫 + 查 changes（同 §13.2 手法）；
--   心跳：跑章期间每完成一块 / 一章写一次 `heartbeat`；`running` 且心跳超 5 分钟 → 判死回收。
-- 日配额（D21-d：5 章/天 ＋ ≤80,000 字符/天，按账号）**不另建计数器表** ——
--   按 `created_at` 落在 `[当日起点, +1 天)` 的行求和（章数 = 行数；字符 = SUM(char_count)）。
--   ⇒ 重试不重复计（还是那一行）；「删音频再生成」也天然只算新提交的那次。
-- char_count / title 在**提交时**从 R2 书体读出并落行 —— 配额要在收单前就能算出来。
CREATE TABLE IF NOT EXISTS audio_tasks (
  code        TEXT    NOT NULL,              -- 账号主码（users.sync_code，租户边界）
  book_id     TEXT    NOT NULL,              -- BYO 书 id（bk_…）
  chapter_id  TEXT    NOT NULL,              -- 章 id（ch-01 / ch-100）
  title       TEXT    NOT NULL DEFAULT '',
  char_count  INTEGER NOT NULL DEFAULT 0,    -- 该章正文字符数（配额用）
  status      TEXT    NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  attempts    INTEGER NOT NULL DEFAULT 0,    -- 已起跑次数（claim 时 +1）；≥3 不再重试
  created_at  INTEGER NOT NULL,              -- 提交时刻（epoch ms）＝ 配额归属日
  updated_at  INTEGER NOT NULL,
  started_at  INTEGER,
  heartbeat   INTEGER,                       -- 最近一次心跳；判死只看它
  finished_at INTEGER,
  error       TEXT,                          -- 最终失败原因（给前端一句可读话）
  bytes       INTEGER,                       -- 产物字节数（done 时写）
  audio_ms    INTEGER,                       -- 产物时长毫秒（done 时写）
  PRIMARY KEY (code, book_id, chapter_id)
);

-- 领任务：按 (status, created_at) 找最老的 pending
CREATE INDEX IF NOT EXISTS idx_audio_tasks_claim ON audio_tasks (status, created_at);
-- 配额求和 + 状态查询：按 (code, created_at)
CREATE INDEX IF NOT EXISTS idx_audio_tasks_code_created ON audio_tasks (code, created_at);
