/**
 * feedback.js 的验证（第 13 步 · 块 A —— 客服／反馈通道，D11「表单写自家 D1」）
 * 用法: node verify-feedback.mjs
 *
 * 六层：
 *   ① 形状与常量 —— 路由前缀 / 正文上下限 / 分类与状态白名单 / 匿名键形态 / 两层闸的阈值 / limit 夹取
 *   ② 诊断收口（纯函数）—— 白名单外的键一个都进不来 / 超长截断 / errors 只留 5 条·每条 200 字 / 非对象回 {}
 *   ③ 提交体校验（纯函数）—— 太短太长 / 分类认不出按 other / 坏匿名键丢掉 / 联系方式截断
 *   ④ 分发认路 —— 别的路径回 null；`/api/feedbackX`、`/api/feedbackback` **不是我的**（裸前缀会误伤）
 *   ⑤ 提交端到端（真 SQLite）—— 免登录能提 · 落库字段对（**UA 来自请求头**）· 外站 Origin 403 ·
 *      长度闸 · 两层限额 429（**且没落库**）· 别的 IP 不受牵连
 *   ⑥ 我的反馈 ＋ 后台 —— 未登录无键 401 / 带键只回自己 / 登录按 user_id ＋ 同键的游客期历史 /
 *      后台无令牌→404（不是 401）/ 倒序 ＋ counts / PATCH 改状态 / 未知状态 400 / 不存在 404
 *
 * ⚠️ 手工注入故障自检（照 §12.4 的规矩）：把 `originBlocked` 那道闸拆掉 → 本文件必须变红 →
 *   还原 → 记 SHA256 逐字节一致 → 再全绿。那一步不在文件里（改的是源码），跑法与结果记在项目日志。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  handleFeedback, sanitizeContext, validateSubmission, clampLimit, shapeRow, shapeAdminRow,
  ROUTE_PREFIX, MIN_MESSAGE, MAX_MESSAGE, MAX_CONTACT, CATEGORIES, STATUSES,
  LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, ANON_KEY_RE, CONTEXT_LIMITS, MAX_ERROR_LINES, MAX_ERROR_LEN,
  FB_SCOPE, FB_WINDOW_MS, FB_MAX_PER_WINDOW, FB_DAY_MS, FB_MAX_PER_DAY,
} from './src/feedback.js'
import { tokenHash } from './src/auth.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const one = (db, sql, ...args) => db.prepare(sql).get(...args) || {}

const BASE = 'https://my-reader.ferrari11.com'
const METRICS = 'metrics-token-feedback'
const UA = 'Mozilla/5.0 (TestUA)'

const db = new DatabaseSync(':memory:')
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))

const env = { DB: d1(db), METRICS_TOKEN: METRICS }

// ── 适配器：真 SQLite 冒充 D1（与 verify-audiogen.mjs 同一份形状）────────────────
function d1(database) {
  return {
    prepare(sql) {
      const stmt = database.prepare(sql)
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

/** 造请求：默认带 UA 与 CF-Connecting-IP（限流按 IP，测试里每个用例给不同 IP 互不干扰） */
function req(path, { method = 'GET', body, ip = '203.0.113.9', cookie, origin, ua = UA, headers = {} } = {}) {
  const h = { 'User-Agent': ua, ...headers }
  if (ip) h['CF-Connecting-IP'] = ip
  if (cookie) h.Cookie = `mr_session=${cookie}`
  if (origin) h.Origin = origin
  if (body !== undefined) h['Content-Type'] = 'application/json'
  return new Request(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
}
const call = (path, opts) => handleFeedback(req(path, opts), env)

console.log('\n[① 形状与常量]')
t('路由前缀是 /api/feedback', ROUTE_PREFIX === '/api/feedback')
t('正文 4~2000 字', MIN_MESSAGE === 4 && MAX_MESSAGE === 2000 && MAX_CONTACT === 120)
t('分类白名单三档（bug/idea/other）', eq(CATEGORIES, ['bug', 'idea', 'other']))
t('状态白名单三档（new/read/closed）', eq(STATUSES, ['new', 'read', 'closed']))
t('匿名键：32 位 hex 通过 / 7 位太短不通过 / 含空格不通过',
  ANON_KEY_RE.test('a'.repeat(32)) && !ANON_KEY_RE.test('a'.repeat(7)) && !ANON_KEY_RE.test('abc def123'))
t('两层限额：10 分钟 5 条 ＋ 24 小时 20 条（日闸比窗口闸松，别让它先咬）',
  FB_SCOPE === 'feedback' && FB_MAX_PER_WINDOW === 5 && FB_MAX_PER_DAY === 20 && FB_DAY_MS / FB_WINDOW_MS === 144)
t('列表默认 50、硬顶 200', LIST_LIMIT_DEFAULT === 50 && LIST_LIMIT_MAX === 200)
t('clampLimit：非法／0／负数回默认，超顶夹到 200，正常值照用',
  clampLimit('') === 50 && clampLimit('0') === 50 && clampLimit('-3') === 50 && clampLimit('999') === 200 && clampLimit('7') === 7)

console.log('\n[② 诊断收口 sanitizeContext（纯函数）]')
{
  const got = sanitizeContext({
    version: '  1.2.3  ', viewport: '390x844', lang: 'zh-CN', route: '/reader/bk_a/ch-01',
    bookId: 'bk_a', chapterId: 'ch-01',
    secret: '不该进来', password: 'x', cookie: 'a=b',
    errors: ['E1', 'E2'],
  })
  t('白名单内的键都留下（trim 过）', got.version === '1.2.3' && got.viewport === '390x844' && got.lang === 'zh-CN')
  t('白名单外的键一个都没进来（客户端塞什么都进不了库）',
    !('secret' in got) && !('password' in got) && !('cookie' in got))
  t('errors 照收', eq(got.errors, ['E1', 'E2']))
  t('空串不算值（不留空键）', !('route' in sanitizeContext({ route: '   ' })))
  t('超长截断到上限', sanitizeContext({ route: 'x'.repeat(500) }).route.length === CONTEXT_LIMITS.route)
  t(`errors 只留前 ${MAX_ERROR_LINES} 条`, sanitizeContext({ errors: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }).errors.length === 5)
  t(`errors 每条截 ${MAX_ERROR_LEN} 字`, sanitizeContext({ errors: ['y'.repeat(500)] }).errors[0].length === 200)
  t('errors 里的非字符串丢掉', eq(sanitizeContext({ errors: ['ok', 42, null, { a: 1 }] }).errors, ['ok']))
  t('非对象入参回 {}（不把原值兜出去）',
    eq(sanitizeContext(null), {}) && eq(sanitizeContext('x'), {}) && eq(sanitizeContext(['a']), {}))
  t('数字型字段不算字符串（不当值）', !('viewport' in sanitizeContext({ viewport: 390 })))
}

console.log('\n[③ 提交体校验 validateSubmission（纯函数）]')
{
  t('太短 → message-too-short', validateSubmission({ message: '嗯' }).error === 'message-too-short')
  t('太长 → message-too-long', validateSubmission({ message: 'x'.repeat(2001) }).error === 'message-too-long')
  t('非对象／空 → 也走太短（不炸）', !validateSubmission(null).ok && !validateSubmission('x').ok)
  const v = validateSubmission({
    message: '  一本书的第 3 章点词不出声。  ', category: 'bug', key: 'k'.repeat(32),
    contact: 'a@b.com', context: { route: '/reader/x' },
  })
  t('正常提交通过（正文 trim 过）', v.ok && v.value.message === '一本书的第 3 章点词不出声。')
  t('分类照抄白名单内的值', v.value.category === 'bug')
  t('匿名键形态对就留下', v.value.anonKey === 'k'.repeat(32))
  t('联系方式留下', v.value.contact === 'a@b.com')
  const v2 = validateSubmission({ message: '四个字以上就行', category: 'whatever', key: '短', contact: 'z'.repeat(300) })
  t('认不出的分类按 other 收（不报错）', v2.ok && v2.value.category === 'other')
  t('坏匿名键丢掉（不是报错）', v2.value.anonKey === '')
  t('联系方式截到 120 字', v2.value.contact.length === 120)
}

console.log('\n[④ 分发认路]')
{
  t('别的路径回 null（不抢别人的活）', (await handleFeedback(req('/api/sync/pull'), env)) === null)
  t('`/api/feedbackX` 不是我的（裸 startsWith 会误伤）', (await handleFeedback(req('/api/feedbackX'), env)) === null)
  t('`/api/feedbackback` 也不是我的', (await handleFeedback(req('/api/feedbackback'), env)) === null)
  const del = await handleFeedback(req('/api/feedback', { method: 'DELETE' }), env)
  t('/api/feedback 只认 POST／GET（DELETE → 405）', del.status === 405)
  const getMine = await handleFeedback(req('/api/feedback/mine', { method: 'POST', body: {} }), env)
  t('/api/feedback/mine 只认 GET（POST → 405）', getMine.status === 405)
  const abc = await handleFeedback(req('/api/feedback/abc'), env)
  t('`/api/feedback/abc` → 404（id 只认数字）', abc.status === 404)
}

console.log('\n[⑤ 提交（免登录）]')
{
  const r = await call('/api/feedback', {
    method: 'POST', ip: '203.0.113.21', origin: BASE,
    body: {
      message: '第 3 章点词不出声。', category: 'bug', key: 'g'.repeat(32),
      contact: 'guest@example.com', context: { version: 'v9', route: '/reader/bk_a/ch-03', secret: 'x' },
    },
  })
  t('收下 → 201', r.status === 201)
  const j = await r.json()
  t('回执带 signedIn=false（未登录）', j.ok === true && j.signedIn === false)
  const row = one(db, 'SELECT * FROM feedback ORDER BY id DESC LIMIT 1')
  t('落库：正文／分类／匿名键／联系方式都对',
    row.message === '第 3 章点词不出声。' && row.category === 'bug' && row.anon_key === 'g'.repeat(32) && row.contact === 'guest@example.com')
  t('落库：user_id 为 NULL（游客）', row.user_id === null)
  t('落库：status=new、status_at=NULL', row.status === 'new' && row.status_at === null)
  const ctx = JSON.parse(row.context)
  t('落库：UA 来自**请求头**（不信客户端自报）', ctx.ua === UA)
  t('落库：诊断只留白名单字段', ctx.route === '/reader/bk_a/ch-03' && ctx.version === 'v9' && !('secret' in ctx))
  t('落库：created_at 是当下（毫秒）', typeof row.created_at === 'number' && Math.abs(row.created_at - Date.now()) < 60000)
}

console.log('\n[⑤ 提交的两道前置闸]')
{
  const bad = await call('/api/feedback', {
    method: 'POST', ip: '203.0.113.22', origin: 'https://evil.example.com',
    body: { message: '外站借浏览器提交。' },
  })
  t('外站 Origin → 403', bad.status === 403 && (await bad.json()).error === 'bad-origin')
  t('  外站那条没落库', one(db, "SELECT COUNT(*) AS n FROM feedback WHERE message = '外站借浏览器提交。'").n === 0)

  const short = await call('/api/feedback', { method: 'POST', ip: '203.0.113.23', body: { message: '嗯' } })
  t('太短 → 400 message-too-short', short.status === 400 && (await short.json()).error === 'message-too-short')
  const long = await call('/api/feedback', { method: 'POST', ip: '203.0.113.24', body: { message: 'x'.repeat(2001) } })
  t('太长 → 400 message-too-long', long.status === 400 && (await long.json()).error === 'message-too-long')

  const badJson = await handleFeedback(new Request(`${BASE}/api/feedback`, {
    method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.25', 'User-Agent': UA, 'Content-Type': 'application/json' }, body: '{oops',
  }), env)
  t('坏 JSON → 400 invalid-json', badJson.status === 400 && (await badJson.json()).error === 'invalid-json')
}

console.log('\n[⑤ 限额：10 分钟 5 条，第 6 条 429 且不落库]')
{
  const IP6 = '203.0.113.31'
  let last = null
  for (let i = 0; i < 5; i++) {
    last = await call('/api/feedback', { method: 'POST', ip: IP6, body: { message: `第 ${i + 1} 条。` } })
  }
  t('前 5 条都收下', last.status === 201)
  const blocked = await call('/api/feedback', { method: 'POST', ip: IP6, body: { message: '第 6 条。' } })
  t('第 6 条 → 429（scope=burst）', blocked.status === 429 && (await blocked.json()).scope === 'burst')
  t('  带 Retry-After（客户端知道等多久）', Number(blocked.headers.get('Retry-After')) > 0)
  t('  被挡的那条没落库', one(db, "SELECT COUNT(*) AS n FROM feedback WHERE message = '第 6 条。'").n === 0)
  t('  别的 IP 不受牵连（闸是按 IP 的）',
    (await call('/api/feedback', { method: 'POST', ip: '203.0.113.32', body: { message: '别的 IP 提一条。' } })).status === 201)
}

console.log('\n[⑤ 限额：24 小时 20 条（预置「11 分钟前」的计数 ⇒ 单次提交就撞日闸）]')
{
  const ins = db.prepare('INSERT INTO login_attempts (scope, key, ts) VALUES (?, ?, ?)')
  const old = Date.now() - 11 * 60 * 1000
  const IPD = '203.0.113.41'
  for (let i = 0; i < 20; i++) ins.run(FB_SCOPE, IPD, old)
  const r = await call('/api/feedback', { method: 'POST', ip: IPD, body: { message: '日闸应该挡住这条。' } })
  t('→ 429（scope=day）', r.status === 429 && (await r.json()).scope === 'day')
  t('  没落库', one(db, "SELECT COUNT(*) AS n FROM feedback WHERE message = '日闸应该挡住这条。'").n === 0)

  const IPD2 = '203.0.113.42'
  for (let i = 0; i < 19; i++) ins.run(FB_SCOPE, IPD2, old)
  t('  19 条时不挡（边界：到 20 才挡）',
    (await call('/api/feedback', { method: 'POST', ip: IPD2, body: { message: '第 20 条应该放行。' } })).status === 201)
}

console.log('\n[⑥ 我的反馈]')
{
  const KA = 'k1'.padEnd(32, 'a')
  const KB = 'k2'.padEnd(32, 'b')
  await call('/api/feedback', { method: 'POST', ip: '203.0.113.51', body: { message: '游客 A 提的。', key: KA } })
  await call('/api/feedback', { method: 'POST', ip: '203.0.113.52', body: { message: '游客 B 提的。', key: KB } })

  const noAuth = await call('/api/feedback/mine')
  t('未登录又没带键 → 401', noAuth.status === 401 && (await noAuth.json()).error === 'unauthenticated')
  t('键形态不对 → 也是 401（不是「查了个空」）', (await call('/api/feedback/mine?key=short')).status === 401)

  const mineA = await call(`/api/feedback/mine?key=${KA}`)
  const ja = await mineA.json()
  t('带键 → 只回自己那几条', mineA.status === 200 && ja.items.length === 1 && ja.items[0].message === '游客 A 提的。')
  t('  回执不含归属字段（anon_key／user_id／context 都不出去）',
    !('anonKey' in ja.items[0]) && !('userId' in ja.items[0]) && !('context' in ja.items[0]))

  const TOK = 'tok-feedback-user'
  const USER = 'u_feedback'
  const nowMs = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(await tokenHash(TOK), USER, nowMs, nowMs, nowMs + 86400000)

  const r2 = await call('/api/feedback', {
    method: 'POST', ip: '203.0.113.53', cookie: TOK,
    body: { message: '登录后提的。', key: KA },
  })
  t('登录提交：回执 signedIn=true', (await r2.json()).signedIn === true)
  const rowLogin = one(db, "SELECT * FROM feedback WHERE message = '登录后提的。'")
  t('落库：user_id 有值、anon_key 也留（同一台设备的键）', rowLogin.user_id === USER && rowLogin.anon_key === KA)

  const mine2 = await (await call(`/api/feedback/mine?key=${KA}`, { cookie: TOK })).json()
  t('登录后「我的反馈」= 账号那条 ＋ 同匿名键的游客期那条（键不变 ⇒ 历史不丢）',
    mine2.signedIn === true && mine2.items.length === 2)
  const mine3 = await (await call('/api/feedback/mine', { cookie: TOK })).json()
  t('只带会话（不带键）也看得见账号那条', mine3.items.length === 1 && mine3.items[0].message === '登录后提的。')
  const mineB = await (await call(`/api/feedback/mine?key=${KB}`)).json()
  t('别人的键只看到别人的（游客 B 那条不在 A 的键下）', mineB.items.length === 1 && mineB.items[0].message === '游客 B 提的。')
  t('坏会话（cookie 是编的）当未登录处理，但要带键才放行',
    (await call('/api/feedback/mine', { cookie: 'bogus-token' })).status === 401)
}

console.log('\n[⑥ 后台：只读列表 ＋ 改状态]')
{
  t('没有 Authorization → 404（不是 401：不暴露端点存在）', (await call('/api/feedback')).status === 404)
  t('令牌不对 → 也是 404', (await call('/api/feedback', { headers: { Authorization: 'Bearer nope' } })).status === 404)

  const ok = await call('/api/feedback', { headers: { Authorization: `Bearer ${METRICS}` } })
  const j = await ok.json()
  t('对令牌 → 200，按时间倒序（最新一条在最前）',
    ok.status === 200 && j.items.length > 0 && j.items[0].createdAt >= j.items[j.items.length - 1].createdAt)
  t('每条带归属与诊断（userId／anonKey／context 都在）',
    'userId' in j.items[0] && 'anonKey' in j.items[0] && typeof j.items[0].context === 'object')
  t('counts 按状态给出（待办面：几条 new）', typeof j.counts.new === 'number' && j.counts.new > 0)

  const byStatus = await (await call('/api/feedback?status=new', { headers: { Authorization: `Bearer ${METRICS}` } })).json()
  t('?status=new 只回 new，且条数与 counts 对得上',
    byStatus.items.every(i => i.status === 'new') && byStatus.items.length === j.counts.new)
  t('未知 status → 400（白名单外不收）',
    (await call('/api/feedback?status=zzz', { headers: { Authorization: `Bearer ${METRICS}` } })).status === 400)
  const limited = await (await call('/api/feedback?limit=2', { headers: { Authorization: `Bearer ${METRICS}` } })).json()
  t('?limit=2 只回 2 条', limited.items.length === 2)
  const capped = await (await call('/api/feedback?limit=9999', { headers: { Authorization: `Bearer ${METRICS}` } })).json()
  t('?limit 超顶夹住（不是照单全收）', capped.items.length <= LIST_LIMIT_MAX)

  const id = j.items[0].id
  const p1 = await call(`/api/feedback/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${METRICS}` }, body: { status: 'read' } })
  t('PATCH 改状态 → 200', p1.status === 200)
  t('  落库：status=read、status_at 有值（「有人看过」可核）', (() => {
    const r = db.prepare('SELECT status, status_at FROM feedback WHERE id = ?').get(id)
    return r.status === 'read' && typeof r.status_at === 'number'
  })())
  const p2 = await call(`/api/feedback/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${METRICS}` }, body: { status: 'closed' } })
  t('再改一次 → closed（状态可来回改）', p2.status === 200 && (await p2.json()).status === 'closed')
  t('未知状态 → 400（白名单外一律不收）',
    (await call(`/api/feedback/${id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${METRICS}` }, body: { status: 'deleted' } })).status === 400)
  t('  状态没被改坏', db.prepare('SELECT status FROM feedback WHERE id = ?').get(id).status === 'closed')
  t('不存在的 id → 404',
    (await call('/api/feedback/999999', { method: 'PATCH', headers: { Authorization: `Bearer ${METRICS}` }, body: { status: 'read' } })).status === 404)
  t('无令牌 → 404（改状态也要口令）',
    (await call(`/api/feedback/${id}`, { method: 'PATCH', body: { status: 'new' } })).status === 404)
  t('/api/feedback/<id> 只认 PATCH（GET → 405）',
    (await call(`/api/feedback/${id}`, { headers: { Authorization: `Bearer ${METRICS}` } })).status === 405)
}

