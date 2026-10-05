-- 0004 · sync_data 加 kind 列（第 3 步「归档：数据模型与 API」）
--
-- 目的：让 sync_data 一张表同时承载多种数据类型 ——
--   'word'    生词（老通道，键 = 词本身，全部存量行都属这一类）
--   'note'    笔记     键 = 'note:<id>'
--   'wrong'   错题     键 = 'wrong:<id>'
--   'card'    卡片     键 = 'card:<id>'
--   'setting' 设置     键 = 'setting:<id>'
-- 非词记录的 word 列存「命名空间键」= '<kind>:<id>'：词条永远不含 ':'，
-- 故两类记录在同一张表里永不撞车；PK 仍是 (code, word)，列名一律不动（方案 3.2）。
--
-- ⚠️ 不要重跑：SQLite 的 ALTER TABLE 没有 IF NOT EXISTS，
--    重复执行会报 "duplicate column name: kind"。
ALTER TABLE sync_data ADD COLUMN kind TEXT NOT NULL DEFAULT 'word';

-- 供 pull 按 kind 过滤 + 增量（since）扫描
CREATE INDEX IF NOT EXISTS idx_sync_data_code_kind_updated ON sync_data (code, kind, updated_at);
