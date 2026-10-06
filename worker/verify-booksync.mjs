/**
 * booksync.js 的验证（第 16 步 D14 · 块 1「服务端契约」）
 * 用法: node verify-booksync.mjs
 *
 * 四层：
 *   ① 形状 —— bookId 指纹判据（与 reader/src/utils/bookId.js 同一条正则）、R2 键
 *   ② 会话闸 —— 无会话／死会话 401 / 账号未认领 403 / **URL 带 code 400**（严禁 code 入 URL）
 *   ③ 端到端 —— PUT→GET 往返、重复 PUT 幂等、DELETE（对象＋元信息墓碑）、跨账号隔离
 *   ④ 记录通道 —— kind='book' 真 SQL：push→pull→status 往返、白名单剪枝
 *
 * 为什么要端到端：这一块是「会话 → 账号主码 → R2 键」的活，只测纯函数测不出
 * 「闸漏了」或「键里写错账号」。这里用 node:sqlite 适配器冒充 D1、用 Map 冒充 R2，
 * 端点逻辑一行不改地被真跑一遍（同 verify-authapi.mjs / verify-audioalias.mjs 的手法）。
 * 全程不触网。
 *
 * ⚠️ 手工注入故障自检（照 §12.4）：把 booksync.js 的 gate() 拆掉 → 本文件必须变红 →
 * 还原 → 变绿。那一步不在文件里（改的是源码），跑法与结果记在项目日志。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  handleBookSync, isBookId, bookObjectKey, ROUTE_PREFIX, BOOK_PREFIX, MAX_BOOK_BYTES,
} from './src/booksync.js'
import { handleSync, buildSyncOps, RECORD_KINDS, recordKey } from './src/sync.js'
import { tokenHash } from './src/auth.js'
import worker from './src/index.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const utf8 = s => new TextEncoder().encode(s).length

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const BASE = 'https://my-reader.ferrari11.com'
const NOW = Date.now()

/** D1 形状的适配器（同 verify-authapi.mjs）：run 回 {meta:{changes}}、first 回行或 null */
function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      let args = []
      const api = {
        bind(...a) { args = a; return api },
        async run() { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
        async first() { const row = stmt.get(...args); return row === undefined ? null : row },
        async all() { return { results: stmt.all(...args) } },
      }
      return api
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out },
  }
}

/** R2 形状的适配器（Map 背书）：只实现端点用到的 put / get / head / delete */
function r2() {
  const store = new Map()
  let puts = 0
  return {
    get puts() { return puts },
    keys() { return [...store.keys()] },
    raw(key) { return store.get(key) },
    async put(key, value, opts) {
      const text = typeof value === 'string' ? value : await new Response(value).text()
      store.set(key, { text, size: utf8(text), httpMetadata: (opts && opts.httpMetadata) || null })
      puts++
      return { key, size: utf8(text) }
    },
    async get(key) {
      const e = store.get(key)
      if (!e) return null
      return { key, size: e.size, httpMetadata: e.httpMetadata, text: async () => e.text, body: new Response(e.text).body }
    },
    async head(key) { const e = store.get(key); return e ? { key, size: e.size } : null },
    async delete(key) { store.delete(key) },
  }
}

const CODE_A = 'ABCD2345', CODE_B = 'WXYZ6789'
const USER_A = 'u_booksync_a', USER_B = 'u_booksync_b'
const TOKEN_A = 'tok-booksync-a', TOKEN_B = 'tok-booksync-b'
const BID = 'bk_a1b2c3d4e5f60718'
const BID2 = 'bk_0011223344556677'
const BOOK = { id: BID, title: '自带的书', author: '某人', chapters: [{ id: 'ch-01', paragraphs: ['甲', '乙'] }] }

