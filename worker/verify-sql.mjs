/**
 * 用真 SQLite（Node 24 自带 node:sqlite）跑 sync.js 里**真**的条件 upsert 语句，
 * 验证「陈旧写被拒收 / 墓碑 / 复活」这套时间轴语义真的成立。
 * 用法: node verify-sql.mjs
 *
 * 为什么要真跑：ON CONFLICT ... DO UPDATE ... WHERE 的语义（尤其是 changes 的取值）
 * 是这套修复的地基，靠读文档推断不够——D1 的 batch 结果正是用 changes 来区分
 * 「收下」和「拒收」，这里跑不通，线上就是静默丢数据。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { SQL_ALIVE_UPSERT, SQL_TOMB_UPSERT } from './src/sync.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

// ── 建库：用真的 schema.sql，再补上 0001 迁移（schema.sql 已是最终形态，
//    这里单独验证迁移脚本本身能跑通）
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE sync_data (
  code TEXT NOT NULL, word TEXT NOT NULL, payload TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (code, word))`)
db.exec(readFileSync(new URL('./migrations/0001_sync_tombstones_progress.sql', import.meta.url), 'utf8'))

const CODE = 'TESTCODE'
const alive = db.prepare(SQL_ALIVE_UPSERT)
const tomb = db.prepare(SQL_TOMB_UPSERT)
const read = db.prepare('SELECT payload, updated_at, deleted_at FROM sync_data WHERE code = ? AND word = ?')

/** 跑一条写入，返回 changes（D1 的 meta.changes 就是这个） */
const put = (stmt, code, word, ...rest) => stmt.run(code, word, ...rest).changes

console.log('\n[迁移脚本]')
t('0001 能跑通且加了 deleted_at 列',
  db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sync_data') WHERE name = 'deleted_at'").get().n === 1)
t('0001 建出了 sync_progress',
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sync_progress'").get().n === 1)

console.log('\n[条件 upsert — 只有更新的时间戳才覆盖]')
t('首次写入被收下 (changes=1)', put(alive, CODE, 'apple', '{"v":1}', '2026-01-01T00:00:00.000Z') === 1)
t('更旧的时间戳被拒收 (changes=0)', put(alive, CODE, 'apple', '{"v":0}', '2025-12-31T00:00:00.000Z') === 0)
t('拒收后服务端仍是 v1', JSON.parse(read.get(CODE, 'apple').payload).v === 1)
t('更新被收下', put(alive, CODE, 'apple', '{"v":2}', '2026-01-02T00:00:00.000Z') === 1)
t('收下后内容为 v2', JSON.parse(read.get(CODE, 'apple').payload).v === 2)
t('时间戳相同不覆盖 (changes=0)', put(alive, CODE, 'apple', '{"v":99}', '2026-01-02T00:00:00.000Z') === 0)
t('并列时保留原值 v2', JSON.parse(read.get(CODE, 'apple').payload).v === 2)

console.log('\n[墓碑 — 删除]')
t('墓碑晚于存活写 → 生效', put(tomb, CODE, 'apple', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z') === 1)
const afterTomb = read.get(CODE, 'apple')
t('deleted_at 已写入', afterTomb.deleted_at === '2026-01-03T00:00:00.000Z')
t('updated_at 与 deleted_at 同一时刻', afterTomb.updated_at === afterTomb.deleted_at)
t('payload 为 null 字面量', afterTomb.payload === 'null')

console.log('\n[墓碑 — 陈旧存活写打不过墓碑]')
t('比墓碑旧的存活写被拒收', put(alive, CODE, 'apple', '{"v":3}', '2026-01-02T12:00:00.000Z') === 0)
t('仍保持墓碑状态', read.get(CODE, 'apple').deleted_at !== null)

console.log('\n[复活 — 墓碑之后的存活写]')
t('比墓碑新的存活写被收下', put(alive, CODE, 'apple', '{"v":4}', '2026-01-04T00:00:00.000Z') === 1)
const revived = read.get(CODE, 'apple')
t('deleted_at 被清回 NULL（关键：复活不需要补偿逻辑）', revived.deleted_at === null)
t('内容是复活后的 v4', JSON.parse(revived.payload).v === 4)

console.log('\n[多设备交错 — 本轮要修的那个真实场景]')
// 设备 A 写下较新版本，设备 B 随后推一份陈旧的全量快照
put(alive, CODE, 'banana', '{"v":"A-new"}', '2026-02-01T10:00:00.000Z')
put(alive, CODE, 'banana', '{"v":"B-stale"}', '2026-02-01T09:00:00.000Z')
t('陈旧快照被拒收，A 的编辑不再丢失', JSON.parse(read.get(CODE, 'banana').payload).v === 'A-new')

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
