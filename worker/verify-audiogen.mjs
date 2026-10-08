/**
 * audiogen.js 的验证（第 17 步 · 块 C「任务表与合成端点」，设计定案 D24）
 * 用法: node verify-audiogen.mjs
 *
 * 六层：
 *   ① 形状与常量 —— 路由前缀 / 两条 cron 不同 / 各阈值 / 切块必落段落上 / 索引合并 / UTC 日
 *   ② MPEG 帧扫描 —— 合成 V2L3 帧序列（含 ID3v2 ＋ Xing 帧），验剥头、帧数、时长（576 样本 = 24 ms）
 *   ③ 会话闸 —— 无会话 401 / 账号未认领 403 / **URL 带 code 400**（顺序：未登录带码仍 401）
 *   ④ 提交端点 —— 404 无书体 / 400 形态 / skip（未知章·超章长）/ 幂等 / 配额双闸 403 / 失败重提
 *   ⑤ cron 巡检端到端 —— 假 DeepInfra ＋ 假 R2 ＋ 真 SQLite：跑完 → mp3/timings/index 落 R2、
 *      任务 done、索引翻转、GET 状态复读得到进度与剩余额度（关页再回来进度仍在，D21-g）
 *   ⑥ 失败 / 重试 / 僵尸回收 —— DeepInfra 5xx → 回 pending；第 3 次 → failed；
 *      心跳超 5 分钟 → 回 pending（额度未尽）／→ failed（额度用尽）
 *   ⑦ 清空后重提（D25-f）—— `purgeBookTasks` 把 done／failed 作废成 purged（行不删）；
 *      重提走 SQL_TASK_REPURGE（created_at 重置到今天 ⇒ 配额照记）；有在跑 → 拒绝（含竞态）
 *
 * ⚠️ 手工注入故障自检（照 §12.4 / 本块 §7）：把 audiogen.js 的 `sessionTenant` 闸拆掉
 *   （直接放行）→ 本文件必须变红 → 还原 → 记 SHA256 逐字节一致 → 再全绿。那一步不在文件里
 *   （改的是源码），跑法与结果记在项目日志。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  handleAudioGen, runAudioGenTick, synthesizeChapter, chunkBlocks, chapterOfBook, chapterCharCount,
  frameSize, locateFrames, scanFrames, stripBlock, mergeAudioIndex, dayStart,
  ROUTE_PREFIX, TICK_CRON, PURGE_CRON, BLOCK_CHARS, MAX_CHAPTER_CHARS, MAX_CHAPTER_BYTES,
  DAILY_CHAPTERS, DAILY_CHARS, MAX_ATTEMPTS, STALE_MS, K_PER_TICK,
  purgeBookTasks, isPendingStatus, TASK_PURGED, SQL_PURGE_BOOK_TASKS, SQL_TASK_REPURGE,
} from './src/audiogen.js'
import { audioObjectKey, INDEX_FILE } from './src/bookaudio.js'
import { bookObjectKey } from './src/booksync.js'
import { tokenHash } from './src/auth.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** 取一行；行不存在回 {} —— 状态不对要报 FAIL，不能让断言把测试崩掉 */
const one = (db, sql, ...args) => db.prepare(sql).get(...args) || {}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const BASE = 'https://my-reader.ferrari11.com'
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0)

const CODE_A = 'ABCD2345', CODE_B = 'WXYZ6789'
const USER_A = 'u_audiogen_a', USER_B = 'u_audiogen_b'
const TOKEN_A = 'tok-audiogen-a', TOKEN_B = 'tok-audiogen-b'
const BID = 'bk_a1b2c3d4e5f60718'

// ── 适配器：真 SQLite 冒充 D1、Map 冒充 R2 ───────────────────────────────────

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

function r2(pageLimit = 1000) {
  const store = new Map()
  const toBytes = (value) => {
    if (typeof value === 'string') return new TextEncoder().encode(value)
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    return new TextEncoder().encode(String(value))
  }
  return {
    keys() { return [...store.keys()] },
    raw(key) { return store.get(key) },
    async put(key, value) { store.set(key, { bytes: toBytes(value) }); return { key, size: store.get(key).bytes.length } },
    async get(key) {
      const e = store.get(key)
      if (!e) return null
      return {
        key, size: e.bytes.length,
        text: async () => new TextDecoder().decode(e.bytes),
        arrayBuffer: async () => e.bytes.slice().buffer,
        body: new Response(e.bytes).body,
      }
    },
    async head(key) { const e = store.get(key); return e ? { key, size: e.bytes.length } : null },
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

/**
 * 模拟「另一个 invocation 抢在我们前面认领」：第一次 `status='running'` 的 UPDATE 先被别人跑掉，
 * 我们的那次必然 changes=0。用来咬住「认领看 changes」这条 —— 不看它就会双跑同一章。
 */
function racingD1(db) {
  let raced = false
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      let args = []
      const api = {
        bind(...a) { args = a; return api },
        async run() {
          // 只咬「认领」那条 —— `SQL_RECYCLE_RETRY` 的 WHERE 里也有 status='running'，别误伤
          if (!raced && sql.indexOf('attempts = attempts + 1') >= 0) {
            raced = true
            stmt.run(...args)                      // 竞争者的认领：真领到了
            const mine = stmt.run(...args)         // 我们的认领：守卫不中 → changes=0
            return { meta: { changes: mine.changes } }
          }
          const r = stmt.run(...args)
          return { meta: { changes: r.changes } }
        },
        async first() { const row = stmt.get(...args); return row === undefined ? null : row },
        async all() { return { results: stmt.all(...args) } },
      }
      return api
    },
  }
}

