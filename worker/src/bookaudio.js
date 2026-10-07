/**
 * my-reader 第 17 步（D17）· BYO 朗读音频 —— 服务端上传/读取契约
 *
 *   PUT    /api/book/<bookId>/audio/<ch>.mp3            上传音频（二进制体）
 *   PUT    /api/book/<bookId>/audio/<ch>.timings.json   上传 timings（JSON 体）
 *   GET    /api/book/<bookId>/audio/<file>              回音频 / timings（支持 Range → 206/416）
 *   GET    /api/book/<bookId>/audio-index.json          回就绪索引（**no-store**，前端轮询靠它翻 pending）
 *   PUT    /api/book/<bookId>/audio-index.json          客户端显式上传索引
 *
 * **边界＝账号**（与第 16 步 D14 同一道闸）：三条路都要有效会话。
 *   无会话（含只持 8 位码的未登录设备）→ 401
 *   有会话但账号还没认领主码（查不出租户）  → 403
 *   URL 里出现 `?code=`                     → 400（Ferrari 2026-10-06 裁「严禁任何 code 入 URL」）
 * **判定只有一份**（syncgate.js 的 sessionTenant），这里只负责把判定成形为本路由的响应。
 * R2 键里的 `<code>` 一律由会话反推 `users.sync_code`，客户端永不传码。
 *
 * **R2 键（复用 env.AUDIO 桶 my-reader-audio）**：
 *   user/<code>/<bookId>/<ch>.mp3
 *   user/<code>/<bookId>/<ch>.timings.json
 *   user/<code>/<bookId>/audio-index.json
 * `user/` 前缀即权限边界（结构性隔离，不靠路由里的 if 兜）；正文仍走第 16 步的
 * `books/<code>/<bookId>.json`（**不动那个文件、不动 booksync.js**）。
 * `audio-index.json` 与内置书**同形**（`{ book, withAudio: [], missing: {} }`），
 * 让 reader/src/utils/audioIndex.js 零改动复用。
 *
 * ⚠️ **缓存**：`audio/<file>` 是内容寻址式的派生物（键里含 bookId ＋ 章），响应一律
 * `public, max-age=31536000, immutable` ＋ `Accept-Ranges: bytes`；但 **`audio-index.json`
 * 必须 `no-store`** —— 前端靠轮询它把 pending 翻成就绪，被缓存住就永远翻不了。
 *
 * **幂等**：不做锁。上传是用户显式动作、目标键唯一 → 同一个键重复 PUT 就是覆盖
 * （R2 没有 create-if-absent；`R2Conditional` 只有 etag/uploaded 四种条件，已核准）。
 *
 * **滥用向量（§13.7 R9）**：单文件大小上限 ＋ 单账号「有音频的书」本数上限 ＋
 * 单账号音频总量上限 ＋ 上传端点按账号限流（复用 login_attempts 的 (scope,key,ts)
 * 窗口计数手法，见 authapi.js 的 attemptCount/noteAttempt）。超配额回 403，超限流回 429，
 * 前端都退回浏览器 TTS。
 *
 * 不做：DELETE（删书／注销清 `user/<code>/` 前缀属块 E）；服务端合成（D17 已取消，
 * 本文件零算力、不引 Workers AI、不引 Queue）。
 */

import { corsFor } from './cors.js'
import { sessionTenant } from './syncgate.js'
import { parseRange } from './range.js'
import { isBookId } from './sync.js'
import { attemptCount, noteAttempt } from './authapi.js'

export const ROUTE_PREFIX = '/api/book/'
/** BYO 音频在 R2 里的前缀（`user/` 即权限边界） */
export const USER_PREFIX = 'user/'
/** 就绪索引文件名（与内置书同形） */
export const INDEX_FILE = 'audio-index.json'
/** 单个上传文件大小上限：一章 48 kbps mp3 ≈ 5 MB；8 MB 留余量，同时挡住当网盘用（手抄 MAX_BOOK_BYTES） */
export const MAX_AUDIO_FILE_BYTES = 8 * 1024 * 1024
/** 单账号音频总量上限（§13.7 R9；可 env.AUDIO_MAX_ACCOUNT_BYTES 覆盖） */
export const DEFAULT_MAX_ACCOUNT_BYTES = 500 * 1024 * 1024
/** 单账号「有音频的书」本数上限（§13.7 R9；可 env.AUDIO_MAX_BOOKS 覆盖） */
export const DEFAULT_MAX_BOOKS = 20
/** 上传端点每账号滑动窗口（次／分钟；可 env.AUDIO_UPLOAD_PER_MIN 覆盖） */
export const DEFAULT_UPLOAD_PER_MIN = 120
export const UPLOAD_WINDOW_MS = 60_000
/** 限流 scope —— 落 login_attempts 的通用 (scope,key,ts) 窗口计数器，key = 账号主码 */
const RATE_SCOPE = 'audio-upload'

const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_STORE = 'no-store'

const MP3_RE = /^([A-Za-z0-9_-]+)\.mp3$/
const TIMINGS_RE = /^([A-Za-z0-9_-]+)\.timings\.json$/

