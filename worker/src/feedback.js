/**
 * 客服／反馈通道（第 13 步 · D11「表单写自家 D1」）
 *
 *   POST  /api/feedback        → 提交（**免登录**；带本机匿名键）
 *   GET   /api/feedback/mine   → 我提过的（登录按 user_id；未登录按 ?key= 匿名键）
 *   GET   /api/feedback        → 后台只读列表（Bearer = env.METRICS_TOKEN；未配一律 404）
 *   PATCH /api/feedback/<id>   → 后台改状态（同一个 Bearer）
 *
 * ── 为什么用**独立匿名键**，不拿同步租户码当关联键 ──────────────────────────
 *   第 16.5 步（D16）之后「客户端永不传码」；而且**首次登录会把本机游客码改名**成账号主码
 *   （authapi 的 handleClaim：旧码底下的行整体搬到新码下，旧码随之作废）。若拿租户码当反馈的
 *   关联键，游客期提的那条在登录后**再也查不到**（键被改掉了）。所以前端另存一个**只用于反馈**、
 *   登录前后都不变的随机键 ⇒「我的反馈」= `WHERE user_id = ? OR anon_key = ?`，
 *   游客期提的、登录后照样看得见。
 *
 * ── 隐私边界（方案 13.2：只收诊断、不收内容）──────────────────────────────
 *   · UA 由**服务端**从请求头取 —— 不信客户端自报（自报的可以随便编）
 *   · context 走**白名单 + 逐个截断**（sanitizeContext）⇒ **不存任意客户端 JSON**
 *   · **不落 IP**（滥用计数在 rate_limit_events / login_attempts 里，见 0007 迁移注释）
 *   · 不收书正文／生词／笔记／邮箱／cookie —— 前端也不该往 context 里塞（塞了也进不来）
 *
 * ── 滥用闸 ────────────────────────────────────────────────────────────────
 *   两层，都按 IP：10 分钟 5 条（burst）＋ 24 小时 20 条（day）。复用 `login_attempts`
 *   这张 (scope, key, ts) 计数表（scope = 'feedback'）—— 它本来就是「按 scope+key 数窗口内条数」
 *   的通用机件，不值得为反馈单开一张表。读失败一律 fail-open（与 ratelimit.js 同姿态）。
 */

import { corsFor } from './cors.js'
import { clientIp } from './ratelimit.js'
import { attemptCount, noteAttempt, sessionUserId, originBlocked } from './authapi.js'

export const ROUTE_PREFIX = '/api/feedback'

/** 正文长度上下限（字符）：下限防「提交个空」，上限防把整本书贴进来 */
export const MIN_MESSAGE = 4
export const MAX_MESSAGE = 2000
export const MAX_CONTACT = 120

/** 分类与状态白名单：认不出的分类按 other 收（不报错）；未知状态一律 400 */
export const CATEGORIES = ['bug', 'idea', 'other']
export const STATUSES = ['new', 'read', 'closed']

/** 列表条数：默认 50，硬顶 200 */
export const LIST_LIMIT_DEFAULT = 50
export const LIST_LIMIT_MAX = 200

/** 匿名键形态：前端铸 32 位 hex；放宽到 base64url 字符集，8~64 位 */
export const ANON_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/

/** 提交闸（按 IP） */
export const FB_SCOPE = 'feedback'
export const FB_WINDOW_MS = 10 * 60 * 1000
export const FB_MAX_PER_WINDOW = 5
export const FB_DAY_MS = 24 * 60 * 60 * 1000
export const FB_MAX_PER_DAY = 20

/** 诊断字段白名单：键 → 截断长度。**不在表里的键直接丢** */
export const CONTEXT_LIMITS = {
  version: 64,
  viewport: 24,
  lang: 24,
  route: 120,
  bookId: 64,
  chapterId: 64,
}
export const MAX_ERROR_LINES = 5
export const MAX_ERROR_LEN = 200
/** UA 由服务端从请求头取，单独给个上限 */
export const UA_MAX = 300

