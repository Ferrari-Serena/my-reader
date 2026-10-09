/**
 * my-reader 第 17 步（D17）· BYO 朗读音频 —— 服务端上传/读取契约
 *
 *   PUT    /api/book/<bookId>/audio/<ch>.mp3            上传音频（二进制体）
 *   PUT    /api/book/<bookId>/audio/<ch>.timings.json   上传 timings（JSON 体）
 *   GET    /api/book/<bookId>/audio/<file>              回音频 / timings（支持 Range → 206/416）
 *   GET    /api/book/<bookId>/audio-index.json          回就绪索引（**no-store**，前端轮询靠它翻 pending）
 *   PUT    /api/book/<bookId>/audio-index.json          客户端显式上传索引
 *   DELETE /api/book/<bookId>/audio                    **清空该书音频**（D25：只删 user/<code>/<bookId>/
 *                                                      下的 mp3 ＋ timings，再回写空 audio-index.json；
 *                                                      **绝不碰** books/<code>/<bookId>.json 那份正文）。
 *                                                      D25-f：同趟把该书 D1 的 `done`／`failed`
 *                                                      行作废成 `purged`（可重新生成、配额照记）；
 *                                                      该书还有章在跑 → **409，谁也不清**
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
 * **两种 DELETE 语义相反、不许合并**（D25-c）：
 *   · 本文件 `DELETE /api/book/<bookId>/audio` ＝ **用户主动腾空间**：只删音频，**正文与笔记不动**
 *     （正文仍是 `books/<code>/<bookId>.json`），做完回写空索引 ⇒ 额度随 R2 前缀清空自动放回。
 *   · `booksync.js` 的 `DELETE /api/sync/book/<bookId>` ＝ **删掉这本书**：连带删云端正文（D14-c）。
 * **D25-f（2026-10-08 Ferrari 裁 A）—— 清空之后这一章必须真的回到「可生成」**：只删 R2 是不够的，
 *   D1 里 `done` 的那一行会让重新提交被判 `already-done`（D21-h 的「删音频再生成」名存实亡）。
 *   故清空前先把 `done`／`failed` 作废成 `purged`（见 `audiogen.js` 的 `purgeBookTasks`）：
 *     · 行**不删** —— 日配额按行求和，删行＝清空即免额度；
 *     · 有 `pending`／`running` 就**拒绝清空**（409）—— 中途清空会让在跑那一章把 mp3 写回
 *       一个刚清空的目录，用户看到「清了又有」；
 *     · 作废失败（读表／写表抖了）也**拒绝清空**（503）—— 行留 `done` 而音频没了，这一章
 *       就再没人能生成了（服务端判 already-done，没有回头的路）。
 * 单章删音频不做（粒度过细，D25-d）；单章「重新生成」也不做（D21-h）—— 要重来就走
 * 书级「清空该书音频」再提交（清空后这些章就是「未生成」的章）。别加一条单章清除的路。
 * 注销真删导致的前缀清理（`purgeAccountAudio`）属 D22／块 E，同样不在这里。
 * 服务端合成不在此文件（块 C 的 `audiogen.js`；D17 端上那套已降级为离线兜底）。
 */

import { corsFor } from './cors.js'
import { sessionTenant } from './syncgate.js'
import { parseRange } from './range.js'
import { isBookId } from './sync.js'
import { attemptCount, noteAttempt } from './authapi.js'
// 块 E：键布局 ＋ 「按前缀清」搬到 audiostore.js（三处共用；authapi 不能反向引本文件，见该文件头注）
import { USER_PREFIX, audioObjectKey, audioPrefixFor, bookAudioPrefixFor, purgePrefix } from './audiostore.js'
// D25-f：清空音频要同趟把 D1 的任务行作废 —— 与 `audiogen.js` **互为反向 import**（它引本文件的
// `audioObjectKey`／`INDEX_FILE`）。这个环是**有意留的**：两边都只在**函数体里**用对方（运行期），
// 没有一处依赖对方在模块求值期就绪；且两边都是函数声明 ⇒ 绑定提升。两种加载顺序都真跑过
// （verify-audiogen 先引 audiogen、verify-bookaudio 先引 bookaudio）。拆环要把 `INDEX_FILE`
// 挪进 audiostore.js，代价大于收益，不动。
import { purgeBookTasks } from './audiogen.js'

