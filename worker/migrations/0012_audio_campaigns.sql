CREATE TABLE IF NOT EXISTS audio_campaigns (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  book_id TEXT NOT NULL,
  month TEXT NOT NULL,
  status TEXT NOT NULL,
  voice TEXT NOT NULL,
  chapters_total INTEGER NOT NULL,
  chapters_done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(code, book_id, month)
);
CREATE INDEX IF NOT EXISTS idx_campaign_code_month ON audio_campaigns(code, month, status);