/** 一章两段的小书体（BYO 形状：chapters[].paragraphs[].{id,text}） */
function sampleBook(paras) {
  const list = Array.isArray(paras) ? paras : ['Hello there', 'Second one']
  return {
    bookId: BID, title: 'T', author: 'A', chapterCount: 1,
    charCount: list.reduce((a, t) => a + t.length, 0),
    chapters: [{
      id: 'ch-01', title: 'Chapter 1',
      paragraphs: list.map((text, i) => ({ id: 'p-01-00' + (i + 1), text })),
    }],
  }
}

/** 一个装好账号 / 会话 / 书体的环境 */
async function newEnv({ withBook = true, ...overrides } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  const insU = `INSERT INTO users (id, email, password_hash, created_at, updated_at, email_verified_at, sync_code, deleted_at)
      VALUES (?, ?, 'x', ?, ?, ?, ?, NULL)`
  db.prepare(insU).run(USER_A, 'a@audiogen.test', NOW, NOW, NOW, CODE_A)
  db.prepare(insU).run(USER_B, 'b@audiogen.test', NOW, NOW, NOW, CODE_B)
  db.prepare(insU).run('u_nocode', 'c@audiogen.test', NOW, NOW, NOW, null)
  const insS = `INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`
  db.prepare(insS).run(await tokenHash(TOKEN_A), USER_A, NOW, NOW, NOW + 86400000)
  db.prepare(insS).run(await tokenHash(TOKEN_B), USER_B, NOW, NOW, NOW + 86400000)
  db.prepare(insS).run(await tokenHash('tok-nocode'), 'u_nocode', NOW, NOW, NOW + 86400000)

  const bucket = r2()
  if (withBook) await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(sampleBook()))
  const env = { DB: d1(db), AUDIO: bucket, DEEPINFRA_API_KEY: 'test-key' }
  Object.assign(env, overrides)
  return { db, env, bucket }
}

function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) }
  if (opts.cookie) headers.Cookie = `mr_session=${opts.cookie}`
  if (opts.body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  return new Request(BASE + path, {
    method, headers,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  })
}
const genPath = (id) => `${ROUTE_PREFIX}book/${id}`

// ── 合成一个合法 MPEG2 LSF Layer III 帧序列（64 kbps @ 24 kHz ⇒ 每帧 192 B）──

const FRAME = 192
const P1 = 'Hello there'
const P2 = 'Second one'
const WORDS = [
  { start: 0, end: 0.5, text: 'Hello' },
  { start: 0.5, end: 0.8, text: 'there' },
  { start: 0.8, end: 1.0, text: 'Second' },
  { start: 1.0, end: 1.2, text: 'one' },
]

function makeMp3(nFrames, { id3 = true, xing = false } = {}) {
  const out = []
  if (id3) out.push(0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0) // 'ID3' + ver + flags + size 0
  for (let f = 0; f < nFrames; f++) {
    const fr = new Uint8Array(FRAME)
    fr[0] = 0xff; fr[1] = 0xf2; fr[2] = 0x84; fr[3] = 0x00
    if (xing && f === 0) { fr[4] = 0x58; fr[5] = 0x69; fr[6] = 0x6e; fr[7] = 0x67 } // 'Xing'
    out.push(...fr)
  }
  return new Uint8Array(out)
}

/** 假 DeepInfra：可注入 5xx / 网络异常；记下每次调用的字符数与参数 */
function fakeDI(opts = {}) {
  const calls = []
  const frames = opts.frames === undefined ? 5 : opts.frames
  const bytes = makeMp3(frames)
  const b64 = Buffer.from(bytes).toString('base64')
  const words = opts.words === undefined ? WORDS : opts.words
  return {
    calls, bytes,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      calls.push({ url, chars: body.text.length, voice: body.preset_voice[0], format: body.output_format, ts: body.return_timestamps })
      if (opts.throw) throw new Error('network down')
      if (opts.failStatus) return { ok: false, status: opts.failStatus, json: async () => ({ detail: 'boom' }) }
      if (opts.noAudio) return { ok: true, status: 200, json: async () => ({ words }) }
      return {
        ok: true, status: 200,
        json: async () => ({ audio: 'data:audio/mpeg;base64,' + b64, words, inference_status: { cost: 1e-6, runtime_ms: 10 } }),
      }
    },
  }
}

// ═══ ① 形状与常量 ════════════════════════════════════════════════════════════

console.log('\n[audiogen — 形状与常量]')
t('路由前缀 /api/gen/，不含 code', ROUTE_PREFIX === '/api/gen/' && !ROUTE_PREFIX.includes('code'))
t('两条 cron 各就各位（合成 ≠ 注销真删）', TICK_CRON === '* * * * *' && PURGE_CRON === '17 3 * * *')
t('前缀不吃别的路由', !'/api/book/x'.startsWith(ROUTE_PREFIX) && !'/api/audio/x/y'.startsWith(ROUTE_PREFIX))
t('阈值常量：9,000 块 / 40,000 章长 / 32 MiB 产物 / 5 章 ＋ 80,000 字符 / 3 次重试 / 5 分钟判死 / K=3',
  BLOCK_CHARS === 9000 && MAX_CHAPTER_CHARS === 40000 && MAX_CHAPTER_BYTES === 32 * 1024 * 1024
  && DAILY_CHAPTERS === 5 && DAILY_CHARS === 80000 && MAX_ATTEMPTS === 3
  && STALE_MS === 5 * 60 * 1000 && K_PER_TICK === 3)
t('dayStart 归到 UTC 0 点', dayStart(Date.UTC(2026, 9, 8, 23, 59, 59)) === Date.UTC(2026, 9, 8))

t('切块：块边界只落段落上、块文本 = 段落按 \\n\\n 拼、每块 ≤9,000',
  (() => {
    const paras = ['x'.repeat(5000), 'y'.repeat(5000), 'z'.repeat(10)]
    const bl = chunkBlocks(paras)
    return bl.length === 2 && bl[0].from === 0 && bl[0].to === 1
      && bl[1].from === 1 && bl[1].to === 3 && bl[1].text === paras[1] + '\n\n' + paras[2]
      && bl.every(b => b.chars <= BLOCK_CHARS)
  })())