/** 一个装好账号/会话/哨兵行的空环境（每个断言组一个，互不污染） */
async function newEnv() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const insertUser = `INSERT INTO users
      (id, email, password_hash, created_at, updated_at, email_verified_at, sync_code, deleted_at)
      VALUES (?, ?, 'x', ?, ?, ?, ?, NULL)`
  db.prepare(insertUser).run(USER_A, 'a@booksync.test', NOW, NOW, NOW, CODE_A)
  db.prepare(insertUser).run(USER_B, 'b@booksync.test', NOW, NOW, NOW, CODE_B)
  db.prepare(insertUser).run('u_nocode', 'c@booksync.test', NOW, NOW, NOW, null)
  db.prepare(insertUser).run('u_deleted', 'd@booksync.test', NOW, NOW, NOW, 'DEAD2345')
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(NOW, 'u_deleted')

  const insertSession = `INSERT INTO sessions
      (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  db.prepare(insertSession).run(await tokenHash(TOKEN_A), USER_A, NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash(TOKEN_B), USER_B, NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash('tok-nocode'), 'u_nocode', NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash('tok-deleted'), 'u_deleted', NOW, NOW, NOW + 86400000)
  // 滚动窗口已过的会话（expires_at 在过去）
  db.prepare(insertSession).run(await tokenHash('tok-stale'), USER_A, NOW - 90 * 86400000, NOW - 90 * 86400000, NOW - 86400000)

  // 记录通道认码靠 __meta__ 哨兵行（同 sync.js 的 codeExists）
  db.prepare(`INSERT INTO sync_data (code, word, payload, updated_at, deleted_at)
     VALUES (?, '__meta__', '{"created":"x"}', ?, NULL)`).run(CODE_A, new Date(NOW).toISOString())

  return { db, env: { DB: d1(db), AUDIO: r2() } }
}

/** 造请求；cookie 走 mr_session（与 auth.js 的 SESSION_COOKIE 对齐） */
function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.cookie) headers.Cookie = `mr_session=${opts.cookie}`
  if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  return new Request(BASE + path, {
    method, headers,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  })
}
const bookPath = id => `${ROUTE_PREFIX}${id}`

// ═══ ① 形状 ═══════════════════════════════════════════════════════════════════

console.log('\n[booksync — bookId 形状（与前端同一条正则）]')
t('bk_ + 16 hex 合格', isBookId(BID))
t('全 0 也合格（形状不看内容）', isBookId('bk_' + '0'.repeat(16)))
t('公开书 slug 不合格（D14-d 由形状兜住）', !isBookId('dr-jekyll') && !isBookId('sat-practice'))
t('前缀不对不合格', !isBookId('x_' + '0'.repeat(16)) && !isBookId('bk0' + '0'.repeat(16)))
t('hex 位数不足 16 不合格', !isBookId('bk_' + '0'.repeat(15)))
t('hex 位数超 16 不合格', !isBookId('bk_' + '0'.repeat(17)))
t('大写 hex 不合格（生成侧一律小写）', !isBookId('bk_' + 'A'.repeat(16)))
t('非字符串一律不合格', !isBookId(null) && !isBookId(undefined) && !isBookId(123))
t('R2 键 = books/<code>/<bookId>.json（code 是目录＝租户边界）',
  bookObjectKey(CODE_A, BID) === 'books/ABCD2345/' + BID + '.json')
t('路由前缀不含 code（由会话反推）', ROUTE_PREFIX === '/api/sync/book/' && !ROUTE_PREFIX.includes('code'))
t('books/ 前缀与内置书音频（<bookId>/<ch>.mp3）分开', BOOK_PREFIX === 'books/' && bookObjectKey(CODE_A, BID).startsWith(BOOK_PREFIX))

// ═══ ② 会话闸 ════════════════════════════════════════════════════════════════

console.log('\n[booksync — 会话闸（D14-b：边界＝账号，不是码）]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()
  t('GET 无会话 → 401', (await handleBookSync(req('GET', bookPath(BID)), env)).status === 401)
  t('PUT 无会话 → 401', (await handleBookSync(req('PUT', bookPath(BID), { body: JSON.stringify(BOOK) }), env)).status === 401)
  t('DELETE 无会话 → 401', (await handleBookSync(req('DELETE', bookPath(BID)), env)).status === 401)
  t('伪造 cookie（库里没有这条会话）→ 401',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: 'not-a-real-token' }), env)).status === 401)
  t('会话过了滚动窗口 → 401',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: 'tok-stale' }), env)).status === 401)
  t('账号已注销 → 401',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: 'tok-deleted' }), env)).status === 401)
  t('账号还没认领主码（sync_code 为 NULL）→ 403',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: 'tok-nocode' }), env)).status === 403)
  t('闸先于形状判定：未登录 + 畸形 bookId 也是 401（不泄路径形状）',
    (await handleBookSync(req('GET', ROUTE_PREFIX + 'dr-jekyll'), env)).status === 401)
  t('不带 code 的常规路径可达（此处还没上传 → 404，但绝不是 401/403/400）',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: TOKEN_A }), env)).status === 404)

  // ── URL 里严禁 code（Ferrari 2026-10-06 裁）：不是忽略，是契约违规 → 400 ──
  const urlRes = await handleBookSync(req('GET', bookPath(BID) + '?code=' + CODE_A, { cookie: TOKEN_A }), env)
  t('URL 带 ?code=（哪怕是自己账号的码）→ 400', urlRes.status === 400)
  t('400 响应不回显那个码', !(await urlRes.text()).includes(CODE_A))
  t('URL 带别人的码 → 也是 400',
    (await handleBookSync(req('GET', bookPath(BID) + '?code=' + CODE_B, { cookie: TOKEN_A }), env)).status === 400)
  t('PUT / DELETE 带 ?code= 同样 400',
    (await handleBookSync(req('PUT', bookPath(BID) + '?code=' + CODE_B, { cookie: TOKEN_A, body: JSON.stringify(BOOK) }), env)).status === 400
    && (await handleBookSync(req('DELETE', bookPath(BID) + '?code=' + CODE_A, { cookie: TOKEN_A }), env)).status === 400)
  t('未登录 + ?code= → 401（先问「你是谁」，再看 URL 契约）',
    (await handleBookSync(req('GET', bookPath(BID) + '?code=' + CODE_A), env)).status === 401)
  t('租户只由会话决定：带别人的码也不落盘、不进任何目录', audio.keys().length === 0)
  t('去掉 code 就正常：只写进会话账号自己的目录',
    (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: JSON.stringify(BOOK) }), env)).status === 200
    && eq(audio.keys(), [bookObjectKey(CODE_A, BID)]))
}

// ═══ ③ 端到端 ════════════════════════════════════════════════════════════════

console.log('\n[booksync — PUT → GET 往返]')
{
  const { env, db, env: { AUDIO } } = await newEnv()
  const audio = AUDIO
  const body = JSON.stringify(BOOK)
  const putRes = await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body }), env)
  const putJson = await putRes.json()
  t('PUT 200 + ok', putRes.status === 200 && putJson.ok === true)
  t('PUT 回书 id 与字节数', putJson.bookId === BID && putJson.size === utf8(body))
  t('R2 键恰好一个、且落在本账号目录下', eq(audio.keys(), [bookObjectKey(CODE_A, BID)]))
  t('落盘内容与上传逐字一致（不 parse 后再序列化，避免改字节）',
    audio.raw(bookObjectKey(CODE_A, BID)).text === body)
  t('对象带 application/json 元数据',
    audio.raw(bookObjectKey(CODE_A, BID)).httpMetadata.contentType === 'application/json')

  const getRes = await handleBookSync(req('GET', bookPath(BID), { cookie: TOKEN_A }), env)
  t('GET 200', getRes.status === 200)
  t('GET 回的正文与上传逐字一致', (await getRes.text()) === body)
  t('GET Content-Type = application/json', getRes.headers.get('Content-Type') === 'application/json')
  t('GET Cache-Control = private, no-store（URL 不含账号，共享缓存会串号）',
    getRes.headers.get('Cache-Control') === 'private, no-store')
  t('GET 不存在的书 → 404',
    (await handleBookSync(req('GET', bookPath(BID2), { cookie: TOKEN_A }), env)).status === 404)
  t('同一个 URL、换账号 → 404（租户隔离：键里的 code 是承重的）',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: TOKEN_B }), env)).status === 404)
  t('未登录读别人的书也一样 401（先问「你是谁」）',
    (await handleBookSync(req('GET', bookPath(BID)), env)).status === 401)
}

console.log('\n[booksync — 重复 PUT 幂等（同一内容指纹 = 同一个键）]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()
  const body = JSON.stringify(BOOK)
  const r1 = await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body }), env)
  const r2 = await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body }), env)
  t('两次都 200', r1.status === 200 && r2.status === 200)
  t('确实是两次写入、但只有一个键（覆盖写，不新建）', audio.puts === 2 && audio.keys().length === 1)
  const v2 = JSON.stringify({ ...BOOK, title: '改过标题的书' })
  await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: v2 }), env)
  t('同键再 PUT 覆盖为新内容（最后写入者胜）', audio.raw(bookObjectKey(CODE_A, BID)).text === v2)
  t('覆盖后仍只有一个键', audio.keys().length === 1)
  t('不同书（不同指纹）各占一个键',
    (await (async () => {
      await handleBookSync(req('PUT', bookPath(BID2), { cookie: TOKEN_A, body: JSON.stringify({ id: BID2 }) }), env)
      return audio.keys().length === 2 && audio.keys().includes(bookObjectKey(CODE_A, BID2))
    })()))
}

console.log('\n[booksync — DELETE（对象 ＋ 元信息墓碑）]')
{
  const { env, db, env: { AUDIO: audio } } = await newEnv()
  // 元信息先经记录通道落一条存活行（模拟块 2 的客户端已推过）
  db.prepare(`INSERT INTO sync_data (code, word, kind, payload, updated_at, deleted_at)
      VALUES (?, ?, 'book', ?, ?, NULL)`)
    .run(CODE_A, recordKey('book', BID), JSON.stringify({ bookId: BID, title: '自带的书' }), new Date(NOW).toISOString())
  await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: JSON.stringify(BOOK) }), env)

  const del = await handleBookSync(req('DELETE', bookPath(BID), { cookie: TOKEN_A }), env)
  const delJson = await del.json()
  t('DELETE 200 + ok', del.status === 200 && delJson.ok === true)
  t('删掉了 R2 对象（removed=true）', delJson.removed === true)
  t('R2 里已无此键', audio.keys().length === 0)
  const row = db.prepare('SELECT kind, payload, deleted_at FROM sync_data WHERE code = ? AND word = ?')
    .get(CODE_A, recordKey('book', BID))
  t('元信息被写成墓碑（payload=null、deleted_at 有值、kind 不变）',
    !!row && row.payload === 'null' && !!row.deleted_at && row.kind === 'book')
  t('DELETE 后 GET → 404',
    (await handleBookSync(req('GET', bookPath(BID), { cookie: TOKEN_A }), env)).status === 404)
  const again = await handleBookSync(req('DELETE', bookPath(BID), { cookie: TOKEN_A }), env)
  t('再删一次仍 200、removed=false（幂等）', again.status === 200 && (await again.json()).removed === false)

  await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: JSON.stringify(BOOK) }), env)
  const bDel = await (await handleBookSync(req('DELETE', bookPath(BID), { cookie: TOKEN_B }), env)).json()
  t('B 删同一个 bookId：B 目录里本来没有 → removed=false，A 的对象原封不动',
    bDel.removed === false && !!audio.raw(bookObjectKey(CODE_A, BID)))
}

console.log('\n[booksync — 输入闸]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()
  t('非指纹 bookId → 400（公开书 slug 进不来）',
    (await handleBookSync(req('GET', ROUTE_PREFIX + 'dr-jekyll', { cookie: TOKEN_A }), env)).status === 400)
  t('多一段路径 → 400',
    (await handleBookSync(req('GET', ROUTE_PREFIX + BID + '/extra', { cookie: TOKEN_A }), env)).status === 400)
  t('编码过的斜杠也进不去（%2F 解出来还是 /）',
    (await handleBookSync(req('GET', ROUTE_PREFIX + BID + '%2Fextra', { cookie: TOKEN_A }), env)).status === 400)
  t('PUT 空 body → 400', (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A }), env)).status === 400)
  t('PUT 非 JSON → 400',
    (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: '<html>' }), env)).status === 400)
  t('PUT JSON 数组 → 400',
    (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: '[]' }), env)).status === 400)
  t('PUT 载荷自报 id 与路径不符 → 400（键即权威）',
    (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ ...BOOK, id: BID2 }) }), env)).status === 400)
  t('超上限 → 413',
    (await handleBookSync(req('PUT', bookPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ id: BID, pad: 'x'.repeat(MAX_BOOK_BYTES) }) }), env)).status === 413)
  t('拒收的请求一个字节都没落盘', audio.keys().length === 0 && audio.puts === 0)
  t('不支持的方法不在这里接（返回 null 交回主路由）',
    (await handleBookSync(req('POST', bookPath(BID), { cookie: TOKEN_A, body: '{}' }), env)) === null)
  t('路径不匹配 → null（前缀不越界）',
    (await handleBookSync(req('GET', '/api/sync/bookX' + BID, { cookie: TOKEN_A }), env)) === null)
}

console.log('\n[index.js — 分发与 CORS 先后]')
{
  const { env } = await newEnv()
  const body = JSON.stringify(BOOK)
  const quiet = console.log
  let pre, unauth, put, ok, wrongMethod, badPath
  console.log = () => {}
  try {
    pre = await worker.fetch(req('OPTIONS', bookPath(BID), { headers: { Origin: 'https://my-reader.ferrari11.com' } }), env)
    unauth = await worker.fetch(req('GET', bookPath(BID)), env)
    put = await worker.fetch(req('PUT', bookPath(BID), { cookie: TOKEN_A, body }), env)
    ok = await worker.fetch(req('GET', bookPath(BID), { cookie: TOKEN_A }), env)
    wrongMethod = await worker.fetch(req('POST', bookPath(BID), { cookie: TOKEN_A, body: '{}' }), env)
    badPath = await worker.fetch(req('GET', '/api/sync/bookX' + BID, { cookie: TOKEN_A }), env)
  } finally { console.log = quiet }

  t('OPTIONS 预检在会话闸之前被答掉（204）', pre.status === 204)
  t('预检回自家 Origin（ACAO）', pre.headers.get('Access-Control-Allow-Origin') === 'https://my-reader.ferrari11.com')
  t('预检允许的动词含 PUT 与 DELETE',
    /PUT/.test(pre.headers.get('Access-Control-Allow-Methods')) && /DELETE/.test(pre.headers.get('Access-Control-Allow-Methods')))
  t('经主入口：未登录 GET → 401（分发确实接上了）', unauth.status === 401)
  t('经主入口：PUT → 200 且 GET 能原样取回', put.status === 200 && ok.status === 200 && (await ok.text()) === body)
  t('经主入口：不支持的动词落到 404', wrongMethod.status === 404)
  t('经主入口：不相干的路径不受影响（仍是 404）', badPath.status === 404)
}

console.log("\n[sync.js — kind='book' 元信息通道（纯逻辑）]")
{
  const now = Date.parse('2026-10-06T12:00:00.000Z')
  const T = '2026-10-06T11:00:00.000Z'
  t('RECORD_KINDS 含 book（五类）', RECORD_KINDS.size === 5 && RECORD_KINDS.has('book'))
  const ops = buildSyncOps({
    records: [
      {
        kind: 'book', id: BID, updatedAt: T,
        payload: {
          bookId: 'bk_ffffffffffffffff', title: '自带的书', author: '某人',
          chapterCount: '12', charCount: 3456.7, addedAt: T,
          chapters: [{ id: 'ch-01' }], coverUrl: 'data:image/png;base64,AAAA', junk: 1,
        },
      },
      { kind: 'book', id: 'dr-jekyll', updatedAt: T, payload: { title: '公开书' } },
      { kind: 'book', id: BID2, updatedAt: T, payload: 'not-an-object' },
    ],
  }, now)
  const op = ops.get(recordKey('book', BID))
  t('合法 book 记录走命名空间键、kind 原样', !!op && op.kind === 'book' && op.deleted === false)
  t('公开书 slug 被静默丢弃', !ops.has(recordKey('book', 'dr-jekyll')))
  t('非对象载荷被静默丢弃', !ops.has(recordKey('book', BID2)))
  const p = JSON.parse(op.payload)
  t('载荷只剩白名单七字段（chapters/coverUrl/junk 全被剪）',
    eq(Object.keys(p).sort(), ['addedAt', 'author', 'bookId', 'chapterCount', 'charCount', 'title', 'updatedAt']))
  t('载荷自报的 bookId 被改成键里的 id（键即权威）', p.bookId === BID)
  t('计数字段归一：\'12\' → 12、3456.7 → 3456', p.chapterCount === 12 && p.charCount === 3456)
  t('时间戳照旧归一进载荷', p.addedAt === T && p.updatedAt === T)

  const tomb = buildSyncOps({ recordTombstones: [{ kind: 'book', id: BID, deletedAt: T }] }, now)
  t('book 墓碑也走这条通道', tomb.get(recordKey('book', BID)).deleted === true)
}

console.log("\n[sync.js — kind='book' 真 SQL 往返（push → pull → status）]")
{
  const { env } = await newEnv()
  const T = new Date(NOW).toISOString()
  const push = await handleSync(req('POST', '/api/sync/push', {
    body: JSON.stringify({
      code: CODE_A,
      records: [{
        kind: 'book', id: BID, updatedAt: T,
        payload: {
          bookId: BID, title: '自带的书', author: '某人', chapterCount: 12, charCount: 3456,
          addedAt: T, chapters: [{ id: 'ch-01' }], coverUrl: 'x',
        },
      }],
    }),
  }), env)
  const pushJson = await push.json()
  t('push 收下 1 条', push.status === 200 && pushJson.accepted === 1)

  const pull = await handleSync(req('GET', '/api/sync/pull?code=' + CODE_A), env)
  const pj = await pull.json()
  t('pull 回在 records 数组里（kind=book、id=指纹）',
    pj.records.length === 1 && pj.records[0].kind === 'book' && pj.records[0].id === BID)
  t('pull 回的载荷已按白名单剪过（无 chapters/coverUrl）',
    pj.records[0].payload.chapters === undefined && pj.records[0].payload.coverUrl === undefined)
  t('pull 不把它混进 words 通道', Object.keys(pj.words).length === 0)

  const status = await (await handleSync(req('GET', '/api/sync/status?code=' + CODE_A), env)).json()
  t('status 的 counts 多了 book 这一格', status.counts.book === 1)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)