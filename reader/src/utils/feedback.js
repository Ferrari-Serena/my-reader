/**
 * 反馈通道（第 13 步 · 块 B）—— 前端的**唯一口径件**。
 *
 *   POST /api/feedback              { category, message, contact?, key?, context } → 201
 *   GET  /api/feedback/mine?key=…   → 200 { signedIn, items[] }（登录时按会话，不必带 key）
 *
 * 服务端契约在 `worker/src/feedback.js`，本文件是它在客户端的对应件：常量与诊断白名单
 * **手抄同值**（verify-feedbackui.mjs 逐条钉住）；网络一律**恒不抛**，与 `utils/genApi.js`
 * 同姿态（拿不到就退回「没发出去」，绝不自己编状态）。
 *
 * 为什么住 `utils/`（主包）：入口挂在**账号页**（常驻 tab），而主包**不许静态引
 * `src/generate/`**（体积 ＋ lamejs 的 LGPL 边界，见 verify-generate.mjs）。本文件只碰
 * `localStorage` / `window` / `fetch`，不带任何重家伙。
 *
 * ── 隐私边界（与方案 13.2、服务端逐条对应）────────────────────────────────
 *   · 只收**诊断**：版本 / 视口 / 语言 / 出事时那个路由 / 最近几条错误文本。
 *     **不收**书正文、生词、笔记、邮箱、cookie —— 前端也不该往 context 里塞（塞了服务端也丢）。
 *   · 诊断走**白名单 + 逐个截断**（`sanitizeContext`，与 worker 同一张表）。客户端先截一遍
 *     是为了「**预览里看到的 ＝ 发出去的**」，不是替代服务端那道闸。
 *   · UA 由**服务端**从请求头取，客户端不许自报（自报可以随便编），所以这里没有这个字段。
 *   · **匿名键独立于租户码**：D16 之后客户端永不传码；且首次登录会把本机游客码改名 ⇒ 拿租户码
 *     当关联键会让「游客期提的那条」登录后再也查不到（见 worker/src/feedback.js 头注）。
 *     这里的键只服务「我提过的」，登录前后都不变。
 */

export const FEEDBACK_ROUTE = '/api/feedback'
/** 单次请求超时：提交与「我提过的」共用（都是小请求） */
export const FEEDBACK_TIMEOUT_MS = 10000

// ── 与 worker/src/feedback.js 同值手抄（那边改了这边就得改，闸会咬）───────────
export const MIN_MESSAGE = 4
export const MAX_MESSAGE = 2000
export const MAX_CONTACT = 120
export const CATEGORIES = ['bug', 'idea', 'other']
export const STATUSES = ['new', 'read', 'closed']
export const ANON_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/
export const LIST_LIMIT_DEFAULT = 50
export const MAX_ERROR_LINES = 5
export const MAX_ERROR_LEN = 200
/** 诊断白名单：键 → 截断长度。**不在表里的键直接丢**（与 worker 的 CONTEXT_LIMITS 同值） */
export const CONTEXT_LIMITS = {
  version: 64,
  viewport: 24,
  lang: 24,
  route: 120,
  bookId: 64,
  chapterId: 64,
}

/** 匿名键在 localStorage 里的键名 —— **独立于**租户码（不与同步那套共用） */
export const ANON_KEY_STORAGE = 'mr-feedback-key'

export const CATEGORY_LABELS = {
  bug: 'Something is broken',
  idea: 'An idea',
  other: 'Something else',
}
export function categoryLabel(key) { return CATEGORY_LABELS[key] || CATEGORY_LABELS.other }

export const STATUS_LABELS = { new: 'Sent', read: 'Read', closed: 'Closed' }
export function statusLabel(s) { return STATUS_LABELS[s] || String(s || '') }

const HEX = '0123456789abcdef'

function num(v, dflt = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

function safeLocalStorage() {
  try { return globalThis.localStorage || null } catch { return null }
}

/** 安全地解一个路径段（坏 percent 编码不该把整条链炸掉） */
function dec(s) {
  try { return decodeURIComponent(String(s || '')) } catch { return String(s || '') }
}

// ── ① 匿名键 ─────────────────────────────────────────────────────────────

/** 铸一个 32 位 hex 的匿名键（优先 crypto；认不出的环境退回 Math.random） */
export function newAnonKey() {
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') {
    const a = new Uint8Array(16)
    c.getRandomValues(a)
    let s = ''
    for (const b of a) s += b.toString(16).padStart(2, '0')
    return s
  }
  let s = ''
  for (let i = 0; i < 32; i++) s += HEX[Math.floor(Math.random() * 16)]
  return s
}