t('切块：单段自己超 9,000 也单独成块（仍不在段内切）',
  (() => { const bl = chunkBlocks(['q'.repeat(9500)]); return bl.length === 1 && bl[0].to === 1 && bl[0].chars === 9500 })())
t('切块：空数组 → 0 块', chunkBlocks([]).length === 0)

t('chapterOfBook 取到正文 / 段落 id / 标题', (() => {
  const ch = chapterOfBook({ chapters: [{ id: 'ch-01', title: 'Chapter 1', paragraphs: [{ id: 'p-01-001', text: P1 }, { id: 'p-01-002', text: P2 }] }] }, 'ch-01')
  return ch && ch.paras.length === 2 && ch.paras[0] === P1 && ch.paraIds[1] === 'p-01-002' && ch.title === 'Chapter 1'
})())
t('chapterOfBook 找不到 → null', chapterOfBook({ chapters: [] }, 'ch-99') === null)
t('chapterCharCount = 段落长度和（不含段间换行）', chapterCharCount({ paras: ['abc', 'de'] }) === 5)
t('mergeAudioIndex：追加去重 ＋ 从 missing 摘掉', eq(
  mergeAudioIndex({ book: BID, withAudio: ['ch-01'], missing: { 'ch-02': 'unrecorded' } }, 'ch-02', BID),
  { book: BID, withAudio: ['ch-01', 'ch-02'], missing: {} }))

// ═══ ② MPEG 帧扫描 ═══════════════════════════════════════════════════════════

console.log('\n[audiogen — MPEG 帧扫描与剥头]')
{
  const bytes = makeMp3(5)
  t('帧长 = 192 B（72 × 64 kbps ÷ 24 kHz，无 padding）', frameSize(bytes, 10) === FRAME)
  t('ID3v2 之后的第一个帧头被认出来（start=10）', (() => { const l = locateFrames(bytes); return l && l.start === 10 && l.headBytes === 10 })())
  t('扫出 5 帧、无 resync、尾部无剩余字节', (() => { const s = scanFrames(bytes, 10); return s.frames === 5 && s.resync === 0 && s.end === bytes.length && s.sr === 24000 })())
  t('剥头后时长按帧数算：5 × 576 ÷ 24,000 = 120 ms', (() => { const st = stripBlock(bytes); return !st.error && st.frames === 5 && st.ms === 120 && st.headBytes === 10 && st.restBytes === 0 })())
  t('Xing 信息帧也被跳过（6 帧里 5 帧是音频，headBytes = 10 + 192）',
    (() => { const st = stripBlock(makeMp3(6, { xing: true })); return st.frames === 5 && st.ms === 120 && st.headBytes === 202 })())
  t('没有帧头的垃圾字节 → no mp3 frames',
    (() => { const st = stripBlock(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) ; return st.error === 'no mp3 frames' })())
}

// ═══ ③ 会话闸 ════════════════════════════════════════════════════════════════

console.log('\n[audiogen — 会话闸（边界＝账号）]')
{
  const { env } = await newEnv()
  t('GET 状态 无会话 → 401', (await handleAudioGen(req('GET', genPath(BID)), env)).status === 401)
  t('POST 提交 无会话 → 401', (await handleAudioGen(req('POST', genPath(BID), { body: '{"chapters":["ch-01"]}' }), env)).status === 401)
  t('伪造 cookie → 401', (await handleAudioGen(req('GET', genPath(BID), { cookie: 'nope' }), env)).status === 401)
  t('账号还没认领主码 → 403', (await handleAudioGen(req('GET', genPath(BID), { cookie: 'tok-nocode' }), env)).status === 403)
  t('URL 带 ?code= → 400（租户只由会话反推）',
    (await handleAudioGen(req('GET', `${genPath(BID)}?code=${CODE_A}`, { cookie: TOKEN_A }), env)).status === 400)
  t('闸先于形状判定：未登录带码仍 401（不泄路径形状）',
    (await handleAudioGen(req('GET', `${genPath(BID)}?code=${CODE_A}`), env)).status === 401)
  t('有会话但 bookId 形状不对 → 400',
    (await handleAudioGen(req('GET', `${ROUTE_PREFIX}book/not-an-id`, { cookie: TOKEN_A }), env)).status === 400)
  t('路径不是 book/<id> → 400',
    (await handleAudioGen(req('GET', `${ROUTE_PREFIX}nope/x`, { cookie: TOKEN_A }), env)).status === 400)
  t('别的路由一律 null（继续 fallthrough）', (await handleAudioGen(req('GET', '/api/book/x/audio-index.json'), env)) === null)
  t('非 GET/POST 一律 null', (await handleAudioGen(req('DELETE', genPath(BID)), env)) === null)
}

// ═══ ④ 提交端点 ══════════════════════════════════════════════════════════════

/** 多章书体：nChapters 章、每章 charsEach 个字符 */
function bookWithChars(nChapters, charsEach, bookId = BID) {
  const chapters = []
  for (let i = 1; i <= nChapters; i++) {
    const nn = String(i).padStart(2, '0')
    chapters.push({ id: 'ch-' + nn, title: 'C' + i, paragraphs: [{ id: 'p-' + nn + '-001', text: 'w'.repeat(charsEach) }] })
  }
  return { bookId, title: 'T', author: 'A', chapterCount: nChapters, chapters }
}
const CHAR_ONE = P1.length + P2.length // sampleBook 一章的字数