/**
 * 文件名 → 类别。只认三种：`<ch>.mp3`、`<ch>.timings.json`、`audio-index.json`。
 * `<ch>` 只允许 `[A-Za-z0-9_-]`（章 id 形如 ch-01 / p-02-001），不含点号 ——
 * 这样后缀才不会歧义。不认识 → null（调用方回 400）。
 */
export function classifyFile(file) {
  if (file === INDEX_FILE) return { kind: 'index', ch: '', contentType: 'application/json' }
  let m = MP3_RE.exec(file)
  if (m) return { kind: 'mp3', ch: m[1], contentType: 'audio/mpeg' }
  m = TIMINGS_RE.exec(file)
  if (m) return { kind: 'timings', ch: m[1], contentType: 'application/json' }
  return null
}

/** 对象在 R2 里的键：账号主码是**目录**，也就是租户边界 */
export function audioObjectKey(code, bookId, file) {
  return `${USER_PREFIX}${code}/${bookId}/${file}`
}

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  })
}

const utf8len = s => new TextEncoder().encode(s).length

/** 读阈值：env 覆盖 -> 兜底默认；非法/非正数一律回默认（与 ratelimit.js 同规矩） */
function limitOf(raw, dflt) {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

/**
 * 会话闸（D14-b / D16）：**判定只有一份**（syncgate.js），这里只负责把判定成形为
 * 本路由的响应 —— 401 无会话／403 账号还没认领主码／400 URL 带码。
 */
async function gate(request, env, cors, url) {
  const g = await sessionTenant(request, env, url)
  if (!g.acct) return { res: json(cors, { error: g.error }, g.status) }
  return { acct: g.acct }
}

/**
 * 按账号算用量（本数 ＋ 字节总量）：列举 `user/<code>/` 下全部对象。
 * ⚠️ R2 list **每页上限 1000**，必须按 cursor 循环，否则只数到第一页。
 * 列举失败 → 返回 null（**fail-open**：不因为列举失败而挡住正常上传）。
 */
async function accountUsage(env, code) {
  const prefix = `${USER_PREFIX}${code}/`
  const books = new Set()
  const sizes = new Map()
  let totalBytes = 0
  try {
    let cursor
    do {
      const page = await env.AUDIO.list(cursor ? { prefix, cursor } : { prefix })
      const objs = (page && page.objects) || []
      for (const o of objs) {
        const bid = String(o.key).slice(prefix.length).split('/')[0]
        if (bid) books.add(bid)
        const size = Number(o.size) || 0
        sizes.set(o.key, size)
        totalBytes += size
      }
      cursor = page && page.truncated ? page.cursor : null
    } while (cursor)
  } catch (e) {
    console.error('audio usage list failed (fail-open):', e && e.message)
    return null
  }
  return { books, sizes, totalBytes }
}

/** 上传端点按账号限流：数窗口内的条数，放行则记一条。整体 fail-open。 */
async function uploadRateOk(env, code, now) {
  const perMin = limitOf(env.AUDIO_UPLOAD_PER_MIN, DEFAULT_UPLOAD_PER_MIN)
  const n = await attemptCount(env, RATE_SCOPE, code, now - UPLOAD_WINDOW_MS)
  if (n >= perMin) return { ok: false, retryAfter: Math.ceil(UPLOAD_WINDOW_MS / 1000) }
  await noteAttempt(env, RATE_SCOPE, code, now, true)
  return { ok: true }
}

/**
 * 主入口：匹配就返回 Response，不匹配返回 null（让主路由继续 fallthrough）。
 * 只接 GET / PUT；OPTIONS 由主路由在最前面答掉（预检到不了这里）。
 */
export async function handleBookAudio(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null

  const method = request.method
  if (method !== 'GET' && method !== 'PUT') return null

  const cors = corsFor(request, env)

  // 会话闸**先于**路径形状判定：先问「你是谁」，未登录一律 401，
  // 不因为有会话才去挑路径的毛病（顺序反了会把 401 变成 400，泄路径形状）
  const { res, acct } = await gate(request, env, cors, url)
  if (res) return res

  // 路径形状：<bookId>/audio-index.json 或 <bookId>/audio/<file>
  const raw = url.pathname.slice(ROUTE_PREFIX.length)
  const parts = raw.split('/')
  let bookId = ''
  let file = ''
  if (parts.length === 2 && parts[1] === INDEX_FILE) {
    bookId = parts[0]
    file = INDEX_FILE
  } else if (parts.length === 3 && parts[1] === 'audio') {
    bookId = parts[0]
    file = parts[2]
  } else {
    return json(cors, { error: 'invalid path' }, 400)
  }
  try { bookId = decodeURIComponent(bookId) } catch { /* 非法编码按原样 */ }
  try { file = decodeURIComponent(file) } catch { /* 非法编码按原样 */ }
  if (!isBookId(bookId)) return json(cors, { error: 'invalid bookId' }, 400)
  const info = classifyFile(file)
  if (!info) return json(cors, { error: 'invalid file' }, 400)

  const code = acct.code
  const key = audioObjectKey(code, bookId, file)

  // ── GET ────────────────────────────────────────────────────────────────────
  if (method === 'GET') {
    // 就绪索引：**必须 no-store**（前端轮询靠它翻 pending，缓存住就永远翻不了）
    if (info.kind === 'index') {
      try {
        const obj = await env.AUDIO.get(key)
        if (!obj) return json(cors, { error: 'not found', bookId }, 404, { 'Cache-Control': NO_STORE })
        return new Response(await obj.text(), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': NO_STORE, ...cors },
        })
      } catch (e) {
        console.error('audio index get failed:', e && e.message)
        return json(cors, { error: 'storage read failed' }, 500, { 'Cache-Control': NO_STORE })
      }
    }

    // 音频 / timings：immutable ＋ Range → 206/416
    const headers = {
      'Content-Type': info.contentType,
      'Cache-Control': IMMUTABLE,
      // 不声明这个，浏览器根本不会尝试 seek，只会整份下完
      'Accept-Ranges': 'bytes',
      ...cors,
    }
    const rangeHeader = request.headers.get('Range')
    try {
      // 有 Range 时必须先 head 拿总长：后缀式（bytes=-N）和越界判定都得知道文件多大
      if (rangeHeader) {
        const meta = await env.AUDIO.head(key)
        if (!meta) return new Response('Not found', { status: 404, headers: cors })
        const r = parseRange(rangeHeader, meta.size)
        if (r === 'unsatisfiable') {
          return new Response(null, {
            status: 416,
            headers: { ...headers, 'Content-Range': `bytes */${meta.size}` },
          })
        }
        if (r) {
          const obj = await env.AUDIO.get(key, { range: { offset: r.offset, length: r.length } })
          if (!obj || !obj.body) return new Response('Not found', { status: 404, headers: cors })
          return new Response(obj.body, {
            status: 206,
            headers: {
              ...headers,
              'Content-Range': `bytes ${r.offset}-${r.offset + r.length - 1}/${meta.size}`,
              'Content-Length': String(r.length),
            },
          })
        }
        // r === null：语法不认识（多段等）→ 按 RFC 忽略 Range，落到下面回整份 200
      }

      const obj = await env.AUDIO.get(key)
      if (!obj) return new Response('Not found', { status: 404, headers: cors })
      return new Response(obj.body, { headers })
    } catch (e) {
      console.error('audio get failed:', e && e.message)
      return json(cors, { error: 'storage read failed' }, 500)
    }
  }

  // ── PUT ────────────────────────────────────────────────────────────────────
  const now = Date.now()

  // 1) 读体 ＋ 大小上限（先做，挡住最大的浪费）
  let body
  let size
  if (info.kind === 'mp3') {
    let buf
    try { buf = await request.arrayBuffer() } catch { return json(cors, { error: 'invalid body' }, 400) }
    size = buf.byteLength
    if (size === 0) return json(cors, { error: 'empty body' }, 400)
    if (size > MAX_AUDIO_FILE_BYTES) return json(cors, { error: 'file too large' }, 413)
    body = buf
  } else {
    let text
    try { text = await request.text() } catch { return json(cors, { error: 'invalid body' }, 400) }
    if (!text) return json(cors, { error: 'empty body' }, 400)
    size = utf8len(text)
    if (size > MAX_AUDIO_FILE_BYTES) return json(cors, { error: 'file too large' }, 413)
    let parsed
    try { parsed = JSON.parse(text) } catch { return json(cors, { error: 'invalid json' }, 400) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(cors, { error: 'must be a json object' }, 400)
    }
    body = text
  }

  // 2) 上传端点限流（按账号；复用 login_attempts 的 (scope,key,ts) 窗口计数手法）
  const rate = await uploadRateOk(env, code, now)
  if (!rate.ok) {
    return json(cors, { error: 'too many uploads' }, 429, { 'Retry-After': String(rate.retryAfter) })
  }

  // 3) 配额（本数 ＋ 字节总量）；列举失败 fail-open
  const usage = await accountUsage(env, code)
  if (usage) {
    const maxBooks = limitOf(env.AUDIO_MAX_BOOKS, DEFAULT_MAX_BOOKS)
    if (!usage.books.has(bookId) && usage.books.size >= maxBooks) {
      return json(cors, { error: 'book limit reached', limit: maxBooks }, 403)
    }
    const maxBytes = limitOf(env.AUDIO_MAX_ACCOUNT_BYTES, DEFAULT_MAX_ACCOUNT_BYTES)
    const projected = usage.totalBytes - (usage.sizes.get(key) || 0) + size
    if (projected > maxBytes) {
      return json(cors, { error: 'audio storage limit reached', limit: maxBytes }, 403)
    }
  }

  // 4) 落盘（键唯一 → 同一章重复 PUT 即覆盖；不做锁、不新建）
  try {
    await env.AUDIO.put(key, body, { httpMetadata: { contentType: info.contentType } })
  } catch (e) {
    console.error('audio put failed:', e && e.message)
    return json(cors, { error: 'storage write failed' }, 500)
  }
  return json(cors, { ok: true, bookId, file, size, updatedAt: new Date(now).toISOString() })
}