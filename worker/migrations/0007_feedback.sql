-- 0007_feedback.sql —— 客服／反馈通道（第 13 步 · D11「表单写自家 D1」）
--
-- ✅ 幂等（CREATE TABLE / CREATE INDEX 都带 IF NOT EXISTS），可重复执行。
--
-- 一行 = 一条反馈。列口径：
--   user_id    —— 提交时已登录 ⇒ 会话推导出的账号 id；游客为 NULL
--   anon_key   —— **只用于反馈的本机匿名键**（不是同步租户码；为什么见 src/feedback.js 头注释）
--   category   —— 'bug' | 'idea' | 'other'
--   message    —— 正文（服务端校验 4~2000 字，见 src/feedback.js）
--   contact    —— 可选联系方式（游客留个邮箱／微信号；登录用户一般不填）
--   context    —— 诊断 JSON（白名单键：version/ua/viewport/lang/route/bookId/chapterId/errors）
--   status     —— 'new' | 'read' | 'closed'（后台待办；status_at = 最后一次改状态的时刻）
--
-- 刻意**不存 IP**：滥用计数已经在 rate_limit_events / login_attempts 里，反馈行再存一份
-- 只是多一处个人信息（第 13 步 13.2 的隐私边界）。
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  user_id    TEXT,
  anon_key   TEXT,
  category   TEXT    NOT NULL DEFAULT 'other',
  message    TEXT    NOT NULL,
  contact    TEXT,
  context    TEXT,
  status     TEXT    NOT NULL DEFAULT 'new',
  status_at  INTEGER
);
-- 后台翻页：按时间倒序（最常用）
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at);
-- 后台待办队列：按状态筛
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback (status, created_at);
-- 「我的反馈」：登录后按账号查
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback (user_id, created_at);
-- 「我的反馈」：游客期按匿名键查（登录后这一路仍要用 —— 键不变，见 src/feedback.js）
CREATE INDEX IF NOT EXISTS idx_feedback_anon ON feedback (anon_key, created_at);