/** 读本机匿名键；没有 / 形状不对一律回 ''（**不**顺手造一个 —— 读就该是只读的） */
export function readAnonKey(storage) {
  try {
    const raw = storage && typeof storage.getItem === 'function' ? storage.getItem(ANON_KEY_STORAGE) : null
    const s = typeof raw === 'string' ? raw.trim() : ''
    return ANON_KEY_RE.test(s) ? s : ''
  } catch { return '' }
}

/**
 * 拿本机匿名键，没有就造一个并**持久化**。
 * 存不下（隐私模式 / 配额满 / 压根没有 localStorage）→ 回 ''：宁可这一条反馈不带键
 * （照样提交得出去，只是「我提过的」查不到），也不要发一个存不住的键。
 */
export function ensureAnonKey(storage = safeLocalStorage()) {
  const cur = readAnonKey(storage)
  if (cur) return cur
  const fresh = newAnonKey()
  try {
    if (!storage || typeof storage.setItem !== 'function') return ''
    storage.setItem(ANON_KEY_STORAGE, fresh)
  } catch { return '' }
  return fresh
}

// ── ② 最近错误环（main.js 装、反馈页读同一个）──────────────────────────────

/**
 * 一行错误 → 短文本（压成单行、截到 MAX_ERROR_LEN）。认不出就回 ''（宁缺毋假）。
 * 吃三种输入：字符串 / Error（或 `{ reason: Error }`）/ `window.onerror` 那种事件对象。
 */
export function formatErrorLine(input) {
  let msg = ''
  let where = ''
  if (typeof input === 'string') {
    msg = input
  } else if (input && typeof input === 'object') {
    const reason = input.reason
    if (typeof input.message === 'string' && input.message) msg = input.message
    else if (reason && typeof reason.message === 'string' && reason.message) msg = reason.message
    else if (typeof reason === 'string') msg = reason
    if (!msg) return ''
    if (typeof input.filename === 'string' && input.filename) where = input.filename
    else if (typeof input.source === 'string' && input.source) where = input.source
    if (where) {
      if (Number.isFinite(input.lineno) && input.lineno > 0) where += ':' + input.lineno
      else if (Number.isFinite(input.lineNumber) && input.lineNumber > 0) where += ':' + input.lineNumber
    }
  }
  const s = String(msg || '').replace(/\s+/g, ' ').trim()
  if (!s) return ''
  const text = where ? `${s} (${String(where).replace(/\s+/g, '')})` : s
  return text.slice(0, MAX_ERROR_LEN)
}

/**
 * 最近错误环。**新的在最前** —— 服务端只留前 MAX_ERROR_LINES 条，新的必须排前面才留得住。
 * 纯内存：刷新即清（诊断只服务「这一次出事」，不做长期留痕）。
 */
export function createErrorBuffer({ max = MAX_ERROR_LINES } = {}) {
  const cap = Math.max(1, num(max, MAX_ERROR_LINES))
  const lines = []
  return {
    max: cap,
    push(raw) {
      const line = formatErrorLine(raw)
      if (!line) return
      // 连着两条一样就只留一条（同一处循环报错刷屏没有诊断价值）
      if (lines[0] === line) return
      lines.unshift(line)
      if (lines.length > cap) lines.length = cap
    },
    list() { return lines.slice() },
    clear() { lines.length = 0 },
    size() { return lines.length },
  }
}

/** 进程内单例：`main.js` 装在这上面，`FeedbackView` 读的也是它 */
export const appErrorBuffer = createErrorBuffer()

/**
 * 把环挂到 window 的 `error` / `unhandledrejection` 上。返回卸载函数（测试与热重载用）。
 * 用 `addEventListener`（**不**覆盖 `window.onerror`）—— 只旁听，不动别人已挂的 handler。
 */
