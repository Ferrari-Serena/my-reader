/**
 * my-reader 跨设备数据同步端点
 *
 * POST /api/sync/create         → 生成 8 位随机同步码 { code, serverNow }
 * POST /api/sync/push           → body: { code, words: {word: entry}, tombstones: {word: ISO} }
 *                                 条件 upsert（只有更新的时间戳才覆盖）→ { accepted, rejected, serverNow }
 * POST /api/sync/progress       → body: { code, entries: {key: {payload, updatedAt}} }
 * GET  /api/sync/pull?code=X    → { words, tombstones, progress, updatedAt, serverNow }
 *
 * 冲突策略：每个词一条时间轴，last-write-wins。
 *   存活行 deleted_at IS NULL，updated_at = entry.updatedAt || entry.addedAt
 *   墓碑行 deleted_at = updated_at = 删除时刻，payload = 'null'
 *   复活 = 墓碑之后的一次存活写（upsert 把 deleted_at 清回 NULL）
 *
 * 时钟：客户端时钟不可信，所以
 *   ① 响应一律带 serverNow，客户端据此校正自己的时间戳；
 *   ② 超前 serverNow + CLOCK_SLACK_MS 的入参时间戳会被钳到 serverNow，
 *      否则一个坏钟能把某个词永久钉在所有未来编辑之前；
 *   ③ 拒收数（rejected）回给客户端，客户端据此立即重新 pull 合并——
 *      不能静默吞掉，否则慢钟设备的真实编辑会被无声抹掉。
 *
 * 生命周期：同步码 90 天无活动（push/pull 都算活动）才连同词条、墓碑、进度一起清除。
 *   墓碑不单独按 30 天 GC——那会让离线超过 30 天的设备回来复活已删除的词。
 */

import { corsFor } from './cors.js'

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 去掉了容易混淆的 0/O/1/I
const CODE_LEN = 8

const CODE_TTL_MS = 90 * 86400000 // 90 天无活动即废弃
const CLOCK_SLACK_MS = 5 * 60 * 1000 // 容许 5 分钟的未来偏差
const BATCH_CHUNK = 200 // D1 batch 分批，避免单次语句过多

const META = '__meta__'
/** 词表里不允许出现的保留名（会与哨兵行/原型链撞车） */
const RESERVED = new Set([META, '__proto__', 'constructor', 'prototype'])

/**
 * 条件 upsert 的两条语句。导出是为了让 verify-sql.mjs 能拿**真**语句在真 SQLite 上跑，
 * 而不是另抄一份（抄一份迟早会和这里漂移，那样的测试没有意义）。
 * 关键在 DO UPDATE 的 WHERE：时间戳不占优时整条写入被丢弃，changes 为 0。
 */
export const SQL_ALIVE_UPSERT = `INSERT INTO sync_data (code, word, payload, updated_at, deleted_at)
   VALUES (?, ?, ?, ?, NULL)
   ON CONFLICT(code, word) DO UPDATE SET
     payload = excluded.payload,
     updated_at = excluded.updated_at,
     deleted_at = NULL
   WHERE excluded.updated_at > sync_data.updated_at`

export const SQL_TOMB_UPSERT = `INSERT INTO sync_data (code, word, payload, updated_at, deleted_at)
   VALUES (?, ?, 'null', ?, ?)
   ON CONFLICT(code, word) DO UPDATE SET
     payload = excluded.payload,
     updated_at = excluded.updated_at,
     deleted_at = excluded.deleted_at
   WHERE excluded.updated_at > sync_data.updated_at`

function randCode() {
  const buf = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join('')
}

function jsonResponse(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra }
  })
}

/** 把客户端时间戳规范化成统一精度的 ISO 串，并钳掉过于超前的值 */
function normTs(raw, nowMs) {
  const nowIso = new Date(nowMs).toISOString()
  if (typeof raw !== 'string' || !raw) return nowIso
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return nowIso
  if (t > nowMs + CLOCK_SLACK_MS) return nowIso
  return new Date(t).toISOString() // 规范化精度，保证字符串比较口径一致
}