console.log('\n[audiogen — 提交端点]')
{
  const { env, db, bucket } = await newEnv()
  const post = (chapters, cookie = TOKEN_A, id = genPath(BID)) =>
    handleAudioGen(req('POST', id, { cookie, body: JSON.stringify({ chapters }) }), env)

  t('别的账号没有这本（键按会话反推）→ 404', (await post(['ch-01'], TOKEN_B)).status === 404)
  t('坏 JSON → 400',
    (await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: '{oops' }), env)).status === 400)
  t('chapters 缺失 / 空 / 非数组 → 400',
    (await post(undefined)).status === 400 && (await post([])).status === 400 && (await post('ch-01')).status === 400)
  t('章 id 形状不对 → 400', (await post(['p-01-001'])).status === 400)
  t('一次提交超过 5 章 → 400（配额是 5 章/天，别一次就撞满）', (await post(['ch-01', 'ch-02', 'ch-03', 'ch-04', 'ch-05', 'ch-06'])).status === 400)

  const r1 = await post(['ch-01']); const b1 = await r1.json()
  t('提交成功：queued 1 章 ＋ 回报剩余额度（5-1 章 / 80,000-21 字符）',
    r1.status === 200 && b1.queued.length === 1 && b1.queued[0].chapterId === 'ch-01'
    && b1.quota.chaptersLeft === 4 && b1.quota.charsLeft === DAILY_CHARS - CHAR_ONE)
  t('任务表落了 1 行：pending、attemps=0、char_count 记下字数、标题来自书体',
    (() => {
      const row = one(db, 'SELECT status, attempts, char_count, title FROM audio_tasks WHERE code=? AND chapter_id=?', CODE_A, 'ch-01')
      return row.status === 'pending' && row.attempts === 0 && row.char_count === CHAR_ONE && row.title === 'Chapter 1'
    })())

  const r2 = await post(['ch-01']); const b2 = await r2.json()
  t('重复提交同一章 → already-queued（幂等、不重复计费）',
    r2.status === 200 && b2.queued.length === 0 && eq(b2.skipped.map(s => s.reason), ['already-queued']))
  t('表里仍然只有 1 行 —— 幂等的地基是主键，不是应用层判断',
    db.prepare('SELECT COUNT(*) AS n FROM audio_tasks').get().n === 1)

  const r3 = await post(['ch-99']); const b3 = await r3.json()
  t('书里没有这一章 → skipped unknown-chapter（不是错误）',
    r3.status === 200 && eq(b3.skipped, [{ chapterId: 'ch-99', reason: 'unknown-chapter' }]))

  const BID2 = 'bk_0011223344556677'
  await bucket.put(bookObjectKey(CODE_A, BID2), JSON.stringify(bookWithChars(1, 45000, BID2)))
  const r4 = await post(['ch-01'], TOKEN_A, genPath(BID2)); const b4 = await r4.json()
  t('单章超 40,000 字符 → skipped chapter-too-long（明确停 ＋ 可读原因，不排队）',
    r4.status === 200 && b4.skipped[0].reason === 'chapter-too-long' && b4.skipped[0].chars === 45000)
}

console.log('\n[audiogen — 配额双闸（5 章/天 ＋ ≤80,000 字符/天）]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(6, 100)))
  const post = (chapters) => handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters }) }), env)

  const r5 = await post(['ch-01', 'ch-02', 'ch-03', 'ch-04', 'ch-05']); const b5 = await r5.json()
  t('满额提交 5 章：全收、剩 0 章', r5.status === 200 && b5.queued.length === 5 && b5.quota.chaptersLeft === 0)
  const r6 = await post(['ch-06']); const b6 = await r6.json()
  t('第 6 章 → 403，且点出剩余额度（拦住并提示「今天只剩 0 章」）',
    r6.status === 403 && b6.error === 'daily quota exceeded' && b6.chaptersLeft === 0 && b6.requested.chapters === 1)
  t('403 不落行（拒了就是真没写）',
    db.prepare("SELECT COUNT(*) AS n FROM audio_tasks WHERE chapter_id='ch-06'").get().n === 0)

  // 换账号（各账号各算）：3 章 × 30,000 字符 ＝ 90,000 > 80,000 ⇒ 字符闸拦
  await bucket.put(bookObjectKey(CODE_B, BID), JSON.stringify(bookWithChars(3, 30000)))
  const postB = (chapters) => handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_B, body: JSON.stringify({ chapters }) }), env)
  const r7 = await postB(['ch-01', 'ch-02', 'ch-03']); const b7 = await r7.json()
  t('章数没超（3 ≤ 5）但字符 90,000 > 80,000 → 403（字符闸才是成本闸）',
    r7.status === 403 && b7.requested.chars === 90000 && b7.requested.chapters === 3)
  const r8 = await postB(['ch-01', 'ch-02']); const b8 = await r8.json()
  t('减到 2 章（60,000 字符）→ 放行、剩 20,000 字符', r8.status === 200 && b8.queued.length === 2 && b8.quota.charsLeft === 20000)
  t('另一账号的 5 章额度不受影响（配额的边界是账号）', b8.quota.chaptersLeft === 3)
  t('A 账号那 5 章也没被 B 账号的提交动过',
    db.prepare('SELECT COUNT(*) AS n FROM audio_tasks WHERE code=?').get(CODE_A).n === 5)
}

console.log('\n[audiogen — 失败可重提（D21-h：不给「重新生成」，但永久失败的章能重来）]')
{
  const { env, db } = await newEnv()
  db.prepare(`INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at, error)
      VALUES (?, ?, 'ch-01', 'Chapter 1', ?, 'failed', 3, ?, ?, 'boom')`).run(CODE_A, BID, CHAR_ONE, NOW, NOW)
  const r = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
  const b = await r.json()
  t('失败章重提 → requeued（同一行重置为 pending，不新增行）',
    r.status === 200 && eq(b.requeued, [{ chapterId: 'ch-01', chars: CHAR_ONE }]) && b.queued.length === 0)
  const row = one(db, "SELECT status, attempts, error FROM audio_tasks WHERE code=? AND chapter_id='ch-01'", CODE_A)
  t('重提后 attempts 归零、error 清空', row.status === 'pending' && row.attempts === 0 && row.error === null)
  const q = await handleAudioGen(req('GET', genPath(BID), { cookie: TOKEN_A }), env)
  const qb = await q.json()
  t('重提不吃配额（同一行 ⇒ 当日仍是 1 章）', qb.quota.chaptersUsed === 1)
  t('GET 状态：这一章 pending、排队位次第 1', qb.chapters['ch-01'].status === 'pending' && qb.queue.position === 1)
}

