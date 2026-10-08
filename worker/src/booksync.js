/**
 * my-reader 第 16 步（D14）· 账号级 BYO 书体同步 —— 服务端契约
 *
 *   PUT    /api/sync/book/<bookId>   书体（JSON 文本）→ R2 `books/<code>/<bookId>.json`
 *   GET    /api/sync/book/<bookId>   → 书体原文（application/json）
 *   DELETE /api/sync/book/<bookId>   → 删 R2 对象 ＋ 给元信息写墓碑（kind='book'）
 *
 * **边界＝账号（D14-b）**，三条路都要有效会话：
 *   无会话（含只持 8 位码的未登录设备）→ 401
 *   有会话但账号还没认领主码（查不出租户）→ 403
 * **URL 里严禁出现 code**（Ferrari 2026-10-06 裁）：租户码只由会话反推
 * `users.sync_code`，R2 键里的 `<code>` 就是它 —— 授权单位是账号，不是码。
 * 带 `?code=` → **400**（见 gate：不读、不忽略、直接拒）。
 *
 * **元信息不在这里写**：它走现有记录通道（`kind='book'`，键 `book:<bookId>`，
 * 见 sync.js 的 RECORD_KINDS / FIELDS.book 与 /api/sync/push|pull）。本文件只在
 * DELETE 时补一条墓碑 —— 「对象删了、别的设备书架还挂着这本」是个真状态（D14-c）。
 * 去重靠 bookId 内容指纹：同一本天然同键，不会重复存。
 *
 * ⚠️ **缓存**：书体响应一律 `Cache-Control: private, no-store`。URL 里不含账号，
 * 任何共享缓存命中都可能把 A 账号的书体发给 B 账号 —— 音频那套
 * `public, max-age=31536000, immutable` **不能**照搬到这里。
 *
 * 绑定的桶：复用 env.AUDIO（worker/wrangler.toml，桶 my-reader-audio），
 * `books/` 前缀与内置书音频（`<bookId>/<ch>.mp3`）天然不撞。
 */

import { corsFor } from './cors.js'
import { sessionTenant } from './syncgate.js'
import { recordKey, SQL_TOMB_UPSERT } from './sync.js'
// 块 E：删书连带清音频 —— 键布局与「按前缀清」在 bookaudio.js／audiostore.js，这里只调用
import { purgeBookAudio } from './bookaudio.js'
// 2026-10-08 D22：`books/` 前缀常量收编到 audiostore.js（authapi 不能引本文件，会成环），
// 这里只 re-export，对外契约（BOOK_PREFIX）不变
import { BOOK_BODY_PREFIX, bookBodyPrefixFor } from './audiostore.js'

export const ROUTE_PREFIX = '/api/sync/book/'
/** R2 键前缀（与内置书音频的 `<bookId>/…` 分开，一眼看得出是 BYO 正文）；来源在 audiostore.js */
export const BOOK_PREFIX = BOOK_BODY_PREFIX
/** 书体大小上限：一本 EPUB 转出的 JSON 约 0.5–1.5 MB；8 MB 留足余量，同时挡住当网盘用 */
export const MAX_BOOK_BYTES = 8 * 1024 * 1024

/** BYO 书 id 的形状（与 sync.js 的 isBookId 同一条正则；公开书 slug 一律不合格） */
const BOOK_ID_RE = /^bk_[0-9a-f]{16}$/
export function isBookId(v) { return typeof v === 'string' && BOOK_ID_RE.test(v) }

/** 书体在 R2 里的键：账号主码是**目录**，也就是租户边界 */
export function bookObjectKey(code, bookId) { return `${bookBodyPrefixFor(code)}${bookId}.json` }

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  })
}

/**
 * 会话闸（D14-b / D16）：**判定只有一份**（`syncgate.js`），这里只负责把判定
 * 成形成本路由的响应 —— 401 无会话／403 账号还没认领主码／400 URL 带码，
 * 见 `syncgate.js` 里那段顺序说明。
 */
async function gate(request, env, cors, url) {
  const g = await sessionTenant(request, env, url)
  if (!g.acct) return { res: json(cors, { error: g.error }, g.status) }
  return { acct: g.acct }
}