export const ROUTE_PREFIX = '/api/book/'
/** 键布局与清理的真身在 `audiostore.js`；这里**原样再导出**，调用方与自检不必改 import。 */
export { USER_PREFIX, audioObjectKey }
/** 就绪索引文件名（与内置书同形） */
export const INDEX_FILE = 'audio-index.json'
/** 单个上传文件大小上限：一章 48 kbps mp3 ≈ 5 MB；8 MB 留余量，同时挡住当网盘用（手抄 MAX_BOOK_BYTES） */
export const MAX_AUDIO_FILE_BYTES = 8 * 1024 * 1024
/** 单账号音频总量上限（§13.7 R9；**D23 由 500 MiB 上调到 1 GiB**；可 env.AUDIO_MAX_ACCOUNT_BYTES 覆盖） */
export const DEFAULT_MAX_ACCOUNT_BYTES = 1024 * 1024 * 1024
/** 单账号「有音频的书」本数上限（§13.7 R9；可 env.AUDIO_MAX_BOOKS 覆盖）—— 「有音频」＝至少有 mp3／timings，只有空索引不算（D25-b 裁 A） */
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
 *
 * **本数只数「真有音频」的书**（`audio-index.json` 不算，2026-10-08 D25-b 裁 A）：
 * 索引是清空／生成后**我们自己写的状态标记**，不是用户内容 —— 把它算进本数的话，
 * 「清空该书音频」就腾不出本数槽位（实测：上限 2 本时清空一本，第 3 本照样 403），
 * 与 D25「用户主动腾空间」的动机直接冲突。**字节**照旧把索引算进去（它真占存储）。
 */