// ═══ ⑤ cron 巡检端到端 ═══════════════════════════════════════════════════════

console.log('\n[audiogen — cron 巡检端到端（假 DeepInfra ＋ 真 SQLite ＋ 假 R2）]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  // 第一章两段：单段的章「按块缩放」是对是错都看不出来（首段起点恒为词表首词）
  const e2eBook = {
    bookId: BID, title: 'T', author: 'A', chapterCount: 2,
    chapters: [
      { id: 'ch-01', title: 'C1', paragraphs: [{ id: 'p-01-001', text: P1 }, { id: 'p-01-002', text: P2 }] },
      { id: 'ch-02', title: 'C2', paragraphs: [{ id: 'p-02-001', text: P1 }] },
    ],
  }
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(e2eBook))
  const r = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01', 'ch-02'] }) }), env)
  t('提交 2 章', r.status === 200 && (await r.json()).queued.length === 2)

  const di = fakeDI({ frames: 5 })
  const tick = await runAudioGenTick(env, NOW, { fetchImpl: di.fetchImpl })
  t('一个 tick 跑完 2 章（同一账号、串行）', tick.claimed === 2 && tick.done === 2 && tick.failed === 0)
  t('每章一次 DeepInfra 调用（1 段 = 1 块 ⇒ 2 次；mp3 ＋ 词级时标都要）',
    di.calls.length === 2 && di.calls.every(c => c.format === 'mp3' && c.ts === true && c.url.includes('Kokoro-82M')))

  const mp3Key = audioObjectKey(CODE_A, BID, 'ch-01.mp3')
  const tmKey = audioObjectKey(CODE_A, BID, 'ch-01.timings.json')
  const ixKey = audioObjectKey(CODE_A, BID, INDEX_FILE)
  t('mp3 ＋ timings 落 R2（键 = user/<code>/<bookId>/<ch>.*）', !!bucket.raw(mp3Key) && !!bucket.raw(tmKey))
  t('mp3 是剥头后的纯帧区（5 帧 × 192 B，无 ID3）',
    (() => { const b = bucket.raw(mp3Key).bytes; return b.length === 960 && b[0] === 0xff && b[1] === 0xf2 })())
  t('timings：duration = 帧算时长（120 ms）；段起点是**按块缩放后**的值',
    (() => {
      const tm = JSON.parse(new TextDecoder().decode(bucket.raw(tmKey).bytes))
      // kw = 本块音频时长 ÷ 本块词表跨度 = 0.120 ÷ 1.2 = 0.1 ⇒ 段2 起点 = 0.8 × 0.1 = 0.08。
      // 不做缩放时这里是 0.5（> duration 0.12）—— 这条断言才是「缩放真做了」的证据。
      const a = tm.paragraphs['p-01-001'], b = tm.paragraphs['p-01-002']
      const st = Object.values(tm.paragraphs)
      return tm.duration === 0.12 && Math.abs(a - 0) < 1e-6 && Math.abs(b - 0.08) < 1e-6
        && st.every(v => v >= 0 && v <= tm.duration) && Object.keys(tm.paragraphs).length === 2
    })())
  t('audio-index 翻转：withAudio 含两章、book 是这本书（前端轮询靠它把 pending 翻成 ready）',
    (() => {
      const ix = JSON.parse(new TextDecoder().decode(bucket.raw(ixKey).bytes))
      return ix.book === BID && eq(ix.withAudio, ['ch-01', 'ch-02']) && eq(ix.missing, {})
    })())
  t('任务表：两章都 done、记下 bytes 与 audio_ms、error 清空',
    (() => {
      const rows = db.prepare("SELECT status, bytes, audio_ms, error FROM audio_tasks ORDER BY chapter_id").all()
      return rows.length === 2 && rows.every(x => x.status === 'done' && x.bytes === 960 && x.audio_ms === 120 && x.error === null)
    })())

  const g = await handleAudioGen(req('GET', genPath(BID), { cookie: TOKEN_A }), env)
  const gb = await g.json()
  t('GET 状态：汇总 2 完成、每章状态可读、已无排队',
    gb.summary.total === 2 && gb.summary.done === 2 && gb.summary.pending === 0 && gb.chapters['ch-01'].status === 'done'
    && gb.chapters['ch-01'].finishedAt !== null && gb.queue.position === 1)
  t('GET 状态回报剩余额度：5-2 章、按已生成的字数扣', gb.quota.chaptersUsed === 2 && gb.quota.chaptersLeft === 3 && gb.quota.charsUsed === CHAR_ONE + P1.length)

  const tick2 = await runAudioGenTick(env, NOW, { fetchImpl: di.fetchImpl })
  t('已完成的章不会被重跑（第二个 tick 无事可做）', tick2.claimed === 0 && di.calls.length === 2)
}

console.log('\n[audiogen — 串行：一个 tick 只跑一个账号]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(1, 100)))
  await bucket.put(bookObjectKey(CODE_B, BID), JSON.stringify(bookWithChars(1, 100)))
  await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
  await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_B, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
  const tick = await runAudioGenTick(env, NOW, { fetchImpl: fakeDI().fetchImpl, limitK: 10 })
  t('只跑了先到的那一个账号（另一个留 pending 给下一 tick）',
    tick.claimed === 1 && tick.done === 1 && db.prepare("SELECT COUNT(*) AS n FROM audio_tasks WHERE status='pending'").get().n === 1)
  t('跑掉的正是先提交的那个账号', one(db, 'SELECT code FROM audio_tasks WHERE status=?', 'done').code === CODE_A)
}

