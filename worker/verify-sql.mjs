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
import * as rlMod from './src/ratelimit.js'

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
// 0002 限流表（幂等，见 migrations/0002_rate_limit.sql）
db.exec(readFileSync(new URL('./migrations/0002_rate_limit.sql', import.meta.url), 'utf8'))

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

console.log('\n[0002 迁移 + takeToken 集成（0.0 止血 · 第二半）]')
{
  t('0002 建出 rate_limit_events',
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='rate_limit_events'").get().n === 1)
  t('0002 建出 (ip, ts) 复合索引',
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_rate_limit_events_ip_ts'").get().n === 1)
  t('0002 幂等：重复执行不报错', (() => {
    try { db.exec(readFileSync(new URL('./migrations/0002_rate_limit.sql', import.meta.url), 'utf8')); return true }
    catch { return false }
  })())

  // 把 node:sqlite 适配成 D1 的 prepare().bind().first()/.run() 形状，好让 takeToken 原样跑
  const d1 = {
    prepare(sql) {
      let args = []
      const st = {
        bind(...a) { args = a; return st },
        async first() { const r = db.prepare(sql).get(...args); return r === undefined ? null : r },
        async run() { const info = db.prepare(sql).run(...args); return { meta: { changes: info.changes } } },
      }
      return st
    },
  }

  const NOW = Date.UTC(2026, 9, 3, 12, 0, 0)
  const env = { DB: d1, RATE_LIMIT_PER_MIN: '3', MW_DAILY_LIMIT: '8' }
  const rows = () => db.prepare('SELECT COUNT(*) AS n FROM rate_limit_events').get().n
  const take = (ip, now) => rlMod.takeToken(env, { ip, now })

  t('第 1 次放行', (await take('a', NOW)).allowed === true)
  t('第 2 次放行', (await take('a', NOW + 1000)).allowed === true)
  t('第 3 次放行', (await take('a', NOW + 2000)).allowed === true)
  t('窗口内已记 3 条', rows() === 3)

  const r4 = await take('a', NOW + 3000)
  t('第 4 次被每 IP 窗口拦下', r4.allowed === false && r4.scope === 'ip')
  t('IP 拦截 Retry-After = 60s', r4.retryAfter === 60)
  t('被拦不记账（仍 3 条）', rows() === 3)

  t('窗口滑过同一 IP 又可查', (await take('a', NOW + 61_000)).allowed === true)
  t('别的 IP 不受该 IP 影响', (await take('b', NOW + 4000)).allowed === true)
  t('继续累计', (await take('b', NOW + 5000)).allowed === true)
  t('再换 IP', (await take('c', NOW + 6000)).allowed === true)
  t('第 8 条（第 5 个 IP）仍放行', (await take('d', NOW + 7000)).allowed === true)
  t('此刻全局 8 条已满', rows() === 8)

  const rQ = await take('e', NOW + 8000)
  t('新 IP 撞上全局日配额 -> quota', rQ.allowed === false && rQ.scope === 'quota')
  t('配额拦截 Retry-After = 距次日 UTC 0 点',
    rQ.retryAfter === Math.ceil((Date.UTC(2026, 9, 4) - (NOW + 8000)) / 1000))
  t('配额拦截也不记账（仍 8 条）', rows() === 8)

  t('新 UTC 日：配额重置 + 顺手清旧行',
    (await take('f', Date.UTC(2026, 9, 4, 0, 0, 1))).allowed === true)
  t('旧日行已被清空（只剩新日 1 条）', rows() === 1)

  t('阈值非法 -> 回默认，不误拦',
    (await rlMod.takeToken({ DB: d1, RATE_LIMIT_PER_MIN: 'abc', MW_DAILY_LIMIT: '0' },
      { ip: 'g', now: NOW })).allowed === true)

  t('D1 读失败 -> fail-open 放行',
    (await rlMod.takeToken({ DB: { prepare() { throw new Error('boom') } } },
      { ip: 'h', now: NOW })).allowed === true)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