console.log('\n[形状函数（后台／我的反馈两边都不外泄多余字段）]')
{
  const r1 = shapeRow({ id: 1, created_at: 1000, category: 'bug', message: 'm', status: 'new', status_at: null, user_id: 'u_x', anon_key: 'k', context: '{"ua":"x"}' })
  t('shapeRow 只出 6 个字段（没有 user_id／anon_key／context）',
    eq(Object.keys(r1).sort(), ['category', 'createdAt', 'id', 'message', 'status', 'statusAt'].sort()))
  t('shapeRow：created_at → ISO、空 status_at → null', r1.createdAt === new Date(1000).toISOString() && r1.statusAt === null)
  const r2 = shapeAdminRow({ id: 2, created_at: 1000, user_id: null, anon_key: 'k', category: 'idea', message: 'm', contact: null, context: 'not-json', status: 'read', status_at: 2000 })
  t('shapeAdminRow：坏 context 当空对象（一行坏数据不打崩整页）', eq(r2.context, {}))
  t('shapeAdminRow：null 的 user_id／contact 出 null（不是 undefined）', r2.userId === null && r2.contact === null)
}

console.log('\n[⑥ 后台 limit 的硬顶：把库里堆到 250 条再问 —— 只有真夹了顶才会回 200 条]')
{
  const ins = db.prepare(`INSERT INTO feedback (created_at, user_id, anon_key, category, message, context, status)
      VALUES (?, NULL, NULL, 'other', ?, '{}', 'new')`)
  for (let i = 0; i < 250; i++) ins.run(3000 + i, `批量 ${i}`)
  const total = one(db, 'SELECT COUNT(*) AS n FROM feedback').n
  t('库里现在多于 200 条（不然这条断言测不出夹顶 —— 先钉住前提）', total > LIST_LIMIT_MAX)
  const capped = await (await call('/api/feedback?limit=9999', { headers: { Authorization: `Bearer ${METRICS}` } })).json()
  t('?limit=9999 → 恰好回 200 条（夹顶真生效，不是「碰巧没那么多行」）', capped.items.length === LIST_LIMIT_MAX)
  const def = await (await call('/api/feedback', { headers: { Authorization: `Bearer ${METRICS}` } })).json()
  t('不带 limit → 默认 50 条', def.items.length === LIST_LIMIT_DEFAULT)
}