console.log('\n[audiogen — 认领是原子的（cron invocation 可重叠，防双启）]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(1, 100)))
  await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
  // 另一个 invocation 抢先认领了（心跳新鲜 ⇒ 不是僵尸、不该被回收）
  db.prepare("UPDATE audio_tasks SET status='running', attempts=1, heartbeat=?, started_at=? WHERE chapter_id='ch-01'").run(NOW - 1000, NOW - 1000)
  const di = fakeDI()
  const tick = await runAudioGenTick(env, NOW, { fetchImpl: di.fetchImpl })
  t('已被别人领走（running + 心跳新鲜）→ 本 tick 不跑、一次 DeepInfra 都不发、不写对象',
    tick.claimed === 0 && tick.recycled === 0 && tick.done === 0 && di.calls.length === 0
    && bucket.keys().filter(k => !k.startsWith('books/')).length === 0)
  t('状态仍是别人的 running（租约没被抢）', one(db, 'SELECT status FROM audio_tasks').status === 'running')

  // 更硬的一向：清单读完、我们认领**之前**别人抢先 —— CLAIM 的 changes=0 必须让本章一次都不跑。
  // （上面那条只证明「running 不进候选清单」；这条才咬住「查 changes」本身。）
  const { env: env2, db: db2, bucket: bucket2 } = await newEnv({ withBook: false })
  await bucket2.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(1, 100)))
  await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env2)
  env2.DB = racingD1(db2)
  const di2 = fakeDI()
  const tick2 = await runAudioGenTick(env2, NOW, { fetchImpl: di2.fetchImpl })
  t('认领守卫咬住：抢输了（changes=0）→ 不发 DeepInfra、不写任何对象',
    tick2.claimed === 0 && tick2.done === 0 && di2.calls.length === 0
    && bucket2.keys().filter(k => !k.startsWith('books/')).length === 0)
  t('那一章仍被别人的租约持有（running、attempts=1）',
    one(db2, 'SELECT status, attempts FROM audio_tasks').status === 'running')
}

console.log('\n[audiogen — 子请求预算护栏（Free 50/invocation）]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  const ins = db.prepare(`INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, 40000, 'pending', 0, ?, ?)`)
  for (let i = 1; i <= 8; i++) {
    const nn = String(i).padStart(2, '0')
    ins.run(CODE_A, BID, 'ch-' + nn, 'C' + i, NOW + i, NOW + i)
  }
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(8, 40000)))
  const tick = await runAudioGenTick(env, NOW, { fetchImpl: fakeDI().fetchImpl, limitK: 10 })
  t('逼近 50 子请求就先停（余下留 pending，不是丢任务）',
    tick.stopped === 'subreq-budget' && tick.claimed === 7 && tick.done === 7)
  t('剩下的仍是 pending', db.prepare("SELECT COUNT(*) AS n FROM audio_tasks WHERE status='pending'").get().n === 1)
}

// ═══ ⑥ 失败 / 重试 / 僵尸回收 ════════════════════════════════════════════════

console.log('\n[audiogen — 失败与重试（≤3 次，不计用户额度）]')
{
  const { env, db, bucket } = await newEnv({ withBook: false })
  await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(1, 100)))
  await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)

  const diFail = fakeDI({ failStatus: 500 })
  const t1 = await runAudioGenTick(env, NOW, { fetchImpl: diFail.fetchImpl })
  const row1 = one(db, 'SELECT status, attempts, error FROM audio_tasks')
  t('DeepInfra 500 → 这一章没成，任务回 pending（还有重试额度）',
    t1.failed === 1 && t1.done === 0 && row1.status === 'pending' && row1.attempts === 1 && /HTTP 500/.test(row1.error))
  t('失败不写任何对象（不留半成品）', bucket.keys().filter(k => !k.startsWith('books/')).length === 0)

  await runAudioGenTick(env, NOW, { fetchImpl: diFail.fetchImpl })
  t('再失败一次 → attempts=2、仍 pending', (() => { const r = one(db, 'SELECT status, attempts FROM audio_tasks'); return r.status === 'pending' && r.attempts === 2 })())

  const t3 = await runAudioGenTick(env, NOW, { fetchImpl: diFail.fetchImpl })
  const row3 = one(db, 'SELECT status, attempts FROM audio_tasks')
  t('第 3 次失败 → 转 failed（不再重试）', t3.failed === 1 && row3.status === 'failed' && row3.attempts === 3)
  const t4 = await runAudioGenTick(env, NOW, { fetchImpl: diFail.fetchImpl })
  t('failed 的章不再被领（要重来走提交端点的「重提」）', t4.claimed === 0)
  t('重试不扣配额：表里始终只有 1 行 ⇒ 当日仍是 1 章', db.prepare('SELECT COUNT(*) AS n FROM audio_tasks').get().n === 1)
  t('网络异常也不抛（回 failed 计数，不炸 cron）', (await runAudioGenTick(env, NOW, { fetchImpl: fakeDI({ throw: true }).fetchImpl })).claimed === 0)
}

