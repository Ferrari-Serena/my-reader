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

// ── 建库 A：手搓 sync_data 初版，再按序跑 0001 / 0002 / 0003 —— 验证迁移链本身能跑通
//    （空库跑 schema.sql 那条路见文件末尾「schema.sql 单独建库」）
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE sync_data (
  code TEXT NOT NULL, word TEXT NOT NULL, payload TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY (code, word))`)
db.exec(readFileSync(new URL('./migrations/0001_sync_tombstones_progress.sql', import.meta.url), 'utf8'))
// 0002 限流表（幂等，见 migrations/0002_rate_limit.sql）
db.exec(readFileSync(new URL('./migrations/0002_rate_limit.sql', import.meta.url), 'utf8'))
// 0003 账号 / 会话 / 失败计数 / 邮件令牌（幂等，见 migrations/0003_users_sessions.sql）
db.exec(readFileSync(new URL('./migrations/0003_users_sessions.sql', import.meta.url), 'utf8'))
// 0004 sync_data 加 kind 列（一次性 ALTER，见 migrations/0004_sync_data_kind.sql）
db.exec(readFileSync(new URL('./migrations/0004_sync_data_kind.sql', import.meta.url), 'utf8'))

const CODE = 'TESTCODE'
const alive = db.prepare(SQL_ALIVE_UPSERT)
const tomb = db.prepare(SQL_TOMB_UPSERT)
const read = db.prepare('SELECT payload, updated_at, deleted_at, kind FROM sync_data WHERE code = ? AND word = ?')

/** 跑一条词条写入，返回 changes（D1 的 meta.changes 就是这个）；kind 固定 'word' */
const put = (stmt, code, word, ...rest) => stmt.run(code, word, 'word', ...rest).changes
/** 记录通道写入（第 3 步）：键是 '<kind>:<id>'，kind 显式给 */
const putRec = (stmt, code, key, kind, ...rest) => stmt.run(code, key, kind, ...rest).changes

console.log('\n[迁移脚本]')
t('0001 能跑通且加了 deleted_at 列',
  db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sync_data') WHERE name = 'deleted_at'").get().n === 1)
t('0001 建出了 sync_progress',
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sync_progress'").get().n === 1)
t('0004 能跑通且加了 kind 列',
  db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('sync_data') WHERE name = 'kind'").get().n === 1)
t('0004 建出 (code, kind, updated_at) 索引',
  db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_sync_data_code_kind_updated'").get().n === 1)
t('0004 新列默认 word（旧行自动归位）', (() => {
  db.prepare("INSERT INTO sync_data (code, word, payload, updated_at) VALUES ('DEFCODE', 'apple', '{}', '2026-01-01T00:00:00.000Z')").run()
  const got = db.prepare("SELECT kind FROM sync_data WHERE code = 'DEFCODE' AND word = 'apple'").get().kind
  db.prepare("DELETE FROM sync_data WHERE code = 'DEFCODE'").run()
  return got === 'word'
})())
t('0004 不幂等：重复执行报 duplicate column（故标注「不要重跑」）', (() => {
  try { db.exec(readFileSync(new URL('./migrations/0004_sync_data_kind.sql', import.meta.url), 'utf8')); return false }
  catch (e) { return /duplicate column/i.test(String(e.message)) }
})())

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

console.log('\n[第 3 步 — kind 记录通道：四类记录与词条在同一张表里互不干扰]')
{
  t('记录写入（kind=note）被收下',
    putRec(alive, CODE, 'note:n_1', 'note', '{"text":"hi"}', '2026-03-01T00:00:00.000Z') === 1)
  const rec = read.get(CODE, 'note:n_1')
  t('读回 kind=note 且载荷正确', rec.kind === 'note' && JSON.parse(rec.payload).text === 'hi')
  t('记录与同码的词各占一行（命名空间键不撞车）', read.get(CODE, 'apple') !== undefined)
  t('陈旧记录写被拒收（时间轴对记录同样成立）',
    putRec(alive, CODE, 'note:n_1', 'note', '{"text":"stale"}', '2026-02-28T00:00:00.000Z') === 0)
  t('记录墓碑在更新时生效',
    putRec(tomb, CODE, 'note:n_1', 'note', '2026-03-02T00:00:00.000Z', '2026-03-02T00:00:00.000Z') === 1)
  const gone = read.get(CODE, 'note:n_1')
  t('记录墓碑后 deleted_at 非空、kind 仍保留', gone.deleted_at !== null && gone.kind === 'note')
  t('陈旧记录写打不过墓碑',
    putRec(alive, CODE, 'note:n_1', 'note', '{"text":"late"}', '2026-03-01T12:00:00.000Z') === 0)
  t('四种 kind 各自可写', ['note', 'wrong', 'card', 'setting'].every((k, i) =>
    putRec(alive, CODE, k + ':x' + i, k, '{"v":1}', '2026-03-03T00:00:00.000Z') === 1))
}

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

console.log('\n[0003 迁移 — 账号 / 会话 / 失败计数 / 邮件令牌（第 2 步「开门」）]')
{
  const hasTable = (n) => db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(n).n === 1
  const hasIndex = (n) => db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(n).n === 1

  t('users 建出', hasTable('users'))
  t('sessions 建出', hasTable('sessions'))
  t('login_attempts 建出', hasTable('login_attempts'))
  t('auth_tokens 建出', hasTable('auth_tokens'))

  t('users 有 email_verified_at 列（邮箱验证）', db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name='email_verified_at'").get().n === 1)
  t('users.email 有唯一索引', hasIndex('idx_users_email'))
  t('users.sync_code 有唯一索引（一账号一主码）', hasIndex('idx_users_sync_code'))
  t('sessions 有 (user_id) 索引', hasIndex('idx_sessions_user'))
  t('sessions 有 (expires_at) 索引（过期清理）', hasIndex('idx_sessions_expires'))
  t('login_attempts 有 (scope,key,ts) 索引', hasIndex('idx_login_attempts'))
  t('auth_tokens 有 (user_id,kind) 索引', hasIndex('idx_auth_tokens_user'))

  t('0003 幂等：重复执行不报错', (() => {
    try { db.exec(readFileSync(new URL('./migrations/0003_users_sessions.sql', import.meta.url), 'utf8')); return true }
    catch { return false }
  })())

  // 语义断言：光把表建出来不够，得真撞一次约束
  const insUser = db.prepare('INSERT INTO users (id, email, password_hash, created_at, updated_at, sync_code, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  insUser.run('u_1', 'a@b.com', 'pbkdf2-sha256$1$s$h', 1, 1, null, null)
  t('邮箱重复插入被唯一约束拒绝', (() => {
    try { insUser.run('u_2', 'a@b.com', 'x', 1, 1, null, null); return false } catch { return true }
  })())
  insUser.run('u_2', 'c@d.com', 'x', 1, 1, null, null)
  t('sync_code 全为 NULL 时多行共存（未认领互不冲突）', db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 2)

  db.prepare('UPDATE users SET sync_code = ? WHERE id = ?').run('CODE1', 'u_1')
  t('同一主码被第二个账号占用则被拒（一码只属一账号）', (() => {
    try { db.prepare('UPDATE users SET sync_code = ? WHERE id = ?').run('CODE1', 'u_2'); return false } catch { return true }
  })())

  const insTok = db.prepare('INSERT INTO auth_tokens (token_hash, user_id, kind, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)')
  insTok.run('k1', 'u_1', 'verify', 1, 2, null)
  t('令牌哈希重复插入被拒（主键即一次性，跨 kind 也不许复用）', (() => {
    try { insTok.run('k1', 'u_2', 'reset', 1, 2, null); return false } catch { return true }
  })())
  t('同一用户可同时持有 verify / reset 两类令牌', (() => {
    try { insTok.run('k2', 'u_1', 'reset', 1, 2, null); return true } catch { return false }
  })())

  const insSess = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
  insSess.run('t1', 'u_1', 1, 1, 2)
  t('会话令牌哈希重复插入被拒（主键即唯一）', (() => {
    try { insSess.run('t1', 'u_2', 1, 1, 2); return false } catch { return true }
  })())
}

console.log('\n[schema.sql 与 0003 一致（新建库直接建出最终形态）]')
{
  const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  for (const name of ['users', 'sessions', 'login_attempts', 'auth_tokens']) {
    t(`schema.sql 含表 ${name}`, new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`).test(schemaSql))
  }
  for (const name of ['idx_users_email', 'idx_users_sync_code', 'idx_sessions_user', 'idx_sessions_expires', 'idx_login_attempts', 'idx_auth_tokens_user']) {
    t(`schema.sql 含索引 ${name}`, schemaSql.includes(name))
  }
}
console.log('\n[schema.sql 与 0004 一致（新建库直接建出 kind 列）]')
{
  const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  t("schema.sql 的 sync_data 含 kind 列（默认 'word'）", /kind\s+TEXT NOT NULL DEFAULT 'word'/.test(schemaSql))
  t('schema.sql 含 idx_sync_data_code_kind_updated', schemaSql.includes('idx_sync_data_code_kind_updated'))
}
console.log('\n[schema.sql 单独建库（权威源：空库直接建出最终形态）]')
{
  const fresh = new DatabaseSync(':memory:')
  const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  let ok = true
  try { fresh.exec(schemaSql) } catch (e) { ok = false; console.log('   ', e.message) }
  t('schema.sql 能在空库上跑通', ok)
  t('schema.sql 建出 8 张表（dict_cache/sync_data/sync_progress/rate_limit_events + 账号四表）',
    ok && fresh.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n === 8)
  t('schema.sql 幂等：重复执行不报错', ok && (() => {
    try { fresh.exec(schemaSql); return true } catch { return false }
  })())
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