export function installErrorCapture(win, buffer = appErrorBuffer) {
  if (!win || typeof win.addEventListener !== 'function') return () => {}
  const onError = (e) => buffer.push(e)
  const onRejection = (e) => buffer.push(e && e.reason ? e.reason : e)
  win.addEventListener('error', onError)
  win.addEventListener('unhandledrejection', onRejection)
  return () => {
    if (typeof win.removeEventListener !== 'function') return
    win.removeEventListener('error', onError)
    win.removeEventListener('unhandledrejection', onRejection)
  }
}

// ── ③ 「出事时在哪」(路由记忆) ──────────────────────────────────────────────

const routeState = { route: '', bookId: '', chapterId: '' }

/**
 * 记下当前路由。**反馈页自己不算** —— 用户站在反馈页提交时，「出事时在哪」是**上一条**
 * 路由（很可能就是出问题的那一页），记成 `/feedback` 等于把唯一有用的线索擦掉。
 * Reader 路由顺便拆出 bookId / chapterId（诊断白名单里有这两格）。
 */
export function noteRoute(fullPath) {
  const p = typeof fullPath === 'string' ? fullPath : ''
  if (!p || p.startsWith('/feedback')) return
  routeState.route = p
  const m = /^\/reader\/([^/?#]+)(?:\/([^/?#]+))?/.exec(p)
  routeState.bookId = m ? dec(m[1]) : ''
  routeState.chapterId = m && m[2] ? dec(m[2]) : ''
}

export function lastRoute() { return { ...routeState } }

// ── ④ 诊断采集 ─────────────────────────────────────────────────────────────

/**
 * 构建版本（`vite.config.js` 的 `__APP_VERSION__` 注入 = CI 上的 commit 短号）。
 * 裸 node / 老构建里没有这号 → 回 ''（那句 `typeof` 正是为「没定义也不炸」而写）。
 */
export function appVersion() {
  try {
    if (typeof __APP_VERSION__ === 'string' && __APP_VERSION__) {
      return __APP_VERSION__.slice(0, CONTEXT_LIMITS.version)
    }
  } catch { /* 未注入 */ }
  return ''
}

/** 视口 / 语言：拿不到的字段回 ''（**不编**默认值 —— 「不知道」要看得出来） */
export function collectDiagnostics(win = globalThis) {
  const w = win || {}
  const nav = w.navigator || {}
  const vw = num(w.innerWidth, 0)
  const vh = num(w.innerHeight, 0)
  return {
    version: appVersion(),
    viewport: vw > 0 && vh > 0 ? `${Math.round(vw)}x${Math.round(vh)}` : '',
    lang: typeof nav.language === 'string' ? nav.language : '',
  }
}

/**
 * 诊断收口（客户端这一半）：与 worker 的 `sanitizeContext` **同一套规则**。
 * 只认 CONTEXT_LIMITS 里的键：字符串、trim 后非空、截到上限；其余一律丢。
 * `errors` 同规则另加条数上限。入参不是普通对象一律回 {}（绝不回传原值）。
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
    .filter((e) => typeof e === 'string')
    .map((e) => e.trim().slice(0, MAX_ERROR_LEN))
    .filter(Boolean)
    .slice(0, MAX_ERROR_LINES)
  if (kept.length) out.errors = kept
  return out
}

/**
 * 组装待发送的诊断：路由记忆 ＋ 视口/语言 ＋ 错误环。
 * 每一项都可以**显式传值覆盖**（测试用）；传 `undefined` 才走默认。
 */
export function buildContext(overrides = {}, win = globalThis) {
  const o = overrides && typeof overrides === 'object' ? overrides : {}
  const d = collectDiagnostics(win)
  const r = lastRoute()
  const pick = (k, dflt) => (o[k] === undefined ? dflt : o[k])
  return sanitizeContext({
    version: pick('version', d.version),
    viewport: pick('viewport', d.viewport),
    lang: pick('lang', d.lang),
    route: pick('route', r.route),
    bookId: pick('bookId', r.bookId),
    chapterId: pick('chapterId', r.chapterId),
    errors: pick('errors', appErrorBuffer.list()),
  })
}

// ── ⑤ 表单校验（纯函数，组件只负责画）──────────────────────────────────────

/** 正文太短/太长 → 一句人话；没问题回 null（与 worker 的上下限同值） */
export function messageProblem(message) {
  const s = typeof message === 'string' ? message.trim() : ''
  if (s.length < MIN_MESSAGE) return `Please write at least ${MIN_MESSAGE} characters, so we know what happened.`
  if (s.length > MAX_MESSAGE) return `That is too long — please keep it under ${MAX_MESSAGE} characters.`
  return null
}

/** 联系方式（可选）超长 → 一句人话。**不静默截断**：截一半的邮箱没用，不如让用户自己删 */
export function contactProblem(contact) {
  const s = typeof contact === 'string' ? contact.trim() : ''
  if (s.length > MAX_CONTACT) return `Please keep your contact under ${MAX_CONTACT} characters.`
  return null
}

export function draftProblem({ message, contact } = {}) {
  return messageProblem(message) || contactProblem(contact)
}

/** 提交载荷（与服务端 validateSubmission 同形）。未在名单里的分类按 other 收。 */
export function feedbackPayload(draft = {}) {
  const d = draft && typeof draft === 'object' ? draft : {}
  const rawKey = typeof d.key === 'string' ? d.key.trim() : ''
  return {
    category: CATEGORIES.includes(d.category) ? d.category : 'other',
    message: typeof d.message === 'string' ? d.message.trim() : '',
    contact: typeof d.contact === 'string' ? d.contact.trim().slice(0, MAX_CONTACT) : '',
    key: ANON_KEY_RE.test(rawKey) ? rawKey : '',
    context: sanitizeContext(d.context),
  }
}

// ── ⑥ 网络（恒不抛）───────────────────────────────────────────────────────

async function requestJson(fetchImpl, url, init, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(url, { ...(init || {}), signal: ctrl ? ctrl.signal : undefined })
    const status = num(res && res.status)
    let body = null
    try { body = await res.json() } catch { body = null }
    // 429 的 Retry-After（秒）：只在能读到时才带出来，读不到回 0（不编）
    let retryAfter = 0
    try {
      const h = res && res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('Retry-After') : null
      const n = Number.parseInt(String(h == null ? '' : h), 10)
      retryAfter = Number.isFinite(n) && n > 0 ? n : 0
    } catch { retryAfter = 0 }
    return { ok: !!(res && res.ok), status, body, retryAfter }
  } catch (e) {
    return {
      ok: false, status: 0, body: null, retryAfter: 0,
      reason: (e && e.name === 'AbortError') ? 'timeout' : 'network',
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 提交一条反馈。**恒不抛**：
 *   本地就不合格（正文太短/太长）→ `{ ok:false, reason:'bad-draft' }`，**连请求都不发**；
 *   201 → `{ ok:true, status:201, data:{ signedIn, category } }`；
 *   429 → 带 `retryAfter`（文案交给 `submitResultLine`）；
 *   网络/超时 → `{ status:0, reason:'timeout'|'network' }`。
 * `key` 不传（undefined）时自动 `ensureAnonKey()`；传 `''` 就真的不带键（测试与降级用）。
 */
export async function submitFeedback(draft = {}, {
  fetchImpl = globalThis.fetch, timeoutMs = FEEDBACK_TIMEOUT_MS, win = globalThis,
} = {}) {
  const d = draft && typeof draft === 'object' ? draft : {}
  const payload = feedbackPayload({
    category: d.category,
    message: d.message,
    contact: d.contact,
    key: d.key === undefined ? ensureAnonKey() : d.key,
    context: d.context === undefined ? buildContext({}, win) : d.context,
  })
  if (!payload.message || payload.message.length < MIN_MESSAGE) {
    return { ok: false, status: 0, reason: 'bad-draft', error: 'message-too-short', retryAfter: 0, data: null }
  }
  if (payload.message.length > MAX_MESSAGE) {
    return { ok: false, status: 0, reason: 'bad-draft', error: 'message-too-long', retryAfter: 0, data: null }
  }
  const r = await requestJson(fetchImpl, FEEDBACK_ROUTE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }, timeoutMs)
  return {
    ok: r.ok,
    status: r.status,
    reason: r.reason || (r.ok ? null : 'http'),
    error: (r.body && r.body.error) || null,
    retryAfter: r.retryAfter || 0,
    data: r.ok ? (r.body || {}) : null,
  }
}

/** 「我提过的」路径：键合法才带 `?key=`（形状不对宁可不带 —— 服务端也只认这个形状） */
export function minePath(key) {
  const s = typeof key === 'string' ? key.trim() : ''
  return ANON_KEY_RE.test(s)
    ? `${FEEDBACK_ROUTE}/mine?key=${encodeURIComponent(s)}`
    : `${FEEDBACK_ROUTE}/mine`
}

/** 列表一行归一（形状坏的行丢掉，不妄断） */
export function normalizeItems(items) {
  const rows = Array.isArray(items) ? items : []
  return rows.map((it) => {
    const o = it && typeof it === 'object' ? it : {}
    return {
      id: num(o.id, 0),
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : '',
      category: CATEGORIES.includes(o.category) ? o.category : 'other',
      message: typeof o.message === 'string' ? o.message : '',
      status: STATUSES.includes(o.status) ? o.status : 'new',
      statusAt: typeof o.statusAt === 'string' ? o.statusAt : '',
    }
  }).filter((it) => it.id > 0)
}

/**
 * 拉「我提过的」。登录时服务端按会话认（不必带键），未登录按 `?key=` 认；
 * 两者都没有 → 401（**不是错误**，只是「这台上还没提过」）。
 */
export async function fetchMyFeedback({ key, fetchImpl = globalThis.fetch, timeoutMs = FEEDBACK_TIMEOUT_MS } = {}) {
  const r = await requestJson(fetchImpl, minePath(key), { method: 'GET' }, timeoutMs)
  const b = (r.body && typeof r.body === 'object' && !Array.isArray(r.body)) ? r.body : {}
  return {
    ok: r.ok,
    status: r.status,
    reason: r.reason || (r.ok ? null : 'http'),
    signedIn: !!b.signedIn,
    items: r.ok ? normalizeItems(b.items) : [],
  }
}

// ── ⑦ 文案（一句话，只此一份）─────────────────────────────────────────────

/** 秒 → 「约几分钟」（向上取整、至少 1）；不是正数回 0（不编分钟数） */
export function retryMinutes(sec) {
  const s = num(sec, 0)
  if (!(s > 0)) return 0
  return Math.max(1, Math.ceil(s / 60))
}

/** 失败那一句。`code` 优先于 `status`（`too-many-feedback` ＋ 429 仍是「太频繁」） */
export function feedbackErrorText(status, body = {}) {
  const b = body && typeof body === 'object' ? body : {}
  const code = b.error
  if (code === 'too-many-feedback') {
    const m = retryMinutes(b.retryAfter)
    return m > 0
      ? `Too many reports from this device — please wait about ${m} minute${m === 1 ? '' : 's'} and try again.`
      : 'Too many reports from this device — please wait a little and try again.'
  }
  if (code === 'message-too-long') return `That is too long — please keep it under ${MAX_MESSAGE} characters.`
  if (code === 'message-too-short') return `Please write at least ${MIN_MESSAGE} characters.`
  if (status === 400) return 'That did not go through — please check what you wrote and try again.'
  if (status === 403) return 'That did not go through (this page looks like an outside site). Try reloading, then send again.'
  if (!status) return 'Could not reach the server — check your connection and try again.'
  if (status >= 500) return 'Something went wrong on our side — please try again later.'
  return `That did not go through (HTTP ${status}) — please try again.`
}

/** 提交结果 → `{ ok, text }`（成/败两种口吻；本地不合格走 bad-draft 那一档） */
export function submitResultLine(result) {
  const r = result && typeof result === 'object' ? result : {}
  if (r.ok) return { ok: true, text: 'Thanks — we got it. You can send another from this page any time.' }
  if (r.reason === 'bad-draft') {
    return {
      ok: false,
      text: r.error === 'message-too-long'
        ? `That is too long — please keep it under ${MAX_MESSAGE} characters.`
        : `Please write at least ${MIN_MESSAGE} characters.`,
    }
  }
  return { ok: false, text: feedbackErrorText(r.status, { error: r.error, retryAfter: r.retryAfter }) }
}
