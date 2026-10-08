/**
 * bookaudio.js 的验证（第 17 步 D17 · 块 B「服务端上传/读取路由」）
 * 用法: node verify-bookaudio.mjs
 *
 * 五层：
 *   ① 形状 —— 文件名分类、R2 键（user/<code>/<bookId>/<file>）、前缀不吃 /api/audio
 *   ② 会话闸 —— 无会话 401 / 账号未认领 403 / **URL 带 code 400**（顺序：未登录带码仍 401）
 *   ③ 端到端 —— PUT→GET 往返（mp3 字节一致 / timings 一致 / index 一定 no-store）、跨账号隔离
 *   ④ Range —— 206 长度与 Content-Range、后缀式、越界 416
 *   ⑤ 配额与限流 —— 单文件上限、本数上限、音频总量上限（含 R2 list cursor 循环）、上传限流
 *   ⑥ 清空该书音频（D25／D25-f）—— 只删音频、正文保留、空索引必写、本数／字节放回；
 *      同趟作废 D1 的行（有章在跑 → 409，作废失败 → 503，两种都不许动 R2）
 *
 * 为什么要端到端：这块是「会话 → 账号主码 → R2 键」的活，只测纯函数测不出「闸漏了」
 * 或「键里写错账号」。用 node:sqlite 适配器冒充 D1、用 Map 冒充 R2（含 list 分页），
 * 端点逻辑一行不改地被真跑一遍（同 verify-booksync.mjs 的手法）。全程不触网。
 *
 * ⚠️ 手工注入故障自检（照 §12.4 / 本块 §7）：把 bookaudio.js 的 gate() 拆掉（直接放行）
 *    → 本文件必须变红 → 还原 → 记 SHA256 逐字节一致 → 再全绿。那一步不在文件里
 *    （改的是源码），跑法与结果记在项目日志。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  handleBookAudio, audioObjectKey, classifyFile, purgeBookAudio, purgeAccountAudio,
  ROUTE_PREFIX, USER_PREFIX, INDEX_FILE,
  MAX_AUDIO_FILE_BYTES, DEFAULT_MAX_ACCOUNT_BYTES, DEFAULT_MAX_BOOKS, DEFAULT_UPLOAD_PER_MIN,
} from './src/bookaudio.js'
import { tokenHash } from './src/auth.js'
import { purgePrefix } from './src/audiostore.js'
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

/** D1 形状的适配器（同 verify-booksync.mjs）：run 回 {meta:{changes}}、first 回行或 null */
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

/**
 * R2 形状的适配器（Map 背书）：put / get / head / delete / list。
 * pageLimit 用来**模拟 list 分页**（真实 R2 每页上限 1000）—— 逼出 cursor 循环的 bug。
 */
function r2(pageLimit = 1000) {
  const store = new Map()
  let puts = 0
  const toBytes = value => {
    if (typeof value === 'string') return new TextEncoder().encode(value)
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    return new TextEncoder().encode(String(value))
  }
  return {
    get puts() { return puts },
    keys() { return [...store.keys()] },
    raw(key) { return store.get(key) },
    async put(key, value, opts) {
      store.set(key, { bytes: toBytes(value), httpMetadata: (opts && opts.httpMetadata) || null })
      puts++
      return { key, size: store.get(key).bytes.length }
    },
    async get(key, opts) {
      const e = store.get(key)
      if (!e) return null
      let bytes = e.bytes
      if (opts && opts.range) bytes = e.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
      return {
        key, size: e.bytes.length, httpMetadata: e.httpMetadata,
        text: async () => new TextDecoder().decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer,
        body: new Response(bytes).body,
      }
    },
    async head(key) { const e = store.get(key); return e ? { key, size: e.bytes.length } : null },
    // 块 E：清理按**批量**删（真 R2 支持一次删多个键）
    async delete(keyOrKeys) { for (const k of (Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys])) store.delete(k) },
    async list(opts = {}) {
      const prefix = opts.prefix || ''
      const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort()
      const start = opts.cursor ? Number(opts.cursor) : 0
      const end = Math.min(start + pageLimit, all.length)
      const objects = all.slice(start, end).map(k => ({ key: k, size: store.get(k).bytes.length }))
      const truncated = end < all.length
      return { objects, truncated, ...(truncated ? { cursor: String(end) } : {}) }
    },
  }
}

const CODE_A = 'ABCD2345', CODE_B = 'WXYZ6789'
const USER_A = 'u_bookaudio_a', USER_B = 'u_bookaudio_b'
const TOKEN_A = 'tok-bookaudio-a', TOKEN_B = 'tok-bookaudio-b'
const BID = 'bk_a1b2c3d4e5f60718'
const BID2 = 'bk_0011223344556677'
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) // 16 bytes
const TIMINGS = { duration: 3.2, paragraphs: { 'p-01-001': 0.0, 'p-01-002': 1.95 } }
const INDEX = { book: BID, withAudio: ['ch-01'], missing: {} }