console.log('\n[⑦ 分发接线：走真的 worker 入口 —— 只在 handleFeedback 里对不够，「有没有接进分发」是另一件事]')
{
  const worker = (await import('./src/index.js')).default
  const KZ = 'z'.repeat(32)
  const quiet = console.log
  let post, mine, pay
  console.log = () => {}   // index.js 的行动日志会打到 stdout，这里静音（与 verify-bookaudio.mjs 同一手法）
  try {
    post = await worker.fetch(new Request(`${BASE}/api/feedback`, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'CF-Connecting-IP': '203.0.113.61', 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({ message: '从真入口进来的那条。', key: KZ }),
    }), env)
    mine = await worker.fetch(new Request(`${BASE}/api/feedback/mine?key=${KZ}`, {
      headers: { 'User-Agent': UA, 'CF-Connecting-IP': '203.0.113.62' },
    }), env)
    pay = mine.ok ? await mine.json() : null   // 404 的 body 不是 JSON：先看状态再解，别让断言把测试崩掉
  } finally { console.log = quiet }

  t('index.js 的 fetch 把 POST /api/feedback 转到反馈端点（201，不是 404 Not found）', post.status === 201)
  t('  真的落库了', one(db, "SELECT COUNT(*) AS n FROM feedback WHERE message = '从真入口进来的那条。'").n === 1)
  t('  同一个匿名键从真入口查「我的反馈」也走通', mine.status === 200 && !!pay && pay.items.length === 1)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)