/**
 * 归一化时间戳，并返回「载荷里的 updatedAt 已对齐到同一个值」的 JSON。
 *
 * 为什么必须连载荷一起改：normTs 会把超前的坏钟时间戳钳成 serverNow，但只钳 LWW 列、
 * 让原始载荷原样进库的话，别的设备 pull 回去就拿到那个未来时间戳，本地比新旧时永远赢，
 * 于是那台设备的真实新编辑被永久压住 —— 钳制要防的事只是从服务端挪到了客户端。
 * 顺带统一精度：'...:00Z' 与 '...:00.000Z' 的字符串比较结果与真实时刻顺序不一致。
 */
export function stampWithTs(obj, rawTs, nowMs) {
  const ts = normTs(rawTs, nowMs)
  return { ts, payload: JSON.stringify({ ...obj, updatedAt: ts }) }
}

/** 同步码是否存在（以 __meta__ 哨兵行为准） */
async function codeExists(env, code) {
  const row = await env.DB
    .prepare('SELECT 1 AS ok FROM sync_data WHERE code = ? AND word = ? LIMIT 1')
    .bind(code, META).first()
  return !!row
}

/** 无条件刷新哨兵行的 updated_at（活动心跳）。注意不能走条件 upsert */
async function touchMeta(env, code, nowIso) {
  await env.DB.prepare(
    `INSERT INTO sync_data (code, word, payload, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL)
     ON CONFLICT(code, word) DO UPDATE SET updated_at = excluded.updated_at`
  ).bind(code, META, JSON.stringify({ created: nowIso }), nowIso).run()
}

/**
 * 最佳努力清理：90 天无活动的同步码 + 孤儿行。任何失败都不阻塞主流程。
 * 刻意「先查后删」而不是写成 DELETE ... WHERE code IN (子查询同表)：
 * 后者的求值时机在 SQLite 里有歧义，而这张表很小，多几次查询买确定性是划算的。
 * 孤儿 = 有普通行却没有哨兵行的 code——判据必须是「不在哨兵码集合里」，
 * 写成 word != '__meta__' 会把正常码也选中，等于清空全表。
 */
async function runGc(env, nowMs) {
  const cutoff = new Date(nowMs - CODE_TTL_MS).toISOString()
  try {
    const [staleRes, metaRes, dataRes, progRes] = await Promise.all([
      env.DB.prepare('SELECT code FROM sync_data WHERE word = ? AND updated_at < ?')
        .bind(META, cutoff).all(),
      env.DB.prepare('SELECT DISTINCT code FROM sync_data WHERE word = ?').bind(META).all(),
      env.DB.prepare('SELECT DISTINCT code FROM sync_data').all(),
      env.DB.prepare('SELECT DISTINCT code FROM sync_progress').all(),
    ])

    const live = new Set((metaRes.results || []).map(r => r.code))
    const doomed = new Set((staleRes.results || []).map(r => r.code))
    for (const r of dataRes.results || []) if (!live.has(r.code)) doomed.add(r.code)

    for (const code of doomed) {
      await env.DB.prepare('DELETE FROM sync_data WHERE code = ?').bind(code).run()
      await env.DB.prepare('DELETE FROM sync_progress WHERE code = ?').bind(code).run()
    }
    // sync_progress 里可能还有完全不在 sync_data 中的码
    for (const r of progRes.results || []) {
      if (!live.has(r.code) && !doomed.has(r.code)) {
        await env.DB.prepare('DELETE FROM sync_progress WHERE code = ?').bind(r.code).run()
      }
    }
  } catch (e) {
    console.error('sync gc error:', e.message)
  }
}