/**
 * 主入口：匹配就返回 Response，不匹配返回 null（让主路由继续 fallthrough）。
 * 只接 PUT / GET / DELETE；OPTIONS 由主路由在最前面答掉（预检到不了这里）。
 */
export async function handleBookSync(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith(ROUTE_PREFIX)) return null

  const method = request.method
  if (method !== 'PUT' && method !== 'GET' && method !== 'DELETE') return null

  const cors = corsFor(request, env)

  // 会话闸**先于**路径形状判定：先问「你是谁」，未登录一律 401，
  // 不因为有会话才去挑路径的毛病（顺序反了会把 401 变成 400，泄路径形状）
  const { res, acct } = await gate(request, env, cors, url)
  if (res) return res

  const raw = url.pathname.slice(ROUTE_PREFIX.length)
  let bookId = ''
  try { bookId = decodeURIComponent(raw) } catch { bookId = raw }
  if (raw.includes('/') || !isBookId(bookId)) {
    return json(cors, { error: 'invalid bookId' }, 400)
  }

  const key = bookObjectKey(acct.code, bookId)

  if (method === 'GET') {
    try {
      const obj = await env.AUDIO.get(key)
      if (!obj) return json(cors, { error: 'not found', bookId }, 404)
      return new Response(await obj.text(), {
        headers: {
          'Content-Type': 'application/json',
          // 见文件头的缓存告警：这里只能 no-store，不能 immutable
          'Cache-Control': 'private, no-store',
          ...cors,
        },
      })
    } catch (e) {
      console.error('book get failed:', e && e.message)
      return json(cors, { error: 'storage read failed' }, 500)
    }
  }

  if (method === 'PUT') {
    let text
    try { text = await request.text() } catch { return json(cors, { error: 'invalid body' }, 400) }
    if (!text) return json(cors, { error: 'empty body' }, 400)
    const size = new TextEncoder().encode(text).length
    if (size > MAX_BOOK_BYTES) return json(cors, { error: 'book too large' }, 413)
    let parsed
    try { parsed = JSON.parse(text) } catch { return json(cors, { error: 'invalid json' }, 400) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(cors, { error: 'book must be a json object' }, 400)
    }
    // 键即权威：载荷自报的 id 与路径不一致时拒收（否则同一本书会出现两个 id）
    if (parsed.id !== undefined && parsed.id !== bookId) {
      return json(cors, { error: 'bookId mismatch' }, 400)
    }
    try {
      await env.AUDIO.put(key, text, { httpMetadata: { contentType: 'application/json' } })
    } catch (e) {
      console.error('book put failed:', e && e.message)
      return json(cors, { error: 'storage write failed' }, 500)
    }
    // 幂等：同一个内容指纹重复 PUT 就是覆盖同一个键 —— 不新建、不追加、不需要 `.lock`
    // （R2 对象 PUT 是最后写入者胜；内容同指纹时写的就是同一份，重复没有副作用）
    return json(cors, { ok: true, bookId, size, updatedAt: new Date().toISOString() })
  }

  // DELETE：先删对象，再给元信息写墓碑（墓碑也可能本来就是最新的 → changes=0，不算错）
  try {
    const existed = !!(await env.AUDIO.head(key))
    await env.AUDIO.delete(key)
    // 块 E「删书连带清音频」：同一趟把 `user/<code>/<bookId>/` 也清掉 —— 客户端只发一个
    // DELETE，也不会「删了正文、忘了音频留下成孤儿对象」。恒不抛（清了 0 条也是正常的：
    // 这本书从没生成过音频）。
    const audioRemoved = await purgeBookAudio(env, acct.code, bookId)
    const nowIso = new Date().toISOString()
    let tombstoned = false
    try {
      const r = await env.DB.prepare(SQL_TOMB_UPSERT)
        .bind(acct.code, recordKey('book', bookId), 'book', nowIso, nowIso).run()
      tombstoned = !!r?.meta?.changes
    } catch (e) {
      console.error('book tombstone failed (对象已删):', e && e.message)
    }
    return json(cors, { ok: true, bookId, removed: existed, tombstoned, audioRemoved })
  } catch (e) {
    console.error('book delete failed:', e && e.message)
    return json(cors, { error: 'storage delete failed' }, 500)
  }
}