/** 一个装好账号/会话的空环境（每个断言组一个，互不污染）；overrides 覆盖 env */
async function newEnv(overrides = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const insertUser = `INSERT INTO users
      (id, email, password_hash, created_at, updated_at, email_verified_at, sync_code, deleted_at)
      VALUES (?, ?, 'x', ?, ?, ?, ?, NULL)`
  db.prepare(insertUser).run(USER_A, 'a@bookaudio.test', NOW, NOW, NOW, CODE_A)
  db.prepare(insertUser).run(USER_B, 'b@bookaudio.test', NOW, NOW, NOW, CODE_B)
  db.prepare(insertUser).run('u_nocode', 'c@bookaudio.test', NOW, NOW, NOW, null)
  db.prepare(insertUser).run('u_deleted', 'd@bookaudio.test', NOW, NOW, NOW, 'DEAD2345')
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(NOW, 'u_deleted')

  const insertSession = `INSERT INTO sessions
      (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  db.prepare(insertSession).run(await tokenHash(TOKEN_A), USER_A, NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash(TOKEN_B), USER_B, NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash('tok-nocode'), 'u_nocode', NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash('tok-deleted'), 'u_deleted', NOW, NOW, NOW + 86400000)
  db.prepare(insertSession).run(await tokenHash('tok-stale'), USER_A, NOW - 90 * 86400000, NOW - 90 * 86400000, NOW - 86400000)

  const env = { DB: d1(db), AUDIO: r2() }
  Object.assign(env, overrides)
  return { db, env }
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
const audioPath = (id, file) => `${ROUTE_PREFIX}${id}/audio/${file}`
const indexPath = id => `${ROUTE_PREFIX}${id}/${INDEX_FILE}`

// ═══ ① 形状 ═══════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — 文件名分类与 R2 键]')
t('R2 键 = user/<code>/<bookId>/<file>（code 是目录＝租户边界）',
  audioObjectKey(CODE_A, BID, 'ch-01.mp3') === `user/ABCD2345/${BID}/ch-01.mp3`)
t('USER_PREFIX = user/', USER_PREFIX === 'user/' && audioObjectKey(CODE_A, BID, INDEX_FILE).startsWith(USER_PREFIX))
t('路由前缀不含 code（由会话反推）', ROUTE_PREFIX === '/api/book/' && !ROUTE_PREFIX.includes('code'))
t('前缀不吃老路由：/api/audio/… 与 /api/sync/book/… 都不以 /api/book/ 开头',
  !'/api/audio/x/y'.startsWith(ROUTE_PREFIX) && !'/api/sync/book/x'.startsWith(ROUTE_PREFIX))
t('ch-01.mp3 → mp3 / audio/mpeg',
  (() => { const c = classifyFile('ch-01.mp3'); return c && c.kind === 'mp3' && c.ch === 'ch-01' && c.contentType === 'audio/mpeg' })())
t('ch-01.timings.json → timings / application/json',
  (() => { const c = classifyFile('ch-01.timings.json'); return c && c.kind === 'timings' && c.ch === 'ch-01' && c.contentType === 'application/json' })())
t('audio-index.json → index', (() => { const c = classifyFile(INDEX_FILE); return c && c.kind === 'index' && c.contentType === 'application/json' })())
t('不认识的文件名一律 null',
  classifyFile('ch-01.txt') === null && classifyFile('ch-01') === null
  && classifyFile('a/b.mp3') === null && classifyFile('') === null
  && classifyFile('.mp3') === null && classifyFile('ch-01.MP3') === null)
t('单文件上限常量 = 8 MB（手抄 MAX_BOOK_BYTES）', MAX_AUDIO_FILE_BYTES === 8 * 1024 * 1024)
t('默认配额常量：1 GiB（D23 由 500 MiB 上调）/ 20 本 / 120 次每分',
  DEFAULT_MAX_ACCOUNT_BYTES === 1024 * 1024 * 1024 && DEFAULT_MAX_BOOKS === 20 && DEFAULT_UPLOAD_PER_MIN === 120)

// ═══ ② 会话闸 ════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — 会话闸（边界＝账号）]')
{
  const { env } = await newEnv()
  t('GET 音频 无会话 → 401', (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3')), env)).status === 401)
  t('PUT 音频 无会话 → 401',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)).status === 401)
  t('PUT index 无会话 → 401',
    (await handleBookAudio(req('PUT', indexPath(BID), { body: JSON.stringify(INDEX) }), env)).status === 401)
  t('伪造 cookie（库里没这条会话）→ 401',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: 'not-a-real-token' }), env)).status === 401)
  t('会话过了滚动窗口 → 401',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: 'tok-stale' }), env)).status === 401)
  t('账号已注销 → 401',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: 'tok-deleted' }), env)).status === 401)
  t('账号还没认领主码（sync_code 为 NULL）→ 403',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: 'tok-nocode' }), env)).status === 403)
  t('PUT 同样 403',
    (await handleBookAudio(req('PUT', indexPath(BID), { cookie: 'tok-nocode', body: JSON.stringify(INDEX) }), env)).status === 403)
  t('闸先于形状判定：未登录 + 畸形 bookId 也是 401（不泄路径形状）',
    (await handleBookAudio(req('GET', ROUTE_PREFIX + 'dr-jekyll/audio/a.mp3'), env)).status === 401)

  const urlRes = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3') + '?code=' + CODE_A, { cookie: TOKEN_A }), env)
  t('URL 带 ?code=（哪怕自己账号的码）→ 400', urlRes.status === 400)
  t('400 响应不回显那个码', !(await urlRes.text()).includes(CODE_A))
  t('URL 带别人的码 → 也是 400',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3') + '?code=' + CODE_B, { cookie: TOKEN_A }), env)).status === 400)
  t('index 路径带 ?code= 同样 400',
    (await handleBookAudio(req('GET', indexPath(BID) + '?code=' + CODE_A, { cookie: TOKEN_A }), env)).status === 400)
  t('未登录 + ?code= → 401（先问「你是谁」，再看 URL 契约）',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3') + '?code=' + CODE_A), env)).status === 401)
}

// ═══ ③ 端到端 ════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — PUT → GET 往返]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()

  const putMp3 = await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  const putMp3Json = await putMp3.json()
  t('PUT mp3 → 200 + ok + size', putMp3.status === 200 && putMp3Json.ok === true && putMp3Json.size === MP3.length)
  t('mp3 落在自己账号目录的键上', eq(audio.keys(), [audioObjectKey(CODE_A, BID, 'ch-01.mp3')]))

  const getMp3 = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)
  t('GET mp3 → 200', getMp3.status === 200)
  const got = new Uint8Array(await getMp3.arrayBuffer())
  t('GET mp3 字节与原字节逐个一致', got.length === MP3.length && MP3.every((v, i) => got[i] === v))
  t('GET mp3 Content-Type = audio/mpeg', getMp3.headers.get('Content-Type') === 'audio/mpeg')
  t('GET mp3 Cache-Control = public, max-age=31536000, immutable',
    getMp3.headers.get('Cache-Control') === 'public, max-age=31536000, immutable')
  t('GET mp3 Accept-Ranges = bytes', getMp3.headers.get('Accept-Ranges') === 'bytes')
  t('GET mp3 不带 no-store（immutable 才对）', !/no-store/.test(getMp3.headers.get('Cache-Control')))

  const putT = await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A, body: JSON.stringify(TIMINGS) }), env)
  t('PUT timings → 200', putT.status === 200)
  const getT = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A }), env)
  t('GET timings → 200 且往返一致', getT.status === 200 && eq(await getT.json(), TIMINGS))
  t('GET timings Content-Type = application/json', getT.headers.get('Content-Type') === 'application/json')

  const putI = await handleBookAudio(req('PUT', indexPath(BID), { cookie: TOKEN_A, body: JSON.stringify(INDEX) }), env)
  t('PUT audio-index → 200', putI.status === 200)
  const getI = await handleBookAudio(req('GET', indexPath(BID), { cookie: TOKEN_A }), env)
  t('GET audio-index → 200 且往返一致', getI.status === 200 && eq(await getI.json(), INDEX))
  t('audio-index **一定 no-store**（前端轮询靠它翻 pending）', getI.headers.get('Cache-Control') === 'no-store')
  t('audio-index 不带 immutable', !/immutable/.test(getI.headers.get('Cache-Control')))

  // 跨账号隔离：同一个 URL、换 B 的会话 → 读不到
  const bGet = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_B }), env)
  t('同 URL 换 B 的会话 → 404（键里的 code 是承重的）', bGet.status === 404)
  t('B 的目录里 0 个对象（结构性隔离，不靠 if 兜）', audio.keys().every(k => !k.startsWith(`user/${CODE_B}/`)))
  t('GET 不存在的章 → 404', (await handleBookAudio(req('GET', audioPath(BID2, 'ch-09.mp3'), { cookie: TOKEN_A }), env)).status === 404)
  const missIndex = await handleBookAudio(req('GET', indexPath(BID2), { cookie: TOKEN_A }), env)
  t('GET 不存在的 index → 404 且仍 no-store', missIndex.status === 404 && missIndex.headers.get('Cache-Control') === 'no-store')
}

// ═══ ④ Range ═════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — GET 的 Range → 206 / 416]')
{
  const { env } = await newEnv()
  await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)

  const r1 = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=0-9' } }), env)
  t('bytes=0-9 → 206', r1.status === 206)
  t('bytes=0-9 → Content-Range bytes 0-9/16', r1.headers.get('Content-Range') === 'bytes 0-9/16')
  t('bytes=0-9 → Content-Length 10', r1.headers.get('Content-Length') === '10')
  const b1 = new Uint8Array(await r1.arrayBuffer())
  t('bytes=0-9 → 长度 10 且是前 10 字节', b1.length === 10 && eq([...b1], [...MP3.slice(0, 10)]))

  const r2s = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=-4' } }), env)
  t('后缀 bytes=-4 → 206 + bytes 12-15/16', r2s.status === 206 && r2s.headers.get('Content-Range') === 'bytes 12-15/16')
  t('后缀 bytes=-4 → 末 4 字节', eq([...new Uint8Array(await r2s.arrayBuffer())], [...MP3.slice(12)]))

  const r3 = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=4-' } }), env)
  t('bytes=4- → 206 + bytes 4-15/16（到文件尾）', r3.status === 206 && r3.headers.get('Content-Range') === 'bytes 4-15/16')

  const r4 = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=999-' } }), env)
  t('越界 bytes=999- → 416', r4.status === 416)
  t('416 带 Content-Range bytes */16', r4.headers.get('Content-Range') === 'bytes */16')

  const r5 = await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=0-1,3-4' } }), env)
  t('多段 Range → 按 RFC 忽略，回整份 200', r5.status === 200)
  t('多段 Range 200 的体是整份 16 字节', new Uint8Array(await r5.arrayBuffer()).length === MP3.length)

  t('Range 打在不存在对象上 → 404（不是 416）',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-09.mp3'), { cookie: TOKEN_A, headers: { Range: 'bytes=0-9' } }), env)).status === 404)
}

// ═══ ⑤ 幂等 ══════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — 重复 PUT 幂等（同一章 = 同一个键）]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()
  const P = (file, body, ct) => handleBookAudio(req('PUT', audioPath(BID, file), { cookie: TOKEN_A, headers: ct ? { 'Content-Type': ct } : {}, body }), env)
  await P('ch-01.mp3', MP3, 'audio/mpeg')
  const v2 = new Uint8Array([9, 9, 9, 9, 9])
  const again = await P('ch-01.mp3', v2, 'audio/mpeg')
  t('同章两次 PUT 都 200', again.status === 200)
  t('对象数不变（覆盖写，不新建）', audio.keys().length === 1 && audio.keys()[0] === audioObjectKey(CODE_A, BID, 'ch-01.mp3'))
  const back = new Uint8Array(await (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)).arrayBuffer())
  t('GET 回的是最后一份（最后写入者胜）', eq([...back], [...v2]))
  await P('ch-02.mp3', MP3, 'audio/mpeg')
  t('不同章各占一个键', audio.keys().length === 2 && audio.keys().includes(audioObjectKey(CODE_A, BID, 'ch-02.mp3')))
}

// ═══ ⑥ 输入闸 ════════════════════════════════════════════════════════════════

console.log('\n[bookaudio — 输入闸]')
{
  const { env, env: { AUDIO: audio } } = await newEnv()
  t('非指纹 bookId（公开书 slug）→ 400',
    (await handleBookAudio(req('GET', audioPath('dr-jekyll', 'ch-01.mp3'), { cookie: TOKEN_A }), env)).status === 400)
  t('多一段路径 → 400',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3') + '/extra', { cookie: TOKEN_A }), env)).status === 400)
  t('编码过的斜杠进不去（%2F 解出来还是 /）',
    (await handleBookAudio(req('GET', `${ROUTE_PREFIX}${BID}%2Faudio/ch-01.mp3`, { cookie: TOKEN_A }), env)).status === 400)
  t('不认识的文件名 → 400',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.txt'), { cookie: TOKEN_A }), env)).status === 400)
  t('缺 audio 段 → 400',
    (await handleBookAudio(req('GET', `${ROUTE_PREFIX}${BID}/x`, { cookie: TOKEN_A }), env)).status === 400)
  t('PUT mp3 空体 → 400',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' } }), env)).status === 400)
  t('PUT timings 非 JSON → 400',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A, body: '<html>' }), env)).status === 400)
  t('PUT timings JSON 数组 → 400',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A, body: '[]' }), env)).status === 400)
  t('PUT index JSON 数组 → 400',
    (await handleBookAudio(req('PUT', indexPath(BID), { cookie: TOKEN_A, body: '[]' }), env)).status === 400)
  t('mp3 超上限 → 413',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array(MAX_AUDIO_FILE_BYTES + 1) }), env)).status === 413)
  t('拒收的请求一个字节都没落盘', audio.keys().length === 0 && audio.puts === 0)
  t('不认识的方法不在这里接（返回 null 交回主路由）',
    (await handleBookAudio(req('POST', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, body: '{}' }), env)) === null)
  // D25 起 DELETE 归本路由管：单章 / 单文件那种形状**不做删除** → 405（Allow 只列真正支持的两个动词）
  t('DELETE 单章 / 单文件 → 405 Allow: PUT, GET（D25-d：不做单章删）',
    await (async () => {
      const a = await handleBookAudio(req('DELETE', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)
      const b = await handleBookAudio(req('DELETE', indexPath(BID), { cookie: TOKEN_A }), env)
      return a.status === 405 && a.headers.get('Allow') === 'PUT, GET'
        && b.status === 405 && b.headers.get('Allow') === 'PUT, GET'
    })())
  t('前缀不越界 → null（/api/bookX… / /api/audio/…）',
    (await handleBookAudio(req('GET', '/api/bookX' + BID + '/audio/ch-01.mp3', { cookie: TOKEN_A }), env)) === null
    && (await handleBookAudio(req('GET', '/api/audio/x/y.mp3', { cookie: TOKEN_A }), env)) === null)
}

// ═══ ⑦ 配额与限流 ════════════════════════════════════════════════════════════

console.log('\n[bookaudio — 配额：本数上限]')
{
  const { env } = await newEnv({ AUDIO_MAX_BOOKS: '1' })
  t('第一本书的第一章 → 200',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)).status === 200)
  t('同一本书的第二章不受本数上限影响 → 200',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-02.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)).status === 200)
  const second = await handleBookAudio(req('PUT', audioPath(BID2, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  t('第二本书（新 bookId）→ 403 本数超限', second.status === 403 && (await second.json()).error === 'book limit reached')
}

console.log('\n[bookaudio — 配额：音频总量上限]')
{
  const { env } = await newEnv({ AUDIO_MAX_ACCOUNT_BYTES: '20' })
  const A = (file, n) => handleBookAudio(req('PUT', audioPath(BID, file), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array(n) }), env)
  t('10 字节 → 200', (await A('ch-01.mp3', 10)).status === 200)
  t('再 10 字节（恰好到上限）→ 200', (await A('ch-02.mp3', 10)).status === 200)
  const over = await A('ch-03.mp3', 10)
  t('再 10 字节（超上限）→ 403 且 error=audio storage limit reached',
    over.status === 403 && (await over.json()).error === 'audio storage limit reached')
  t('覆盖同一章（5 字节）不算新增 → 200', (await A('ch-01.mp3', 5)).status === 200)
  const reread = new Uint8Array(await (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)).arrayBuffer())
  t('覆盖后 GET 回 5 字节新内容', reread.length === 5 && eq([...reread], [0, 0, 0, 0, 0]))
}

console.log('\n[bookaudio — 配额：R2 list 必须按 cursor 循环（每页上限 1000）]')
{
  const { env } = await newEnv({ AUDIO: r2(1), AUDIO_MAX_ACCOUNT_BYTES: '25' })
  // 直接预置两个 10 字节对象（同书不同章）；pageLimit=1 → 只有循环才数得到全部 20 字节
  await env.AUDIO.put(audioObjectKey(CODE_A, BID, 'ch-01.mp3'), new Uint8Array(10))
  await env.AUDIO.put(audioObjectKey(CODE_A, BID, 'ch-02.mp3'), new Uint8Array(10))
  const third = await handleBookAudio(req('PUT', audioPath(BID, 'ch-03.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array(10) }), env)
  t('只数第一页会漏判；403 证明跨页也数到了（20+10 > 25）',
    third.status === 403 && (await third.json()).error === 'audio storage limit reached')

  const { env: env2 } = await newEnv({ AUDIO: r2(1), AUDIO_MAX_ACCOUNT_BYTES: '35' })
  await env2.AUDIO.put(audioObjectKey(CODE_A, BID, 'ch-01.mp3'), new Uint8Array(10))
  await env2.AUDIO.put(audioObjectKey(CODE_A, BID, 'ch-02.mp3'), new Uint8Array(10))
  t('反向对照：上限放到 35 → 同一次上传 200（不是恒 403）',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-03.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array(10) }), env2)).status === 200)
}

console.log('\n[bookaudio — 上传端点按账号限流]')
{
  const { env } = await newEnv({ AUDIO_UPLOAD_PER_MIN: '2' })
  const A = file => handleBookAudio(req('PUT', audioPath(BID, file), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  t('第 1 次 → 200', (await A('ch-01.mp3')).status === 200)
  t('第 2 次 → 200', (await A('ch-02.mp3')).status === 200)
  const third = await A('ch-03.mp3')
  t('第 3 次 → 429', third.status === 429)
  t('429 带 Retry-After', third.headers.get('Retry-After') === '60')
  t('限流是按账号的：B 不受 A 的窗口影响',
    (await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_B, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)).status === 200)
}

// ═══ ⑧ 主入口分发 ════════════════════════════════════════════════════════════

console.log('\n[index.js — 分发与 CORS 先后]')
{
  const { env } = await newEnv()
  const quiet = console.log
  let pre, unauth, put, ok, wrongMethod, badPath, legacy
  console.log = () => {}
  try {
    pre = await worker.fetch(req('OPTIONS', audioPath(BID, 'ch-01.mp3'), { headers: { Origin: 'https://my-reader.ferrari11.com' } }), env)
    unauth = await worker.fetch(req('GET', audioPath(BID, 'ch-01.mp3')), env)
    put = await worker.fetch(req('PUT', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
    ok = await worker.fetch(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)
    wrongMethod = await worker.fetch(req('POST', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A, body: '{}' }), env)
    badPath = await worker.fetch(req('GET', '/api/bookX' + BID + '/audio/ch-01.mp3', { cookie: TOKEN_A }), env)
    legacy = await worker.fetch(req('GET', '/api/audio/dr-jekyll-and-mr-hyde/ch-01.mp3'), env)
  } finally { console.log = quiet }

  t('OPTIONS 预检在会话闸之前被答掉（204）', pre.status === 204)
  t('预检回自家 Origin（ACAO）', pre.headers.get('Access-Control-Allow-Origin') === 'https://my-reader.ferrari11.com')
  t('经主入口：未登录 GET → 401（分发确实接上了）', unauth.status === 401)
  t('经主入口：PUT → 200 且 GET 能原样取回',
    put.status === 200 && ok.status === 200 && eq([...new Uint8Array(await ok.arrayBuffer())], [...MP3]))
  t('经主入口：不支持的动词落到 404', wrongMethod.status === 404)
  t('经主入口：不相干的路径不受影响（仍是 404）', badPath.status === 404)
  t('老 /api/audio 路由没被吃掉（空桶 → 404，且不因书路由而 401）', legacy.status === 404)
}

// ═══ ⑨ D25 清空该书音频 ══════════════════════════════════════════════════════

console.log('\n[bookaudio — D25 清空该书音频：DELETE /api/book/<bookId>/audio]')
{
  const BID_EMPTY = 'bk_0f0e0d0c0b0a0908' // 从没生成过任何对象的书
  const clearPath = id => `${ROUTE_PREFIX}${id}/audio`
  const bodyKey = id => `books/${CODE_A}/${id}.json`
  const underBook = id => k => k.startsWith(`user/${CODE_A}/${id}/`)
  const { env, env: { AUDIO: audio } } = await newEnv()
  // 正控的先决条件：先按用户正常路径把「这本」用起来（两章 mp3 ＋ timings ＋ 索引），
  // 再往同一个桶里放一份 BYO 正文 —— 那份**必须活到最后**（D25 的分界线就在这）。
  for (const f of ['ch-01.mp3', 'ch-02.mp3']) {
    await handleBookAudio(req('PUT', audioPath(BID, f), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  }
  await handleBookAudio(req('PUT', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A, body: JSON.stringify(TIMINGS) }), env)
  await handleBookAudio(req('PUT', indexPath(BID), { cookie: TOKEN_A, body: JSON.stringify(INDEX) }), env)
  const BODY = JSON.stringify({ id: BID, chapters: [{ id: 'ch-01', paragraphs: [{ text: '正文在' }] }] })
  await audio.put(bodyKey(BID), BODY)
  // 边界样本：同账号**另一本**书的音频 ＋ **别的账号**同一本书的音频 —— 这次 DELETE 都不许碰到
  await audio.put(audioObjectKey(CODE_A, BID2, 'ch-01.mp3'), MP3)
  await audio.put(audioObjectKey(CODE_B, BID, 'ch-01.mp3'), MP3)
  const before = audio.keys().length
  t('清空前：这一本名下 4 件（2 mp3 ＋ 1 timings ＋ 1 索引）',
    audio.keys().filter(underBook(BID)).length === 4)

  t('无会话 DELETE → 401',
    (await handleBookAudio(req('DELETE', clearPath(BID)), env)).status === 401)
  t('`<bookId>/audio` 的 GET / PUT → 405 Allow: DELETE（这个形状只服务清空）',
    await (async () => {
      const g = await handleBookAudio(req('GET', clearPath(BID), { cookie: TOKEN_A }), env)
      const p = await handleBookAudio(req('PUT', clearPath(BID), { cookie: TOKEN_A, body: '{}' }), env)
      return g.status === 405 && g.headers.get('Allow') === 'DELETE'
        && p.status === 405 && p.headers.get('Allow') === 'DELETE'
    })())

  const cleared = await handleBookAudio(req('DELETE', clearPath(BID), { cookie: TOKEN_A }), env)
  const clearedJson = await cleared.json()
  t('DELETE → 200 且 ok / removedAudioObjects=4 / indexCleared=true',
    cleared.status === 200 && clearedJson.ok === true && clearedJson.bookId === BID
    && clearedJson.removedAudioObjects === 4 && clearedJson.indexCleared === true)
  t('下载物全没了：该前缀下 4 件音频已清，只剩 1 份空索引',
    audio.keys().filter(underBook(BID)).join() === audioObjectKey(CODE_A, BID, INDEX_FILE))
  t('清空后 GET mp3 → 404（音频真的没了）',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.mp3'), { cookie: TOKEN_A }), env)).status === 404)
  t('清空后 GET timings → 404',
    (await handleBookAudio(req('GET', audioPath(BID, 'ch-01.timings.json'), { cookie: TOKEN_A }), env)).status === 404)

  const idxAfter = await handleBookAudio(req('GET', indexPath(BID), { cookie: TOKEN_A }), env)
  t('索引**回写成空**（不是删掉）：200 且 {book, withAudio: [], missing: {}}',
    idxAfter.status === 200 && eq(await idxAfter.json(), { book: BID, withAudio: [], missing: {} }))
  t('空索引仍 no-store（前端靠它把已清空翻成「没有音频」）',
    idxAfter.headers.get('Cache-Control') === 'no-store')

  // ← 本条是正控：D25 的意义就在「只删音频、正文与笔记不动」
  t('**正文仍在**：`books/<code>/<bookId>.json` 没被动，字节逐字一致',
    audio.keys().includes(bodyKey(BID))
    && new TextDecoder().decode(audio.raw(bodyKey(BID)).bytes) === BODY)
  t('边界只到 `user/<code>/<bookId>/`：同账号别的书不受影响',
    audio.keys().includes(audioObjectKey(CODE_A, BID2, 'ch-01.mp3')))
  t('跨账号隔离：B 的同一本书音频仍在',
    audio.keys().includes(audioObjectKey(CODE_B, BID, 'ch-01.mp3')))
  t('没多删：对象总数 = 清空前 − 4 ＋ 1 份空索引', audio.keys().length === before - 3)

  const again = await handleBookAudio(req('DELETE', clearPath(BID), { cookie: TOKEN_A }), env)
  const againJson = await again.json()
  t('可重入：再 DELETE 一次 → 200 且前缀下仍只剩 1 份空索引（状态收敛）',
    again.status === 200 && againJson.ok === true && audio.keys().filter(underBook(BID)).length === 1
    && eq(await (await handleBookAudio(req('GET', indexPath(BID), { cookie: TOKEN_A }), env)).json(),
      { book: BID, withAudio: [], missing: {} }))

  // 「空索引必须写」的第二种入口：这本**一个对象都没有**（从没生成过）也要落一份空索引 ——
  // 索引整份缺失在前端读作「没生成过 ⇒ 不妄断」，反而会去点并不存在的 mp3。
  const bare = await handleBookAudio(req('DELETE', clearPath(BID_EMPTY), { cookie: TOKEN_A }), env)
  const bareIdx = await handleBookAudio(req('GET', indexPath(BID_EMPTY), { cookie: TOKEN_A }), env)
  t('从没生成过的书也清 → 200 / removedAudioObjects=0 / 仍落一份空索引（缺失 ≠ 空）',
    bare.status === 200 && (await bare.json()).removedAudioObjects === 0
    && bareIdx.status === 200 && eq(await bareIdx.json(), { book: BID_EMPTY, withAudio: [], missing: {} }))
  t('清空一本不动它账号级兄弟：A 的 BID2 与 B 的都还在（收尾正控）',
    audio.keys().includes(audioObjectKey(CODE_A, BID2, 'ch-01.mp3'))
    && audio.keys().includes(audioObjectKey(CODE_B, BID, 'ch-01.mp3'))
    && audio.keys().includes(bodyKey(BID)))
}

console.log('\n[bookaudio — D25-b 清空后额度自动放回：本数]')
{
  const BID3 = 'bk_3333333333333333'
  const { env } = await newEnv({ AUDIO_MAX_BOOKS: '1' })
  const P = (id, f) => handleBookAudio(req('PUT', audioPath(id, f), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  const clear = id => handleBookAudio(req('DELETE', `${ROUTE_PREFIX}${id}/audio`, { cookie: TOKEN_A }), env)

  // 反向对照先跑：**只有索引、没有 mp3** 的书不占本数 —— 这就是「清空能放回额度」的原因
  const idxOnly = await handleBookAudio(req('PUT', indexPath(BID3), { cookie: TOKEN_A, body: JSON.stringify({ book: BID3, withAudio: [], missing: {} }) }), env)
  t('只写索引不占本数：这本之后另开一本仍然 200（口径改前是 403）',
    idxOnly.status === 200 && (await P(BID, 'ch-01.mp3')).status === 200)

  const blocked = await P(BID2, 'ch-01.mp3')
  t('上限 1 本：第 2 本 → 403 本数超限', blocked.status === 403 && (await blocked.json()).error === 'book limit reached')
  t('清空第 1 本 → 200', (await clear(BID)).status === 200)
  t('本数随清空放回：第 2 本 → 200（D25-b）', (await P(BID2, 'ch-01.mp3')).status === 200)
}

console.log('\n[bookaudio — D25-b 清空后额度自动放回：字节]')
{
  const BID3 = 'bk_3333333333333333'
  // 每章 200 字节、上限 500：清空后留下的空索引（约 45 B）余量足够再放一章
  const { env } = await newEnv({ AUDIO_MAX_ACCOUNT_BYTES: '500' })
  const A = (id, n) => handleBookAudio(req('PUT', audioPath(id, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: new Uint8Array(n) }), env)
  t('两本各 200 字节 → 200', (await A(BID, 200)).status === 200 && (await A(BID2, 200)).status === 200)
  const blocked = await A(BID3, 200)
  t('第 3 本 200 字节 → 403 总量超限', blocked.status === 403 && (await blocked.json()).error === 'audio storage limit reached')
  t('清空第 1 本 → 200', (await handleBookAudio(req('DELETE', `${ROUTE_PREFIX}${BID}/audio`, { cookie: TOKEN_A }), env)).status === 200)
  t('字节随前缀清空放回：第 3 本 200 字节 → 200（留下的空索引不挡）', (await A(BID3, 200)).status === 200)
}

console.log('\n[bookaudio — D25-f 清空要同趟作废 D1 的行：有章在跑 → 409，谁也不许动]')
{
  const clearPath = id => `${ROUTE_PREFIX}${id}/audio`
  const INS = `INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, 'C', 100, ?, ?, ?, ?)`
  const ins = (db, ch, status, attempts = 1) => db.prepare(INS).run(CODE_A, BID, ch, status, attempts, NOW, NOW)
  const putMp3 = (env, id = BID) =>
    handleBookAudio(req('PUT', audioPath(id, 'ch-01.mp3'), { cookie: TOKEN_A, headers: { 'Content-Type': 'audio/mpeg' }, body: MP3 }), env)
  const clear = (env, id = BID) => handleBookAudio(req('DELETE', clearPath(id), { cookie: TOKEN_A }), env)

  // ── 正控：跑完的（done）与跑挂的（failed）→ 清空时一并作废，行**不删** ──
  {
    const { env, db } = await newEnv()
    await putMp3(env)
    ins(db, 'ch-01', 'done')
    ins(db, 'ch-02', 'failed', 3)
    const res = await clear(env)
    const body = await res.json()
    t('清空 → 200 且 tasksPurged=2（done 与 failed 都作废）', res.status === 200 && body.tasksPurged === 2)
    t('行**没删**（还在，配额靠行记）、状态 purged、purged_at 落值', (() => {
      const rows = db.prepare('SELECT status, purged_at FROM audio_tasks WHERE code=? AND book_id=?').all(CODE_A, BID)
      return rows.length === 2 && rows.every(r => r.status === 'purged' && typeof r.purged_at === 'number')
    })())
    const res2 = await clear(env)
    t('再清一次 → tasksPurged=0（收敛，不报错）', res2.status === 200 && (await res2.json()).tasksPurged === 0)
    t('从没建过任务的书 → tasksPurged=0（不是 -1、也不是出错）', await (async () => {
      const r = await clear(env, BID2)
      return r.status === 200 && (await r.json()).tasksPurged === 0
    })())
  }

  // ── 反控：有章在跑（running／pending）→ 409，**R2、索引、D1 三处全原样** ──
  {
    const { env, db } = await newEnv()
    const audio = env.AUDIO
    await putMp3(env)
    await handleBookAudio(req('PUT', indexPath(BID), { cookie: TOKEN_A, body: JSON.stringify(INDEX) }), env)
    ins(db, 'ch-01', 'done')
    ins(db, 'ch-02', 'running')
    ins(db, 'ch-03', 'pending', 0)
    const before = audio.keys().slice().sort().join('|')

    const res = await clear(env)
    const body = await res.json()
    t('有 running／pending → 409 tasks-running、open=2（前端据此说「还有 2 章在生成」）',
      res.status === 409 && body.error === 'tasks-running' && body.open === 2)
    t('409 时 R2 **一件不动**（mp3 与索引都还在，键序逐字一致）', audio.keys().slice().sort().join('|') === before)
    t('409 时索引**没被回写成空**（还是原来那份）', await (async () => {
      const r = await handleBookAudio(req('GET', indexPath(BID), { cookie: TOKEN_A }), env)
      return r.status === 200 && eq(await r.json(), INDEX)
    })())
    t('409 时 D1 也原样：done 的那行**不许先被作废**（全有或全无）',
      db.prepare("SELECT status FROM audio_tasks WHERE code=? AND chapter_id='ch-01'").get(CODE_A).status === 'done')
  }

  // ── 作废失败（DB 抖）→ 503，同样一件不动：作废与清空同进同退 ──
  {
    const { env } = await newEnv()
    await putMp3(env)
    // 只让**碰 audio_tasks 的那几条**炸：会话闸（查 sessions）得照常，否则 401 会先把 DELETE 拦掉
    const realDb = env.DB
    const broken = { ...env, DB: { prepare(sql) { if (sql.includes('audio_tasks')) throw new Error('db down'); return realDb.prepare(sql) } } }
    const res = await clear(broken)
    t('DB 读不了 → 503 task purge failed（不敢清：行留 done 而音频没了就再也生成不了）',
      res.status === 503 && (await res.json()).error === 'task purge failed')
    t('503 时 R2 也没动（mp3 还在）', env.AUDIO.keys().includes(audioObjectKey(CODE_A, BID, 'ch-01.mp3')))
  }
}

console.log('\n[块 E — 按前缀清（audiostore.js）：删书 / 注销都用它]')
{
  const { env } = await newEnv()
  const store = env.AUDIO
  await store.put(`user/${CODE_A}/${BID}/ch-01.mp3`, MP3)
  await store.put(`user/${CODE_A}/${BID}/ch-01.timings.json`, JSON.stringify(TIMINGS))
  await store.put(`user/${CODE_A}/${BID}/audio-index.json`, JSON.stringify(INDEX))
  await store.put(`user/${CODE_A}/${BID2}/ch-01.mp3`, MP3)
  await store.put(`user/${CODE_B}/${BID}/ch-01.mp3`, MP3)

  t('purgeBookAudio：只清这一本（3 件），同账号别的书与别的账号都不动',
    (await purgeBookAudio(env, CODE_A, BID)) === 3
    && !store.keys().some((k) => k.startsWith(`user/${CODE_A}/${BID}/`))
    && store.keys().includes(`user/${CODE_A}/${BID2}/ch-01.mp3`)
    && store.keys().includes(`user/${CODE_B}/${BID}/ch-01.mp3`))
  t('purgeBookAudio：清一本从没生成过音频的书 → 0 条、不报错',
    (await purgeBookAudio(env, CODE_A, 'bk_0000000000000000')) === 0)
  t('purgeAccountAudio：清掉该账号剩下的全部音频（1 件）',
    (await purgeAccountAudio(env, CODE_A)) === 1
    && !store.keys().some((k) => k.startsWith(`user/${CODE_A}/`)))
  t('purgeAccountAudio：别的账号仍在（边界只到 user/<code>/）',
    store.keys().includes(`user/${CODE_B}/${BID}/ch-01.mp3`))

  // 分页：R2 list 每页上限 1000；把假桶压成每页 2 条，逼出「删到一半游标失效」的经典 bug
  const small = await newEnv({ AUDIO: r2(2) })
  const s2 = small.env.AUDIO
  for (let i = 0; i < 5; i++) await s2.put(`user/${CODE_A}/${BID}/p-${i}.mp3`, MP3)
  await s2.put(`user/${CODE_B}/${BID}/keep.mp3`, MP3)
  t('分页（每页 2 条）：5 件跨多页也一次清干净，且不误伤别的账号',
    (await purgeBookAudio(small.env, CODE_A, BID)) === 5
    && !s2.keys().some((k) => k.startsWith(`user/${CODE_A}/`))
    && s2.keys().includes(`user/${CODE_B}/${BID}/keep.mp3`))

  t('list 抛错 → 回 -1（恒不抛：一次 R2 打嗝不该把删书 / 注销弄成失败）',
    (await purgePrefix({ AUDIO: { async list() { throw new Error('boom') } } }, 'user/X/')) === -1)
  t('delete 抛错 → 回 -1（同上）', await (async () => {
    const bad = { AUDIO: {
      async list() { return { objects: [{ key: 'user/X/y.mp3', size: 1 }], truncated: false } },
      async delete() { throw new Error('boom') },
    } }
    return (await purgePrefix(bad, 'user/X/')) === -1
  })())
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)