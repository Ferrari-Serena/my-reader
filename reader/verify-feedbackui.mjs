/**
 * 反馈通道**客户端**（`utils/feedback.js`）的验证（不依赖浏览器、不触网）。
 *   utils/feedback.js — 匿名键 / 诊断采集与收口 / 最近错误环 / 路由记忆 / 表单校验 / 提交与拉取 / 文案
 * 为什么单开一个文件：端点真伪在 worker 侧有断言的份（worker/verify-*.mjs），前端真正会错的是
 *   「诊断有没有被偷偷放行」「同一个 429 该说什么」「错了会不会把请求当真发出去」这类
 *   **埋在组件里就测不到**的判断。本文件只测纯函数与「恒不抛」的网络层。
 * 另加一条**跨文件漂移闸**：从 `worker/src/feedback.js` 现读常量与白名单，逐条比对
 *   —— 两边同值手抄，抄歪了要当场红。
 * 用法: node verify-feedbackui.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as F from './src/utils/feedback.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const mkRes = (status, body, headers) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (headers && k in headers ? headers[k] : null) },
  json: async () => { if (body === undefined) throw new Error('no body'); return body },
})
function fakeFetch(handler) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers })
    return handler(url, init)
  }
  impl.calls = calls
  return impl
}
function mkStorage(initial) {
  const map = new Map(initial || [])
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null },
    setItem(k, v) { map.set(k, v) },
  }
}
const KEY32 = 'a'.repeat(32)

// ═══ ① 常量与路径 ═══
console.log('\n[feedback — 常量与路径]')
t('FEEDBACK_ROUTE = /api/feedback', F.FEEDBACK_ROUTE === '/api/feedback')
t('超时是有限正值', Number.isFinite(F.FEEDBACK_TIMEOUT_MS) && F.FEEDBACK_TIMEOUT_MS > 0)
t('上下限 = 4 / 2000 / 120', F.MIN_MESSAGE === 4 && F.MAX_MESSAGE === 2000 && F.MAX_CONTACT === 120)
t('分类三档 = bug / idea / other', eq(F.CATEGORIES, ['bug', 'idea', 'other']))
t('状态三档 = new / read / closed', eq(F.STATUSES, ['new', 'read', 'closed']))
t('匿名键名单与存储名是常量（不与租户码共用）',
  F.ANON_KEY_RE instanceof RegExp && F.ANON_KEY_STORAGE === 'mr-feedback-key')
t('诊断白名单六格（version/viewport/lang/route/bookId/chapterId）',
  eq(Object.keys(F.CONTEXT_LIMITS).sort(),
    ['bookId', 'chapterId', 'lang', 'route', 'version', 'viewport']))
t('错误条数与单条长度上限 = 5 / 200', F.MAX_ERROR_LINES === 5 && F.MAX_ERROR_LEN === 200)
t('分类文案：认不出的分类回「Something else」，不抛',
  F.categoryLabel('bug').includes('broken') && F.categoryLabel('nope') === F.categoryLabel('other')
  && F.categoryLabel(undefined).length > 0)
t('状态文案：new → Sent（不是原样回 new）',
  F.statusLabel('new') === 'Sent' && F.statusLabel('read') === 'Read' && F.statusLabel('closed') === 'Closed')

// ═══ ② 跨文件漂移闸（现读 worker 源码比对）═══
console.log('\n[feedback — 跨文件漂移闸（与 worker/src/feedback.js 现读比对）]')
const workerPath = join(__dirname, '..', 'worker', 'src', 'feedback.js')
t('worker 侧源文件在位（不在位要当场红，不许静默跳过）', existsSync(workerPath), workerPath)
const wSrc = existsSync(workerPath) ? readFileSync(workerPath, 'utf8') : ''
const wNum = (name) => {
  const m = new RegExp(`export const ${name} = ([0-9]+)`).exec(wSrc)
  return m ? Number(m[1]) : null
}
t('MIN_MESSAGE 同值', wNum('MIN_MESSAGE') === F.MIN_MESSAGE, `worker=${wNum('MIN_MESSAGE')}`)
t('MAX_MESSAGE 同值', wNum('MAX_MESSAGE') === F.MAX_MESSAGE, `worker=${wNum('MAX_MESSAGE')}`)
t('MAX_CONTACT 同值', wNum('MAX_CONTACT') === F.MAX_CONTACT, `worker=${wNum('MAX_CONTACT')}`)
t('MAX_ERROR_LINES 同值', wNum('MAX_ERROR_LINES') === F.MAX_ERROR_LINES, `worker=${wNum('MAX_ERROR_LINES')}`)
t('MAX_ERROR_LEN 同值', wNum('MAX_ERROR_LEN') === F.MAX_ERROR_LEN, `worker=${wNum('MAX_ERROR_LEN')}`)
const wRoute = /export const ROUTE_PREFIX = '([^']+)'/.exec(wSrc)
t('ROUTE_PREFIX 与 FEEDBACK_ROUTE 同值', !!wRoute && wRoute[1] === F.FEEDBACK_ROUTE,
  `worker=${wRoute ? wRoute[1] : '（没读到）'}`)
const wCats = /export const CATEGORIES = \[([^\]]*)\]/.exec(wSrc)
t('CATEGORIES 同值（顺序也一致）',
  !!wCats && eq(wCats[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')), F.CATEGORIES),
  `worker=[${wCats ? wCats[1] : ''}]`)
const wKeyRe = /export const ANON_KEY_RE = \/(.+?)\//.exec(wSrc)
t('ANON_KEY_RE 同源（同一个正则体）',
  !!wKeyRe && wKeyRe[1] === F.ANON_KEY_RE.source,
  `worker=/${wKeyRe ? wKeyRe[1] : ''}/ client=/${F.ANON_KEY_RE.source}/`)
const wLimits = /export const CONTEXT_LIMITS = \{([\s\S]*?)\}/.exec(wSrc)
const wLimitPairs = {}
if (wLimits) {
  for (const m of wLimits[1].matchAll(/([A-Za-z_]\w*)\s*:\s*([0-9]+)/g)) wLimitPairs[m[1]] = Number(m[2])
}
t('CONTEXT_LIMITS 逐格同值（键与截断长度都不许漂）',
  eq(Object.keys(wLimitPairs).sort(), Object.keys(F.CONTEXT_LIMITS).sort())
  && Object.keys(F.CONTEXT_LIMITS).every((k) => wLimitPairs[k] === F.CONTEXT_LIMITS[k]),
  `worker=${JSON.stringify(wLimitPairs)} client=${JSON.stringify(F.CONTEXT_LIMITS)}`)
t('worker 侧有 /mine 这条（客户端拼的路径确实存在）', wSrc.includes('${ROUTE_PREFIX}/mine'))

// ═══ ③ 匿名键 ═══
console.log('\n[feedback — 匿名键]')
const k1 = F.newAnonKey()
t('新键 32 位、过名单', typeof k1 === 'string' && k1.length === 32 && F.ANON_KEY_RE.test(k1))
t('两次铸的键不同', F.newAnonKey() !== F.newAnonKey())
t('readAnonKey：没有 / null / 非字符串一律回 \'\'（读是只读的，不顺手造）',
  F.readAnonKey(mkStorage()) === '' && F.readAnonKey(null) === ''
  && F.readAnonKey(mkStorage([['mr-feedback-key', 123]])) === '')
t('readAnonKey：形状不对（太短）也算没有',
  F.readAnonKey(mkStorage([['mr-feedback-key', 'abc']])) === '')
t('ensureAnonKey：造一个并落到存储里（进程内可重复读回同一个）', (() => {
  const s = mkStorage()
  const a = F.ensureAnonKey(s)
  return F.ANON_KEY_RE.test(a) && s.map.get('mr-feedback-key') === a && F.ensureAnonKey(s) === a
})())
t('ensureAnonKey：存储里是垃圾 → 换一个新的（不沿用坏值）', (() => {
  const s = mkStorage([['mr-feedback-key', 'x']])
  const a = F.ensureAnonKey(s)
  return F.ANON_KEY_RE.test(a) && a !== 'x' && F.readAnonKey(s) === a
})())
t('ensureAnonKey：写不进去（隐私模式）→ 回 \'\'，不抛', (() => {
  const s = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  return F.ensureAnonKey(s) === ''
})())
t('ensureAnonKey：压根没有 localStorage → 回 \'\'，不抛', F.ensureAnonKey(null) === '')
t('readAnonKey：getItem 自己抛也不炸', (() => {
  try { return F.readAnonKey({ getItem: () => { throw new Error('boom') } }) === '' } catch { return false }
})())

// ═══ ④ 错误环 ═══
console.log('\n[feedback — 最近错误环]')
t('formatErrorLine：Error 对象取 message 并压成单行',
  F.formatErrorLine(new Error('a\n   b')) === 'a b')
t('formatErrorLine：有文件名才带位置（message (file:line)），没文件名就不带（不产出「(:1)」）',
  F.formatErrorLine({ message: 'boom', filename: 'https://a/b.js', lineno: 12 })
  === 'boom (https://a/b.js:12)'
  && F.formatErrorLine({ message: 'boom', lineno: 12 }) === 'boom'
  && F.formatErrorLine({ message: 'boom', lineNumber: 12 }) === 'boom'
  && F.formatErrorLine({ message: 'boom', source: 'app.js', lineNumber: 7 }) === 'boom (app.js:7)')
t('formatErrorLine：unhandledrejection 的 { reason } 也认（Error 与裸字符串两档）',
  F.formatErrorLine({ reason: new Error('nope') }) === 'nope'
  && F.formatErrorLine({ reason: 'plain' }) === 'plain')
t('formatErrorLine：认不出的一律回 \'\'（宁缺毋假）',
  ['', null, undefined, 42, {}, { message: '' }, { reason: {} }].every((x) => F.formatErrorLine(x) === ''))
t('formatErrorLine：超长截到 MAX_ERROR_LEN', (() => {
  const line = F.formatErrorLine('x'.repeat(500))
  return line.length === F.MAX_ERROR_LEN
})())
t('formatErrorLine：URL 里的 // 与空白不会把整行吃掉（压空白但保留内容）',
  F.formatErrorLine('at https://a/b.js?q=1  oops').includes('https://a/b.js?q=1'))
t('createErrorBuffer：默认封顶 5 条，且**新的在最前**', (() => {
  const b = F.createErrorBuffer()
  for (let i = 1; i <= 7; i++) b.push('e' + i)
  const l = b.list()
  return b.max === F.MAX_ERROR_LINES && l.length === 5 && l[0] === 'e7' && l[4] === 'e3'
})())
t('createErrorBuffer：连着两条一样只留一条（刷屏没有诊断价值）', (() => {
  const b = F.createErrorBuffer()
  b.push('same'); b.push('same'); b.push('other'); b.push('same')
  return eq(b.list(), ['same', 'other', 'same'])
})())
t('createErrorBuffer：空/认不出的丢、clear 清空、list 回副本（改不动内部）', (() => {
  const b = F.createErrorBuffer()
  b.push(''); b.push(null)
  const before = b.size()
  b.push('a'); b.push('b')
  b.list().push('injected')
  const copyOk = b.size() === before + 2
  b.clear()
  return before === 0 && copyOk && b.size() === 0
})())
t('createErrorBuffer：max 可调；0 兜到「至少 1 条」、非数字兜到默认 5', (() => {
  const b = F.createErrorBuffer({ max: 2 })
  b.push('a'); b.push('b'); b.push('c')
  const zero = F.createErrorBuffer({ max: 0 })
  zero.push('a'); zero.push('b')
  const junk = F.createErrorBuffer({ max: 'x' })
  return eq(b.list(), ['c', 'b']) && zero.max === 1 && eq(zero.list(), ['b'])
    && junk.max === F.MAX_ERROR_LINES
})())
t('installErrorCapture：error 与 unhandledrejection 都进环，卸载后不再进', (() => {
  // 假 window 要**真的**摘 handler —— 只记「谁被摘了」会漏掉「摘完还在收」这档 bug
  const handlers = { error: [], unhandledrejection: [] }
  const win = {
    addEventListener: (n, fn) => { handlers[n] = (handlers[n] || []).concat(fn) },
    removeEventListener: (n, fn) => { handlers[n] = (handlers[n] || []).filter((f) => f !== fn) },
  }
  const fire = (n, e) => { for (const f of (handlers[n] || []).slice()) f(e) }
  const buf = F.createErrorBuffer()
  const off = F.installErrorCapture(win, buf)
  fire('error', { message: 'boom', filename: 'https://a/x.js', lineno: 3 })
  fire('unhandledrejection', { reason: new Error('rx') })
  const got = eq(buf.list(), ['rx', 'boom (https://a/x.js:3)'])
  off()
  fire('error', { message: 'later' })
  return got && handlers.error.length === 0 && handlers.unhandledrejection.length === 0
    && buf.list().length === 2
})())
t('installErrorCapture：不是一个 window（缺 addEventListener）→ 回空卸载函数，不抛',
  typeof F.installErrorCapture(null) === 'function' && typeof F.installErrorCapture({}) === 'function')

// ═══ ⑤ 路由记忆 ═══
console.log('\n[feedback — 「出事时在哪」]')
F.noteRoute('/reader/bk_1/ch-02')
t('Reader 路由：整条记下，并拆出 bookId / chapterId',
  eq(F.lastRoute(), { route: '/reader/bk_1/ch-02', bookId: 'bk_1', chapterId: 'ch-02' }))
F.noteRoute('/books')
t('非 Reader 路由：bookId / chapterId 清空（不留上一次的）',
  eq(F.lastRoute(), { route: '/books', bookId: '', chapterId: '' }))
F.noteRoute('/feedback')
t('反馈页自己**不覆盖**记忆（提交时还得知道上一条路由）', F.lastRoute().route === '/books')
F.noteRoute('/reader/bk%201')
t('路径段做 percent 解码（bk%201 → bk 1）', F.lastRoute().bookId === 'bk 1')
t('lastRoute 回副本（外部改不动内部）', (() => {
  const a = F.lastRoute()
  a.route = 'injected'
  return F.lastRoute().route === '/reader/bk%201'
})())

// ═══ ⑥ 诊断采集与收口 ═══
console.log('\n[feedback — 诊断采集与收口]')
t('collectDiagnostics：视口拼成 WxH、语言取 navigator.language',
  (() => {
    const d = F.collectDiagnostics({ innerWidth: 390.4, innerHeight: 844, navigator: { language: 'zh-CN' } })
    return d.viewport === '390x844' && d.lang === 'zh-CN'
  })())
t('collectDiagnostics：拿不到的字段回 \'\'（不编默认值）',
  (() => {
    const d = F.collectDiagnostics({})
    return d.viewport === '' && d.lang === ''
  })())
t('sanitizeContext：白名单外全丢、非字符串全丢、trim 后空的丢', (() => {
  const out = F.sanitizeContext({
    version: '  abc  ', viewport: 123, lang: '   ', route: '/books',
    email: 'a@b.com', bookId: 'bk_1', nope: 'x',
  })
  return eq(out, { version: 'abc', route: '/books', bookId: 'bk_1' })
})())
t('sanitizeContext：逐格截到白名单长度（确实在截，不只是「不崩」）', (() => {
  const out = F.sanitizeContext({ lang: 'y'.repeat(100), route: 'r'.repeat(300), version: 'v'.repeat(200) })
  return out.lang.length === F.CONTEXT_LIMITS.lang
    && out.route.length === F.CONTEXT_LIMITS.route
    && out.version.length === F.CONTEXT_LIMITS.version
})())
t('sanitizeContext：errors 只留前 5 条、每条截 200、非字符串丢掉', (() => {
  const out = F.sanitizeContext({ errors: ['1', 2, ' '.repeat(3), '3', '4', '5', '6', 'x'.repeat(400)] })
  return out.errors.length === F.MAX_ERROR_LINES
    && out.errors.every((e) => typeof e === 'string' && e.length <= F.MAX_ERROR_LEN)
    && out.errors[0] === '1'
})())
t('sanitizeContext：不是普通对象一律回 {}（数组/字符串/null 都不许原样回传）',
  ['x', 42, null, undefined, ['a']].every((x) => eq(F.sanitizeContext(x), {})))
t('sanitizeContext：errors 不是数组 → 当没有', eq(F.sanitizeContext({ route: '/a', errors: 'x' }), { route: '/a' }))
t('buildContext：显式传的覆盖默认，且整体过白名单', (() => {
  const c = F.buildContext({ route: '/books/x', version: '', errors: [], bookId: 'bk_9' })
  return c.route === '/books/x' && !('version' in c) && !('errors' in c) && c.bookId === 'bk_9'
})())
t('buildContext：默认取错误环（已装的错会被带出去）', (() => {
  F.appErrorBuffer.clear()
  F.appErrorBuffer.push('live-error')
  const c = F.buildContext({ route: '/x', errors: undefined })
  F.appErrorBuffer.clear()
  return eq(c.errors, ['live-error'])
})())

// ═══ ⑦ 表单校验 ═══
console.log('\n[feedback — 表单校验]')
t('messageProblem：3 字符 → 拦（下限 4）', F.messageProblem('abc') !== null)
t('messageProblem：4 字符 → 过；两端空白先 trim', F.messageProblem('abcd') === null && F.messageProblem('  abcd  ') === null)
t('messageProblem：只有空白 → 拦', F.messageProblem('    ') !== null)
t('messageProblem：2000 → 过、2001 → 拦（边界）',
  F.messageProblem('x'.repeat(2000)) === null && F.messageProblem('x'.repeat(2001)) !== null)
t('messageProblem：非字符串 → 拦',
  F.messageProblem(null) !== null && F.messageProblem(42) !== null && F.messageProblem(undefined) !== null)
t('contactProblem：空 → 过（可选），120 → 过、121 → 拦',
  F.contactProblem('') === null && F.contactProblem('x'.repeat(120)) === null && F.contactProblem('x'.repeat(121)) !== null)
t('draftProblem：正文优先于联系方式（两个都错时报正文那句）', (() => {
  const m = F.draftProblem({ message: 'a', contact: 'x'.repeat(200) })
  return m !== null && m.toLowerCase().includes('at least')
})())

// ═══ ⑧ 载荷 ═══
console.log('\n[feedback — 载荷]')
t('feedbackPayload：正文 trim、分类白名单外按 other', (() => {
  const p = F.feedbackPayload({ category: 'nope', message: '  hi there  ' })
  return p.category === 'other' && p.message === 'hi there' && p.contact === ''
})())
t('feedbackPayload：键形状不对 → \'\'（宁可不带，也不发个服务端认不出的）', (() => {
  return F.feedbackPayload({ message: 'abcd', key: 'short' }).key === ''
    && F.feedbackPayload({ message: 'abcd', key: KEY32 }).key === KEY32
})())
t('feedbackPayload：context 走白名单（塞了 email 也进不来）', (() => {
  const p = F.feedbackPayload({ message: 'abcd', context: { route: '/a', email: 'a@b.com' } })
  return eq(p.context, { route: '/a' })
})())
t('feedbackPayload：联系方式超长按上限截（服务端也截同一长度）',
  F.feedbackPayload({ message: 'abcd', contact: 'x'.repeat(500) }).contact.length === F.MAX_CONTACT)

// ═══ ⑨ 网络（恒不抛）═══
console.log('\n[feedback — 网络（恒不抛）]')
t('minePath：键合法才带 ?key=（且 percent 编码）',
  F.minePath(KEY32) === `/api/feedback/mine?key=${KEY32}` && F.minePath('short') === '/api/feedback/mine'
  && F.minePath(undefined) === '/api/feedback/mine')
t('normalizeItems：坏行丢掉、未知分类→other、未知状态→new', (() => {
  const rows = F.normalizeItems([
    { id: 3, createdAt: '2026-10-09T00:00:00.000Z', category: 'bug', message: 'm', status: 'read' },
    { id: 0, message: 'no-id' },
    { id: 4, category: 'weird', status: 'weird' },
    'junk',
  ])
  return rows.length === 2 && rows[0].id === 3 && rows[0].status === 'read'
    && rows[1].category === 'other' && rows[1].status === 'new' && rows[1].message === ''
})())
t('normalizeItems：不是数组 → []', eq(F.normalizeItems('x'), []) && eq(F.normalizeItems(null), []))

const okRes = () => mkRes(201, { ok: true, signedIn: false, category: 'bug' })
{
  const f = fakeFetch(() => okRes())
  const r = await F.submitFeedback({ category: 'bug', message: '  hello there  ', contact: ' me@x.com ', key: KEY32, context: { route: '/books', email: 'no' } }, { fetchImpl: f })
  const sent = JSON.parse(f.calls[0].body)
  t('提交：POST 到 /api/feedback、带 JSON 头', f.calls[0].method === 'POST' && f.calls[0].url === '/api/feedback'
    && f.calls[0].headers['Content-Type'] === 'application/json')
  t('提交：正文/联系方式 trim 后发出、分类原样', sent.message === 'hello there' && sent.contact === 'me@x.com' && sent.category === 'bug')
  t('提交：键与诊断原样带上，白名单外的字段没进去',
    sent.key === KEY32 && eq(sent.context, { route: '/books' }))
  t('提交：成功 → ok:true、status 201', r.ok && r.status === 201)

  const g = fakeFetch(() => mkRes(400, { error: 'message-too-short' }))
  const bad = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: g })
  t('提交：400 带错误码原样回（不抛）', !bad.ok && bad.status === 400 && bad.error === 'message-too-short')

  const h = fakeFetch(() => mkRes(429, { error: 'too-many-feedback', scope: 'burst' }, { 'Retry-After': '600' }))
  const limited = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: h })
  t('提交：429 的 Retry-After 读出来（600 秒）', !limited.ok && limited.status === 429 && limited.retryAfter === 600)

  const i = fakeFetch(() => mkRes(500, null))
  const boom = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: i })
  t('提交：500 → ok:false（不抛）', !boom.ok && boom.status === 500)

  const j = fakeFetch(() => { throw new Error('offline') })
  const net = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: j })
  t('提交：网络错 → status 0 / reason network', !net.ok && net.status === 0 && net.reason === 'network')

  const kAbort = fakeFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })
  const to = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: kAbort })
  t('提交：超时（AbortError）→ reason timeout（与网络错分开）', to.status === 0 && to.reason === 'timeout')

  const noCall = fakeFetch(() => okRes())
  const short = await F.submitFeedback({ message: 'ab' }, { fetchImpl: noCall })
  t('提交：正文太短 → bad-draft，**一个请求都不发**', short.reason === 'bad-draft' && noCall.calls.length === 0)
  const long = await F.submitFeedback({ message: 'x'.repeat(2001) }, { fetchImpl: noCall })
  t('提交：正文太长 → bad-draft，也不发请求',
    long.reason === 'bad-draft' && long.error === 'message-too-long' && noCall.calls.length === 0)

  const rDefault = await F.submitFeedback({ message: 'abcd' }, { fetchImpl: f })
  const sentDefault = JSON.parse(f.calls[f.calls.length - 1].body)
  t('提交：不传 key/context 时自己兜（裸 node 没有 localStorage → 键为 \'\'，照样发得出去）',
    rDefault.ok && sentDefault.key === '' && typeof sentDefault.context === 'object')
}

{
  const f = fakeFetch(() => mkRes(200, { signedIn: true, items: [{ id: 1, message: 'm', category: 'idea', status: 'new' }] }))
  const r = await F.fetchMyFeedback({ key: KEY32, fetchImpl: f })
  t('拉取：GET /api/feedback/mine?key=…', f.calls[0].method === 'GET' && f.calls[0].url === `/api/feedback/mine?key=${KEY32}`)
  t('拉取：200 → signedIn 与条目都归一好', r.ok && r.signedIn && r.items.length === 1 && r.items[0].id === 1)

  const g = fakeFetch(() => mkRes(401, { error: 'unauthenticated' }))
  const un = await F.fetchMyFeedback({ fetchImpl: g })
  t('拉取：401 → ok:false + 空表（「还没提过」不是错误）', !un.ok && un.status === 401 && eq(un.items, []))

  const h = fakeFetch(() => { throw new Error('offline') })
  const net = await F.fetchMyFeedback({ fetchImpl: h })
  t('拉取：网络错 → reason network、空表、不抛', net.reason === 'network' && eq(net.items, []) && net.status === 0)

  const i = fakeFetch(() => mkRes(200, { items: 'junk' }))
  const weird = await F.fetchMyFeedback({ fetchImpl: i })
  t('拉取：回执形状坏 → 空表（不妄断）', weird.ok && eq(weird.items, []))
}

// ═══ ⑩ 文案 ═══
console.log('\n[feedback — 文案]')
t('retryMinutes：0/负/非数字 → 0（不编分钟数）',
  F.retryMinutes(0) === 0 && F.retryMinutes(-5) === 0 && F.retryMinutes('x') === 0)
t('retryMinutes：30 秒 → 1、60 → 1、61 → 2、600 → 10',
  F.retryMinutes(30) === 1 && F.retryMinutes(60) === 1 && F.retryMinutes(61) === 2 && F.retryMinutes(600) === 10)
t('429 + retryAfter=600 → 报「约 10 分钟」（不吞掉具体值）',
  F.feedbackErrorText(429, { error: 'too-many-feedback', retryAfter: 600 }).includes('10 minutes'))
t('429 但没带 retryAfter → 照样说「太频繁」，且不乱编数字', (() => {
  const m = F.feedbackErrorText(429, { error: 'too-many-feedback' })
  return m.includes('Too many') && !/[0-9]/.test(m)
})())
t('429 带 retryAfter=60 → 「1 minute」（单数，不写 1 minutes）',
  F.feedbackErrorText(429, { error: 'too-many-feedback', retryAfter: 60 }).includes('1 minute '))
t('code 优先于 status：message-too-long + 400 说长度，不说「检查一下」',
  F.feedbackErrorText(400, { error: 'message-too-long' }).includes(String(F.MAX_MESSAGE)))
t('403（外站 Origin）→ 提示刷新重试，不是「未知错误」',
  F.feedbackErrorText(403, { error: 'bad-origin' }).toLowerCase().includes('reload'))
t('status 0 → 提示查网络', F.feedbackErrorText(0, {}).toLowerCase().includes('connection'))
t('5xx → 说「我们这边出问题」', F.feedbackErrorText(503, {}).includes('our side'))
t('认不出来的码 → 兜底一句且不抛（含 HTTP 码）',
  F.feedbackErrorText(418, {}).includes('418') && F.feedbackErrorText(undefined, undefined).length > 0)
t('submitResultLine：成功 → ok:true 且是道谢口吻', (() => {
  const r = F.submitResultLine({ ok: true, status: 201 })
  return r.ok && r.text.includes('Thanks')
})())
t('submitResultLine：bad-draft 两档分别说短/说长，且都不提网络',
  (() => {
    const s = F.submitResultLine({ ok: false, reason: 'bad-draft', error: 'message-too-short' })
    const l = F.submitResultLine({ ok: false, reason: 'bad-draft', error: 'message-too-long' })
    return !s.ok && s.text.includes('at least') && !l.ok && l.text.includes(String(F.MAX_MESSAGE))
  })())
t('submitResultLine：429 走限流那句', (() => {
  const r = F.submitResultLine({ ok: false, status: 429, error: 'too-many-feedback', retryAfter: 600 })
  return !r.ok && r.text.includes('10 minutes')
})())
t('submitResultLine：认不出的入参也不抛', typeof F.submitResultLine(undefined).text === 'string')

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
