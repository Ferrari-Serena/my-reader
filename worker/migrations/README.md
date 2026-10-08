# worker/migrations — D1 增量迁移

`schema.sql` 是**新建库的权威源**（幂等，直接建出最终形态）；已有库的结构变更走本目录的增量脚本。

## 顺序（给已有库补结构时）

```powershell
cd worker
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0001_sync_tombstones_progress.sql
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0002_rate_limit.sql
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0003_users_sessions.sql
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0004_sync_data_kind.sql
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0005_audio_tasks.sql
npx wrangler d1 execute my-reader-dict --remote --file=migrations/0006_audio_tasks_purged.sql
# 全部迁移跑完，再跑一次权威源（幂等，无副作用）
npx wrangler d1 execute my-reader-dict --remote --file=schema.sql
```

新建库：只跑最后那条 `schema.sql` 即可。

## 清单

| 脚本 | 内容 | 幂等 |
|---|---|---|
| `0001_sync_tombstones_progress.sql` | `sync_data` 加 `deleted_at`（墓碑）＋ `sync_progress` 表 | ❌ 一次性 `ALTER TABLE`，**不要重跑** |
| `0002_rate_limit.sql` | `rate_limit_events` 表 ＋ 两个索引 | ✅ `IF NOT EXISTS` |
| `0003_users_sessions.sql` | `users` / `sessions` / `login_attempts` / `auth_tokens` | ✅ `IF NOT EXISTS` |
| `0004_sync_data_kind.sql` | `sync_data` 加 `kind` 列（默认 `'word'`）＋ `(code, kind, updated_at)` 索引 | ❌ 一次性 `ALTER TABLE`，**不要重跑** |
| `0005_audio_tasks.sql` | `audio_tasks` 表（服务端合成任务，一章一行）＋ `(status, created_at)`、`(code, created_at)` 两个索引 | ✅ `IF NOT EXISTS` |
| `0006_audio_tasks_purged.sql` | `audio_tasks` 加 `purged_at`（清空音频后「行作废」的时刻，D25-f） | ❌ 一次性 `ALTER TABLE`，**不要重跑** |

## 规矩

- 新脚本一律带 `IF NOT EXISTS`（可重复执行）；确实做不到幂等的（SQLite 的 `ALTER TABLE` 没有 `IF NOT EXISTS`）必须在文件头写明「不要重跑」与重复执行会报什么错。
- 每加一个脚本，同步更新 `schema.sql`（新建库建出最终形态）与 `verify-sql.mjs`（用 `node:sqlite` 真跑一遍结构 + 幂等复跑断言）。
- 空库跑 `schema.sql` 得到的结构，应与「空库按序跑完 migrations 再跑 `schema.sql`」一致。