export const SQL_INSERT_FEEDBACK = `INSERT INTO feedback
  (created_at, user_id, anon_key, category, message, contact, context, status, status_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

// 「我的反馈」：登录按 user_id、未登录按 anon_key。两个占位符都绑字符串（缺失绑 ''）——
// 库里缺失的一侧是 NULL，恒不匹配 ''，所以用一条 SQL 同时覆盖三档（只登录／只带键／两者都有）。
export const SQL_MINE = `SELECT id, created_at, category, message, status, status_at FROM feedback
  WHERE (user_id IS NOT NULL AND user_id = ?) OR (anon_key IS NOT NULL AND anon_key = ?)
  ORDER BY created_at DESC, id DESC LIMIT ?`

export const SQL_ADMIN_LIST = `SELECT id, created_at, user_id, anon_key, category, message, contact, context, status, status_at
  FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?`

export const SQL_ADMIN_LIST_BY_STATUS = `SELECT id, created_at, user_id, anon_key, category, message, contact, context, status, status_at
  FROM feedback WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?`

export const SQL_STATUS_COUNTS = `SELECT status, COUNT(*) AS n FROM feedback GROUP BY status`

export const SQL_SET_STATUS = `UPDATE feedback SET status = ?, status_at = ? WHERE id = ?`

function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors, ...extra },
  })
}

/**
 * 诊断字段收口（纯函数，自检直接钉）。
 * 只认 CONTEXT_LIMITS 里的键：必须是字符串、trim 后非空、截到上限；其余一律丢。
 * errors 同一套规则，另加条数上限（只留前 MAX_ERROR_LINES 条）。
 * 入参不是普通对象（null／数组／字符串）一律回 {} —— 绝不回传原值。
 */
export function sanitizeContext(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const key of Object.keys(CONTEXT_LIMITS)) {
    const v = raw[key]
    if (typeof v !== 'string') continue
    const s = v.trim().slice(0, CONTEXT_LIMITS[key])
    if (s) out[key] = s
  }
  const errs = Array.isArray(raw.errors) ? raw.errors : []
  const kept = errs
    .filter(e => typeof e === 'string')
    .map(e => e.trim().slice(0, MAX_ERROR_LEN))
    .filter(Boolean)
    .slice(0, MAX_ERROR_LINES)
  if (kept.length) out.errors = kept
  return out
}

/** 提交体校验（纯函数）：{ ok:true, value } | { ok:false, error } */
export function validateSubmission(raw) {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < MIN_MESSAGE) return { ok: false, error: 'message-too-short' }
  if (message.length > MAX_MESSAGE) return { ok: false, error: 'message-too-long' }
  const contact = typeof body.contact === 'string' ? body.contact.trim().slice(0, MAX_CONTACT) : ''
  const rawKey = typeof body.key === 'string' ? body.key.trim() : ''
  return {
    ok: true,
    value: {
      message,
      contact,
      category: CATEGORIES.includes(body.category) ? body.category : 'other',
      anonKey: ANON_KEY_RE.test(rawKey) ? rawKey : '',
      context: sanitizeContext(body.context),
    },
  }
}

/**
 * 后台口令：与 GET /api/metrics 同一份（env.METRICS_TOKEN）。未配置 / 不符一律 404 ——
 * 与 handleMetrics 同姿态：既不暴露「存在这个端点」，也不外泄任何一行反馈。
 */
function adminAllowed(request, env) {
  const token = (env.METRICS_TOKEN || '').trim()
  return !!token && request.headers.get('Authorization') === `Bearer ${token}`
}

/** ?limit= 夹到 1..LIST_LIMIT_MAX，非法值回默认 */
export function clampLimit(raw) {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return LIST_LIMIT_DEFAULT
  return Math.min(n, LIST_LIMIT_MAX)
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null)

/** 「我的反馈」一行（只回自己看得到的字段，**不含** anon_key／user_id／context） */
export function shapeRow(row) {
  return {
    id: row.id,
    createdAt: iso(row.created_at),
    category: row.category,
    message: row.message,
    status: row.status,
    statusAt: iso(row.status_at),
  }
}

/** 后台一行（含归属与诊断；context 解析失败就当空对象，不让一行坏数据把整页打崩） */
export function shapeAdminRow(row) {
  let context = {}
  try { context = row.context ? JSON.parse(row.context) : {} } catch { context = {} }
  return {
    id: row.id,
    createdAt: iso(row.created_at),
    userId: row.user_id || null,
    anonKey: row.anon_key || null,
    category: row.category,
    message: row.message,
    contact: row.contact || null,
    context,
    status: row.status,
    statusAt: iso(row.status_at),
  }
}

/**
 * 反馈端点分发。不归本模块管的路径回 null（与 handleSync / handleBookSync / handleAuth 同一协议）。
 * 判定**不用裸 startsWith**：`/api/feedbackX` 不是我的（会被 `PREFIX + '/'` 那条挡在外面）。
 */
export async function handleFeedback(request, env) {
  const url = new URL(request.url)
  const path = url.pathname
  if (path !== ROUTE_PREFIX && !path.startsWith(`${ROUTE_PREFIX}/`)) return null
  const cors = corsFor(request, env)

  if (path === `${ROUTE_PREFIX}/mine`) {
    if (request.method !== 'GET') return json(cors, { error: 'method-not-allowed' }, 405)
    return await handleMine(request, env, cors, url)
  }

  const idMatch = path.match(/^\/api\/feedback\/(\d+)$/)
  if (idMatch) {
    if (request.method !== 'PATCH') return json(cors, { error: 'method-not-allowed' }, 405)
    return await handlePatch(request, env, cors, Number(idMatch[1]))
  }

  if (path === ROUTE_PREFIX) {
    if (request.method === 'POST') return await handleSubmit(request, env, cors)
    if (request.method === 'GET') return await handleAdminList(request, env, cors, url)
    return json(cors, { error: 'method-not-allowed' }, 405)
  }

  return json(cors, { error: 'not-found' }, 404)
}

/** 提交：免登录；登录时顺带把 user_id 一起记下 */
async function handleSubmit(request, env, cors) {
  // 写操作先过 Origin 闸（CSRF 第一层，与 /api/auth/* 同一把）：挡得住「借用户浏览器」，
  // 挡不住 curl —— 脚本滥用靠下面那道限额。
  if (originBlocked(request, env)) return json(cors, { error: 'bad-origin' }, 403)

  let body
  try {
    body = await request.json()
  } catch {
    return json(cors, { error: 'invalid-json' }, 400)
  }
  const verdict = validateSubmission(body)
  if (!verdict.ok) return json(cors, { error: verdict.error }, 400)
  const { message, contact, category, anonKey, context } = verdict.value

  const now = Date.now()
  const ip = clientIp(request)

  // 先查后插（读失败 fail-open）
  const burst = await attemptCount(env, FB_SCOPE, ip, now - FB_WINDOW_MS)
  if (burst >= FB_MAX_PER_WINDOW) {
    return json(cors, { error: 'too-many-feedback', scope: 'burst' }, 429,
      { 'Retry-After': String(Math.ceil(FB_WINDOW_MS / 1000)), 'Cache-Control': 'no-store' })
  }
  const day = await attemptCount(env, FB_SCOPE, ip, now - FB_DAY_MS)
  if (day >= FB_MAX_PER_DAY) {
    return json(cors, { error: 'too-many-feedback', scope: 'day' }, 429,
      { 'Retry-After': String(Math.ceil(FB_DAY_MS / 1000)), 'Cache-Control': 'no-store' })
  }

  const userId = await sessionUserId(request, env)
  const ua = (request.headers.get('User-Agent') || '').trim().slice(0, UA_MAX)
  const stored = ua ? { ...context, ua } : { ...context }

  try {
    await env.DB.prepare(SQL_INSERT_FEEDBACK)
      .bind(now, userId || null, anonKey || null, category, message, contact || null,
        JSON.stringify(stored), 'new', null)
      .run()
  } catch (e) {
    console.error('feedback insert failed:', e && e.message)
    return json(cors, { error: 'store-failed' }, 500)
  }

  // 收下了才计数；burst === 0 说明这是窗口内第一条 → 顺手清过老的行（purgeOld）
  await noteAttempt(env, FB_SCOPE, ip, now, burst === 0)
  return json(cors, { ok: true, signedIn: !!userId, category }, 201, { 'Cache-Control': 'no-store' })
}

/** 我提过的：登录按 user_id，未登录要带本机匿名键；两者都没有 → 401 */
async function handleMine(request, env, cors, url) {
  const userId = await sessionUserId(request, env)
  const rawKey = (url.searchParams.get('key') || '').trim()
  const anonKey = ANON_KEY_RE.test(rawKey) ? rawKey : ''
  if (!userId && !anonKey) return json(cors, { error: 'unauthenticated' }, 401)
  try {
    const res = await env.DB.prepare(SQL_MINE)
      .bind(userId || '', anonKey || '', LIST_LIMIT_DEFAULT).all()
    const rows = (res && res.results) || []
    return json(cors, { signedIn: !!userId, items: rows.map(shapeRow) }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    console.error('feedback mine failed:', e && e.message)
    return json(cors, { error: 'db read failed' }, 500)
  }
}

/** 后台列表（只读）。凭 METRICS_TOKEN；未配 / 不符 → 404（不是 401：不暴露端点存在） */
async function handleAdminList(request, env, cors, url) {
  if (!adminAllowed(request, env)) return new Response('Not found', { status: 404, headers: cors })
  const status = (url.searchParams.get('status') || '').trim()
  if (status && !STATUSES.includes(status)) return json(cors, { error: 'bad-status' }, 400)
  const limit = clampLimit(url.searchParams.get('limit'))
  try {
    const stmt = status
      ? env.DB.prepare(SQL_ADMIN_LIST_BY_STATUS).bind(status, limit)
      : env.DB.prepare(SQL_ADMIN_LIST).bind(limit)
    const res = await stmt.all()
    const items = ((res && res.results) || []).map(shapeAdminRow)
    // 各状态条数（「每条都有人看」的待办面）；读不到不算失败
    let counts = {}
    try {
      const cr = await env.DB.prepare(SQL_STATUS_COUNTS).all()
      for (const r of ((cr && cr.results) || [])) counts[r.status] = r.n
    } catch { /* 附赠项 */ }
    return json(cors, { counts, items }, 200, { 'Cache-Control': 'no-store' })
  } catch (e) {
    console.error('feedback list failed:', e && e.message)
    return json(cors, { error: 'db read failed' }, 500)
  }
}

/** 后台改状态（new / read / closed）。行不存在回 404（changes=0） */
async function handlePatch(request, env, cors, id) {
  if (!adminAllowed(request, env)) return new Response('Not found', { status: 404, headers: cors })
  let body
  try {
    body = await request.json()
  } catch {
    return json(cors, { error: 'invalid-json' }, 400)
  }
  const status = body && typeof body.status === 'string' ? body.status.trim() : ''
  if (!STATUSES.includes(status)) return json(cors, { error: 'bad-status' }, 400)
  const now = Date.now()
  try {
    const r = await env.DB.prepare(SQL_SET_STATUS).bind(status, now, id).run()
    const changes = (r && r.meta && r.meta.changes) || 0
    if (!changes) return json(cors, { error: 'not-found' }, 404)
    return json(cors, { ok: true, id, status, statusAt: iso(now) })
  } catch (e) {
    console.error('feedback status update failed:', e && e.message)
    return json(cors, { error: 'db write failed' }, 500)
  }
}