/** 分批执行并统计「收下 / 拒收（时间戳不占优）」 */
async function runBatch(env, stmts) {
  let accepted = 0, rejected = 0
  for (let i = 0; i < stmts.length; i += BATCH_CHUNK) {
    const chunk = stmts.slice(i, i + BATCH_CHUNK)
    const results = await env.DB.batch(chunk)
    for (const r of results) {
      // changes === 0 表示 ON CONFLICT 的 WHERE 为假：服务端上的版本更新，本次写入被拒
      if (r?.meta?.changes) accepted++
      else rejected++
    }
  }
  return { accepted, rejected }
}

/**
 * 主入口：根据 pathname 分发到子处理器
 * 仅在 method + path 匹配时调用；不匹配时返回 null 让主路由继续 fallthrough
 */
export async function handleSync(request, env) {
  const url = new URL(request.url)
  // 0.0 止血：按请求回显自家 Origin；json 影子化为本地函数，下面的调用点一行不用改
  const cors = corsFor(request, env)
  const json = (data, status = 200, extra = {}) => jsonResponse(cors, data, status, extra)

  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // POST /api/sync/create
  if (request.method === 'POST' && url.pathname === '/api/sync/create') {
    const nowMs = Date.now()
    const now = new Date(nowMs).toISOString()
    // 随机码可能撞上已存在的码（32^8 ≈ 1.1e12，概率极低但不是零）。撞上时
    // INSERT OR IGNORE 会静默「成功」并把**别人的**码发出去，两个陌生人的生词本就此配对。
    // 所以以 changes 为准重试，直到真的占到一行。
    let code = ''
    let claimed = false
    for (let i = 0; i < 5 && !claimed; i++) {
      code = randCode()
      const res = await env.DB.prepare(
        'INSERT OR IGNORE INTO sync_data (code, word, payload, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)'
      ).bind(code, META, JSON.stringify({ created: now }), now).run()
      claimed = !!res?.meta?.changes
    }
    if (!claimed) return json({ error: 'could not allocate code' }, 503)
    await runGc(env, nowMs)
    return json({ code, serverNow: now })
  }

  // POST /api/sync/push
  if (request.method === 'POST' && url.pathname === '/api/sync/push') {
    let body
    try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }
    const { code, words, tombstones } = body || {}
    if (!code || typeof code !== 'string') return json({ error: 'missing code' }, 400)
    if (words !== undefined && (typeof words !== 'object' || words === null)) {
      return json({ error: 'invalid words' }, 400)
    }
    if (tombstones !== undefined && (typeof tombstones !== 'object' || tombstones === null)) {
      return json({ error: 'invalid tombstones' }, 400)
    }
    // 未知码拒收：否则这是个公开端点，任何人可以灌进永远不会被 GC 的孤儿行
    if (!(await codeExists(env, code))) {
      return json({ error: 'unknown code', serverNow: new Date().toISOString() }, 404)
    }

    const nowMs = Date.now()
    const serverNow = new Date(nowMs).toISOString()

    // 同一个词在一次 push 里只能有一个状态：按时间戳取新者（客户端已保证，此处兜底）
    const ops = new Map()
    for (const [word, entry] of Object.entries(words || {})) {
      const w = (word + '').toLowerCase()
      if (RESERVED.has(w)) continue
      if (!entry || typeof entry !== 'object') continue
      const { ts, payload } = stampWithTs(entry, entry.updatedAt || entry.addedAt, nowMs)
      ops.set(w, { word: w, ts, payload, deleted: false })
    }
    for (const [word, rawTs] of Object.entries(tombstones || {})) {
      const w = (word + '').toLowerCase()
      if (RESERVED.has(w)) continue
      const ts = normTs(rawTs, nowMs)
      const prev = ops.get(w)
      if (!prev || ts > prev.ts) {
        ops.set(w, { word: w, ts, payload: 'null', deleted: true })
      }
    }

    if (ops.size === 0) {
      await touchMeta(env, code, serverNow)
      return json({ accepted: 0, rejected: 0, serverNow })
    }

    const aliveStmt = env.DB.prepare(SQL_ALIVE_UPSERT)
    const tombStmt = env.DB.prepare(SQL_TOMB_UPSERT)

    const stmts = []
    for (const op of ops.values()) {
      stmts.push(op.deleted
        ? tombStmt.bind(code, op.word, op.ts, op.ts)
        : aliveStmt.bind(code, op.word, op.payload, op.ts))
    }

    let counts
    try {
      counts = await runBatch(env, stmts)
    } catch (e) {
      console.error('sync push batch error:', e.message)
      return json({ error: 'db write failed' }, 500)
    }
    await touchMeta(env, code, serverNow) // push 即活动
    return json({ ...counts, serverNow })
  }

  // POST /api/sync/progress
  if (request.method === 'POST' && url.pathname === '/api/sync/progress') {
    let body
    try { body = await request.json() } catch { return json({ error: 'invalid json' }, 400) }
    const { code, entries } = body || {}
    if (!code || typeof code !== 'string') return json({ error: 'missing code' }, 400)
    if (!entries || typeof entries !== 'object') return json({ error: 'missing entries' }, 400)
    if (!(await codeExists(env, code))) {
      return json({ error: 'unknown code', serverNow: new Date().toISOString() }, 404)
    }

    const nowMs = Date.now()
    const serverNow = new Date(nowMs).toISOString()
    const stmt = env.DB.prepare(
      `INSERT INTO sync_progress (code, key, payload, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(code, key) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > sync_progress.updated_at`
    )

    const stmts = []
    for (const [key, item] of Object.entries(entries)) {
      if (!item || typeof item !== 'object') continue
      const payload = item.payload
      if (!payload || typeof payload !== 'object') continue
      const { ts, payload: stamped } = stampWithTs(payload, item.updatedAt || payload.updatedAt, nowMs)
      stmts.push(stmt.bind(code, String(key).slice(0, 200), stamped, ts))
    }

    let counts = { accepted: 0, rejected: 0 }
    try {
      if (stmts.length) counts = await runBatch(env, stmts)
    } catch (e) {
      console.error('sync progress error:', e.message)
      return json({ error: 'db write failed' }, 500)
    }
    await touchMeta(env, code, serverNow)
    return json({ ...counts, serverNow })
  }

  // GET /api/sync/pull?code=X
  if (request.method === 'GET' && url.pathname === '/api/sync/pull') {
    const code = (url.searchParams.get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!code || code.length !== CODE_LEN) {
      return json({ error: 'invalid code' }, 400)
    }
    if (!(await codeExists(env, code))) {
      return json({ error: 'unknown code', serverNow: new Date().toISOString() }, 404)
    }

    try {
      const [{ results }, progressRes] = await Promise.all([
        env.DB.prepare(
          'SELECT word, payload, updated_at, deleted_at FROM sync_data WHERE code = ? AND word != ?'
        ).bind(code, META).all(),
        env.DB.prepare(
          'SELECT key, payload FROM sync_progress WHERE code = ?'
        ).bind(code).all(),
      ])

      const words = {}, tombstones = {}
      let latest = ''
      for (const row of results) {
        if (row.updated_at > latest) latest = row.updated_at
        if (row.deleted_at) {
          // 墓碑：只回时间戳。words 里绝不能出现它，否则旧客户端会把已删的词加回去
          tombstones[row.word] = row.deleted_at
          continue
        }
        try {
          words[row.word] = JSON.parse(row.payload)
        } catch { /* 损坏行跳过 */ }
      }

      const progress = {}
      for (const row of progressRes.results || []) {
        try {
          progress[row.key] = JSON.parse(row.payload)
        } catch { /* 损坏行跳过 */ }
      }

      const serverNow = new Date().toISOString()
      await touchMeta(env, code, serverNow) // pull 也算活动
      return json({ words, tombstones, progress, updatedAt: latest || serverNow, serverNow })
    } catch (e) {
      console.error('sync pull error:', e.message)
      return json({ error: 'db read failed' }, 500)
    }
  }

  return null // 不匹配任何同步端点，让主路由继续
}
