-- W11-7：campaign 记录请求的章 id（JSON 数组），供 hub runner 精确生成
ALTER TABLE audio_campaigns ADD COLUMN chapters_json TEXT;