console.log('\n[audiogen — D25-f 清空该书音频：行作废成 purged，重提照记配额]')
{
  // 用**真实时钟的今天／昨天**当锚点：配额按「今天」求和，写死日期一旦跨天就假红
  const R = Date.now()
  const TODAY = dayStart(R)
  const YDAY = TODAY - 86400000
  const INS = `INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts,
      created_at, updated_at, purged_at, error, bytes)
      VALUES (?, ?, ?, 'C', 100, ?, ?, ?, ?, ?, ?, ?)`
  const ins = (db, ch, status, attempts, createdAt, purgedAt = null, error = null, bytes = null) =>
    db.prepare(INS).run(CODE_A, BID, ch, status, attempts, createdAt, createdAt, purgedAt, error, bytes)

  // ── 正控：昨天生成好的两章（done）＋ 一章跑挂的（failed）→ 全作废 ──
  {
    const { env, db, bucket } = await newEnv({ withBook: false })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', 'done', 1, YDAY, null, null, 12345)
    ins(db, 'ch-02', 'done', 1, YDAY, null, null, 12345)
    ins(db, 'ch-03', 'failed', 3, YDAY, null, 'boom')

    const purge = await purgeBookTasks(env, CODE_A, BID, R)
    t('清空前作废：没有在跑的 → ok、3 行作废（done 2 ＋ failed 1）',
      purge.ok === true && purge.refused === false && purge.open === 0 && purge.purged === 3)
    t('行**还在**（3 行：删了行就等于「清空即免额度」）＋ 状态 purged、purged_at 落值',
      (() => {
        const rows = db.prepare('SELECT status, purged_at FROM audio_tasks WHERE code=? AND book_id=? ORDER BY chapter_id').all(CODE_A, BID)
        return rows.length === 3 && rows.every((r) => r.status === TASK_PURGED && r.purged_at === R)
      })())
    t('重复清空是收敛的：再作废一次 → purged 0（幂等，不报错）',
      (await purgeBookTasks(env, CODE_A, BID, R + 1)).purged === 0)
    t('isPendingStatus 口径：只有 pending／running 算「没跑完」',
      isPendingStatus('pending') && isPendingStatus('running')
      && !isPendingStatus('done') && !isPendingStatus(TASK_PURGED) && !isPendingStatus('failed') && !isPendingStatus(''))

    const st = await (await handleAudioGen(req('GET', genPath(BID), { cookie: TOKEN_A }), env)).json()
    t('GET 状态：summary.purged 如实计、章级状态回 purged（不是 done ⇒ 不会被判 already-done）',
      st.summary.purged === 3 && st.chapters['ch-01'].status === 'purged' && st.chapters['ch-03'].status === 'purged')
    t('purged 不算「没跑完」：排队位次是 0（否则清空后重提会自带一个假的位次）',
      st.queue.ahead === 0 && st.queue.position === 1)

    const t0 = Date.now()
    const r1 = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
    const b1 = await r1.json()
    const t1 = Date.now()
    t('清空后重提 → 回执是「重新排队」（requeued），不是 already-done',
      r1.status === 200 && b1.queued.length === 0 && eq(b1.requeued, [{ chapterId: 'ch-01', chars: 100 }]))
    t('重提后那一行：pending、attempts 归零、purged_at 清空、error/bytes 清空、created_at 重置到本次',
      (() => {
        const row = one(db, "SELECT status, attempts, purged_at, error, bytes, created_at FROM audio_tasks WHERE code=? AND chapter_id='ch-01'", CODE_A)
        return row.status === 'pending' && row.attempts === 0 && row.purged_at === null
          && row.error === null && row.bytes === null && row.created_at >= t0 && row.created_at <= t1
      })())
    t('没勾的那两章仍是 purged（重提是逐章的，不是整本一起动）',
      (() => {
        const r = db.prepare("SELECT COUNT(*) AS n FROM audio_tasks WHERE code=? AND status='purged'").get(CODE_A)
        return r.n === 2
      })())
  }

  // ── 配额①：昨天作废的行，今天重提要**占今天一格**（created_at 重置 ⇒ 不许白拿额度）──
  {
    const { env, db, bucket } = await newEnv({ withBook: false, AUDIO_GEN_MAX_CHAPTERS_PER_DAY: '1' })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', TASK_PURGED, 1, YDAY)

    const r1 = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
    const b1 = await r1.json()
    t('上限 1 章：昨天作废的章今天重提 → 放行（占掉今天那唯一一格）',
      r1.status === 200 && b1.requeued.length === 1 && b1.quota.chaptersUsed === 1 && b1.quota.chaptersLeft === 0)

    const r2 = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-02'] }) }), env)
    const b2 = await r2.json()
    t('再提一章新章 → 403（重提真的把今天的额度记账了，不是绕过）',
      r2.status === 403 && b2.error === 'daily quota exceeded' && b2.requested.chapters === 1)
  }

  // ── 配额②：**今天**才作废的行，重提不重复扣（今天的格子已经算过它）──
  {
    const { env, db, bucket } = await newEnv({ withBook: false, AUDIO_GEN_MAX_CHAPTERS_PER_DAY: '1' })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', TASK_PURGED, 1, R)

    const r1 = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01'] }) }), env)
    const b1 = await r1.json()
    t('上限 1 章、行本来就是今天的：重提放行，且**仍是 1 章**（不重复扣成 2）',
      r1.status === 200 && b1.requeued.length === 1 && b1.quota.chaptersUsed === 1)

    const r2 = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-02'] }) }), env)
    t('今天这一格已被占 → 新章仍是 403', r2.status === 403)
  }

  // ── 配额③：同一批里「昨天作废的重提 ＋ 一章新章」要一起算（两笔账各占一格）──
  {
    const { env, db, bucket } = await newEnv({ withBook: false, AUDIO_GEN_MAX_CHAPTERS_PER_DAY: '1' })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', TASK_PURGED, 1, YDAY)

    const r = await handleAudioGen(req('POST', genPath(BID), { cookie: TOKEN_A, body: JSON.stringify({ chapters: ['ch-01', 'ch-02'] }) }), env)
    const b = await r.json()
    t('上限 1 章：一批里塞「昨天作废的重提 ＋ 一章新章」→ 403（重提那一格也算进 requested）',
      r.status === 403 && b.requested.chapters === 2 && b.chaptersLeft === 1)
    t('403 是全有或全无：那一批**一章都没落**（ch-01 仍是 purged、ch-02 根本没行）', (() => {
      const a = db.prepare("SELECT status FROM audio_tasks WHERE code=? AND chapter_id='ch-01'").get(CODE_A)
      const n = db.prepare("SELECT COUNT(*) AS n FROM audio_tasks WHERE code=? AND chapter_id='ch-02'").get(CODE_A)
      return a.status === TASK_PURGED && n.n === 0
    })())
  }

  // ── 反控：有章在跑／排队 → 拒绝清空，且**一行都不许动**（全有或全无）──
  {
    const { env, db, bucket } = await newEnv({ withBook: false })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', 'done', 1, YDAY, null, null, 12345)
    ins(db, 'ch-02', 'running', 1, YDAY)
    ins(db, 'ch-03', 'pending', 0, YDAY)

    const purge = await purgeBookTasks(env, CODE_A, BID, R)
    t('有 running／pending → refused、open=2、purged=0',
      purge.ok === false && purge.refused === true && purge.open === 2 && purge.purged === 0)
    t('拒绝时**连已经跑完的那一行也不许动**（done 不能先被作废）',
      one(db, "SELECT status FROM audio_tasks WHERE code=? AND chapter_id='ch-01'", CODE_A).status === 'done')
  }

  // ── 竞态：读表之后、写表之前被 cron 认领 —— NOT EXISTS 守卫必须挡住，且要**认出来**回绝 ──
  {
    const { db, bucket } = await newEnv({ withBook: false })
    await bucket.put(bookObjectKey(CODE_A, BID), JSON.stringify(bookWithChars(5, 100)))
    ins(db, 'ch-01', 'done', 1, YDAY, null, null, 12345)
    // 适配器：第一次「列该书任务」返回**认领前**的样子，然后偷偷插一行 running（＝别人抢先认领）
    let sneaked = false
    const env = {
      DB: {
        prepare(sql) {
          const stmt = db.prepare(sql)
          let args = []
          const api = {
            bind(...a) { args = a; return api },
            async run() { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
            async first() { const row = stmt.get(...args); return row === undefined ? null : row },
            async all() {
              const results = stmt.all(...args)
              if (!sneaked && sql.includes('ORDER BY chapter_id') && sql.includes('FROM audio_tasks')) {
                sneaked = true
                ins(db, 'ch-05', 'running', 1, YDAY)
              }
              return { results }
            },
          }
          return api
        },
      },
      AUDIO: bucket,
    }
    const purge = await purgeBookTasks(env, CODE_A, BID, R)
    t('读表后被抢先认领：NOT EXISTS 守卫没让它被作废，且复读认出在跑 → refused',
      sneaked === true && purge.refused === true && purge.open === 1 && purge.purged === 0)
    t('那一行仍是 done（守卫挡住 = 没写进去）',
      one(db, "SELECT status FROM audio_tasks WHERE code=? AND chapter_id='ch-01'", CODE_A).status === 'done')
    t('两条 SQL 常量形状对得上（自检不是靠正则猜的）',
      SQL_PURGE_BOOK_TASKS.includes("status IN ('done', 'failed')") && SQL_PURGE_BOOK_TASKS.includes('NOT EXISTS')
      && SQL_TASK_REPURGE.includes("status = 'purged'") && SQL_TASK_REPURGE.includes('created_at = ?'))
  }
}

console.log('\n[audiogen — 僵尸回收（心跳超 5 分钟判死）]')
{
  const { env, db, bucket } = await newEnv()
  const insRun = db.prepare(`INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at, started_at, heartbeat)
      VALUES (?, ?, ?, 'C', 21, 'running', ?, ?, ?, ?, ?)`)
  // ① 额度未尽 → 回 pending 重跑
  insRun.run(CODE_A, BID, 'ch-01', 1, NOW - 600000, NOW - 600000, NOW - 600000, NOW - 600000 - STALE_MS)
  const tick = await runAudioGenTick(env, NOW, { fetchImpl: fakeDI().fetchImpl })
  t('心跳超 5 分钟的 running → 回收（额度未尽 → 回 pending 并当场重跑）',
    tick.recycled === 1 && tick.done === 1)
  t('重跑成功后是 done、attempts=2', (() => { const r = one(db, "SELECT status, attempts FROM audio_tasks WHERE chapter_id='ch-01'"); return r.status === 'done' && r.attempts === 2 })())

  // ② 额度用尽 → failed
  const { env: env2, db: db2 } = await newEnv()
  db2.prepare(`INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at, started_at, heartbeat)
      VALUES (?, ?, 'ch-01', 'C', 21, 'running', 3, ?, ?, ?, ?)`).run(CODE_A, BID, NOW - 600000, NOW - 600000, NOW - 600000, NOW - 600000 - STALE_MS)
  const tick2 = await runAudioGenTick(env2, NOW, { fetchImpl: fakeDI().fetchImpl })
  t('心跳超时且额度用尽 → 判死转 failed（不再无限重跑）',
    tick2.dead === 1 && tick2.claimed === 0 && one(db2, 'SELECT status FROM audio_tasks').status === 'failed')

  // ③ 心跳是新的 → 不回收（正在跑的别抢）
  const { env: env3, db: db3 } = await newEnv()
  db3.prepare(`INSERT INTO audio_tasks (code, book_id, chapter_id, title, char_count, status, attempts, created_at, updated_at, started_at, heartbeat)
      VALUES (?, ?, 'ch-01', 'C', 21, 'running', 1, ?, ?, ?, ?)`).run(CODE_A, BID, NOW - 6000, NOW - 6000, NOW - 6000, NOW - 1000)
  const tick3 = await runAudioGenTick(env3, NOW, { fetchImpl: fakeDI().fetchImpl })
  t('心跳还新鲜 → 不回收、不抢（cron 重叠也不会双跑同一章）',
    tick3.recycled === 0 && tick3.dead === 0 && tick3.claimed === 0)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