async function accountUsage(env, code) {
  const prefix = audioPrefixFor(code)
  const books = new Set()
  const sizes = new Map()
  let totalBytes = 0
  try {
    let cursor
    do {
      const page = await env.AUDIO.list(cursor ? { prefix, cursor } : { prefix })
      const objs = (page && page.objects) || []
      for (const o of objs) {
        const rest = String(o.key).slice(prefix.length)
        const cut = rest.indexOf('/')
        const bid = cut < 0 ? rest : rest.slice(0, cut)
        const name = cut < 0 ? '' : rest.slice(cut + 1)
        if (bid && name && name !== INDEX_FILE) books.add(bid)
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

/**
 * 账号音频存储状态（字节用量 ＋ 上限 ＋ 是否已满）—— **上传／提交／起跑三处共用一份口径**。
 * 读不到用量（列举失败）→ `usedBytes = -1`、`full = false`：**fail-open**，与上传路径同姿态，
 * 不因为一次列举抖动就挡住用户。`full` 只在**确实读到**用量且 ≥ 上限时为真。
 */
export async function storageState(env, code) {
  const limitBytes = limitOf(env.AUDIO_MAX_ACCOUNT_BYTES, DEFAULT_MAX_ACCOUNT_BYTES)
  const usage = await accountUsage(env, code)
  const usedBytes = usage ? usage.totalBytes : -1
  return { usedBytes, limitBytes, full: usedBytes >= 0 && usedBytes >= limitBytes }
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
 * 删一本书的全部音频（块 E「删书连带清音频」）：清 `user/<code>/<bookId>/`。
 * 由 `booksync.js` 的 DELETE 同趟调用 —— 客户端只发一个请求，也不会「删了正文忘了音频」。
 * **恒不抛**；返回删掉的条数（失败 -1，只用来回报／记日志）。
 */
export function purgeBookAudio(env, code, bookId) {
  return purgePrefix(env, bookAudioPrefixFor(code, bookId))
}

/**
 * 删一个账号的全部音频（块 E「注销连带清音频」，判据 5）：清 `user/<code>/`。
 * 由 `authapi.js` 的 `purgeDeletedAccounts`（冷静期到期**真删**）调用 —— 软删标记本身不动数据。
 * **恒不抛**；返回删掉的条数（失败 -1）。
 */
export function purgeAccountAudio(env, code) {
  return purgePrefix(env, audioPrefixFor(code))
}

/**
 * DELETE 的实现（D25「清空该书音频」）：① D1 行作废 → ② 清 `user/<code>/<bookId>/` → ③ 回写空索引。
 *
 * ① 先作废 D1 的行（D25-f）：两道闸都不许过 —— `pending`／`running` 在跑 → 409；读表／写表
 *   失败 → 503。**两种都不清**：清空与作废必须同进同退（理由见文件头 D25-f 那段）。
 *
 * ②③ 顺序：**先清前缀、后写空索引** —— 与块 C「索引最后写」同向。反过来的话，清空崩在中途
 * 会留下「索引说还有音频、对象已经没了」，播放器点下去就是 404；按现顺序最坏也只是
 * 「索引说没有、对象还在」（用户看到「没有音频」⇒ 退回浏览器朗读，空间下次再腾）。
 *
 * ⚠️ 空索引**必须写**：索引整份缺失在前端读作「这本没生成过 ⇒ 不妄断，按有音频处理」，
 * 播放器会去点一个并不存在的 mp3 → 404。写一份 `{ withAudio: [], missing: {} }` 才是
 * 「明确说没有」。
 *
 * **恒不抛**（`purgePrefix` 自己吞异常）；`removedAudioObjects = -1` 表示清理出错（已记日志）。
 */
async function clearBookAudio(env, cors, code, bookId) {
  // ① D1 行作废（D25-f）
  const purge = await purgeBookTasks(env, code, bookId)
  if (purge.refused) {
    return json(cors, {
      error: 'tasks-running', bookId, open: purge.open,
      note: 'wait for the running chapters to finish, then clear again',
    }, 409)
  }
  if (!purge.ok) return json(cors, { error: 'task purge failed', bookId }, 503)

  // ② 清前缀
  const removed = await purgeBookAudio(env, code, bookId)
  // ③ 回写空索引
  let indexCleared = false
  try {
    await env.AUDIO.put(audioObjectKey(code, bookId, INDEX_FILE),
      JSON.stringify({ book: bookId, withAudio: [], missing: {} }),
      { httpMetadata: { contentType: 'application/json' } })
    indexCleared = true
  } catch (e) {
    console.error('audio index clear failed:', e && e.message)
  }
  const ok = removed >= 0 && indexCleared
  return json(cors, {
    ok, bookId, removedAudioObjects: removed, indexCleared, tasksPurged: purge.purged,
  }, ok ? 200 : 500)
}

/**
 * 主入口：匹配就返回 Response，不匹配返回 null（让主路由继续 fallthrough）。
 * 接 GET / PUT / DELETE（DELETE 只用于 D25 的清空该书音频）；OPTIONS 由主路由在最前面答掉。
 */
export async function handleBookAudio(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null

  const method = request.method
  if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') return null

  const cors = corsFor(request, env)

  // 会话闸**先于**路径形状判定：先问「你是谁」，未登录一律 401，
  // 不因为有会话才去挑路径的毛病（顺序反了会把 401 变成 400，泄路径形状）
  const { res, acct } = await gate(request, env, cors, url)
  if (res) return res

  // 路径形状：<bookId>/audio-index.json ｜ <bookId>/audio/<file> ｜ <bookId>/audio（D25：只服务 DELETE）
  const raw = url.pathname.slice(ROUTE_PREFIX.length)
  const parts = raw.split('/')
  let bookId = ''
  let file = ''
  let clearAll = false
  if (parts.length === 2 && parts[1] === INDEX_FILE) {
    bookId = parts[0]
    file = INDEX_FILE
  } else if (parts.length === 2 && parts[1] === 'audio') {
    // D25：整本一个形状的路径只给 DELETE；其余动词在这个形状上回 405（见下）
    bookId = parts[0]
    clearAll = true
  } else if (parts.length === 3 && parts[1] === 'audio') {
    bookId = parts[0]
    file = parts[2]
  } else {
    return json(cors, { error: 'invalid path' }, 400)
  }
  try { bookId = decodeURIComponent(bookId) } catch { /* 非法编码按原样 */ }
  try { file = decodeURIComponent(file) } catch { /* 非法编码按原样 */ }
  if (!isBookId(bookId)) return json(cors, { error: 'invalid bookId' }, 400)
  const info = clearAll
    ? { kind: 'book-audio-all', ch: '', contentType: 'application/json' }
    : classifyFile(file)
  if (!info) return json(cors, { error: 'invalid file' }, 400)

  const code = acct.code
  const key = audioObjectKey(code, bookId, file)

  // ── DELETE（D25：书级「清空该书音频」；D25-f：同趟作废 D1 的行）────────────────
  // 只接整本那一种形状；单章／单文件的删除不做（D25-d 粒度过细）。
  if (method === 'DELETE') {
    if (!clearAll) return json(cors, { error: 'method not allowed' }, 405, { Allow: 'PUT, GET' })
    return clearBookAudio(env, cors, code, bookId)
  }
  // `<bookId>/audio` 只服务 DELETE：GET 没有「整本一个响应」这件事，PUT 更不该有
  if (clearAll) return json(cors, { error: 'method not allowed' }, 405, { Allow: 'DELETE' })

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