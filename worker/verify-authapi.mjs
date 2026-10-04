/**
 * authapi.js 的验证。三层：
 *   ① 纯助手 —— cookie 解析 / Origin 闸 / 限流表的 fail-open
 *   ② 真 SQLite 上跑**真** SQL（users / sessions / auth_tokens / login_attempts）
 *   ③ 端到端：register → login → me → logout、验证信链接、重发、限流
 * 用法: node verify-authapi.mjs
 *
 * 为什么必须端到端：这块是「联网 + 落库」的活，只测纯函数测不出「cookie 没下发」
 * 「changes 判错导致会话看着建了其实没建」这类错。这里用一个 node:sqlite 适配器冒充 D1，
 * 端点逻辑一行不改地被真跑一遍。全程**不触网**：env 不带 RESEND_API_KEY，
 * sendMail 会在发请求前就返回失败，所以「mailSent=false」正是这里的预期值。
 */

import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  handleAuth, readCookie, originBlocked, attemptCount, noteAttempt,
  SQL_INSERT_USER, SQL_USER_BY_EMAIL, SQL_USER_BY_ID, SQL_MARK_VERIFIED,
  SQL_INSERT_SESSION, SQL_SESSION_BY_HASH, SQL_ROLL_SESSION, SQL_PURGE_USER_SESSIONS,
  SQL_INSERT_TOKEN, SQL_VOID_TOKENS, SQL_TOKEN_BY_HASH, SQL_USE_TOKEN,
  SQL_COUNT_ATTEMPTS, SQL_INSERT_ATTEMPT, SQL_CLEAR_EMAIL_ATTEMPTS, SQL_PURGE_ATTEMPTS,
} from './src/authapi.js'
import { tokenHash, SESSION_ABSOLUTE_MS } from './src/auth.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}`) }
}

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

/** 新建一个空库（跑 schema.sql，即线上「新建库」那条路） */
function newDb() {
  const d = new DatabaseSync(':memory:')
  d.exec(SCHEMA)
  return d
}

/**
 * 把 node:sqlite 包成 D1 的形状：prepare → bind → run / first。
 * D1 与本适配器都返回 { meta: { changes } } —— 端点里正是靠它判定「这一行真的被我改到了」
 * （典型的是一次性令牌：第二次核销必须 changes=0）。包错这层，测试就白测了。
 */
function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql)
      let args = []
      const api = {
        bind(...a) { args = a; return api },
        async run() { const r = stmt.run(...args); return { success: true, meta: { changes: r.changes } } },
        async first() { const row = stmt.get(...args); return row === undefined ? null : row },
      }
      return api
    },
  }
}

// ═══ ① 纯助手 ═════════════════════════════════════════════════════════════════

console.log('\n[authapi — readCookie]')
t('单个 cookie 取值', readCookie('mr_session=abc123', 'mr_session') === 'abc123')
t('多个 cookie 里挑对的（含无值属性）', readCookie('a=1; mr_session=TOK; HttpOnly', 'mr_session') === 'TOK')
t('值里带 = 时只切第一个（原样保留）', readCookie('mr_session=a=b=c', 'mr_session') === 'a=b=c')
t('名字前后有空格也能认', readCookie(' mr_session = TOK ', 'mr_session') === 'TOK')
t('没有这个名字 -> null', readCookie('a=1; b=2', 'mr_session') === null)
t('空 / 非字符串 -> null', readCookie('', 'x') === null && readCookie(null, 'x') === null && readCookie(undefined, 'x') === null)
t('没有 = 的碎片被跳过（不崩）', readCookie('flag; mr_session=TOK', 'mr_session') === 'TOK')

console.log('\n[authapi — originBlocked（CSRF 第一层）]')
{
  const r = (origin) => ({ headers: { get: (k) => (k.toLowerCase() === 'origin' ? (origin ?? null) : null) } })
  t('自家 Origin -> 放行', originBlocked(r('https://my-reader.ferrari11.com'), {}) === false)
  t('子域 Origin -> 放行（白名单口径，同站子域要靠 token 挡）', originBlocked(r('https://evil.ferrari11.com'), {}) === false)
  t('外站 Origin -> 挡', originBlocked(r('https://evil.com'), {}) === true)
  t('Origin: null（沙箱 iframe / file://）-> 挡', originBlocked(r('null'), {}) === true)
  t('Origin 缺席 -> 放行（脚本本来就没有用户 cookie 可用）', originBlocked(r(undefined), {}) === false)
}

console.log('\n[authapi — 限流表 fail-open]')
{
  const boom = { DB: { prepare() { throw new Error('boom') } } }
  t('读失败 -> 当作 0 条（放行）且不抛', (await attemptCount(boom, 'email', 'a@b.com', 0)) === 0)
  let threw = false
  try { await noteAttempt(boom, 'email', 'a@b.com', Date.now()) } catch { threw = true }
  t('写失败 -> 不抛（只打日志）', threw === false)
}

// ═══ ② 真 SQL ════════════════════════════════════════════════════════════════

console.log('\n[authapi — SQL：users]')
{
  const db = newDb()
  const NOW = Date.now()
  db.prepare(SQL_INSERT_USER).run('u1', 'a@b.com', 'pbkdf2-sha256$100000$x$y', NOW, NOW)
  t('插入后能按归一化邮箱取回 password_hash', db.prepare(SQL_USER_BY_EMAIL).get('a@b.com').password_hash === 'pbkdf2-sha256$100000$x$y')
  t('新建账号：未验证 / 无主码 / 未注销', (() => {
    const u = db.prepare(SQL_USER_BY_ID).get('u1')
    return u.email_verified_at === null && db.prepare(SQL_USER_BY_EMAIL).get('a@b.com').deleted_at === null
  })())

  let dup = false
  try { db.prepare(SQL_INSERT_USER).run('u2', 'a@b.com', 'z', NOW, NOW) } catch (e) { dup = /UNIQUE/.test(String(e.message)) }
  t('同一邮箱再插 -> 唯一索引拦下（并发注册靠它兜）', dup)
  t('大写邮箱查不到（所以入库前必须归一化）', db.prepare(SQL_USER_BY_EMAIL).get('A@B.com') == null)

  db.prepare(SQL_MARK_VERIFIED).run(NOW, NOW, 'u1')
  db.prepare(SQL_MARK_VERIFIED).run(NOW + 5000, NOW + 5000, 'u1')
  t('重复验证不覆盖首次时刻（COALESCE）', db.prepare(SQL_USER_BY_ID).get('u1').email_verified_at === NOW)
}

console.log('\n[authapi — SQL：sessions]')
{
  const db = newDb()
  const NOW = Date.now()
  db.prepare(SQL_INSERT_SESSION).run('h1', 'u1', NOW, NOW, NOW + 86400000)
  const row = db.prepare(SQL_SESSION_BY_HASH).get('h1')
  t('会话行字段齐全', row && row.user_id === 'u1' && row.token_hash === 'h1')
  t('时间列是数字毫秒（auth.js 的 sessionState 要求 number）',
    typeof row.created_at === 'number' && typeof row.expires_at === 'number')

  db.prepare(SQL_ROLL_SESSION).run(NOW + 10, NOW + 2000, 'h1')
  t('续期写入生效', db.prepare(SQL_SESSION_BY_HASH).get('h1').expires_at === NOW + 2000)

  db.prepare(SQL_INSERT_SESSION).run('h2', 'u1', NOW, NOW, NOW - 1)          // 滚动窗口已过
  db.prepare(SQL_INSERT_SESSION).run('h3', 'u1', NOW - SESSION_ABSOLUTE_MS - 1, NOW, NOW + 86400000) // 越绝对上限
  t('清理：过期行与越上限行都清、有效行留下', db.prepare(SQL_PURGE_USER_SESSIONS).run('u1', NOW, NOW - SESSION_ABSOLUTE_MS).changes === 2)
  t('清完只剩 h1', db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get('u1').n === 1)
}

console.log('\n[authapi — SQL：auth_tokens]')
{
  const db = newDb()
  const NOW = Date.now()
  db.prepare(SQL_INSERT_TOKEN).run('t1', 'u1', 'verify', NOW, NOW + 3600000)
  t('新令牌 used_at 为 null', db.prepare(SQL_TOKEN_BY_HASH).get('t1').used_at === null)
  t('第一次核销 changes=1', db.prepare(SQL_USE_TOKEN).run(NOW, 't1').changes === 1)
  t('第二次核销 changes=0（一次性，重复点不生效）', db.prepare(SQL_USE_TOKEN).run(NOW + 1, 't1').changes === 0)
  t('核销时刻被记下', db.prepare(SQL_TOKEN_BY_HASH).get('t1').used_at === NOW)

  db.prepare(SQL_INSERT_TOKEN).run('t2', 'u1', 'verify', NOW, NOW + 3600000)
  db.prepare(SQL_INSERT_TOKEN).run('t3', 'u1', 'reset', NOW, NOW + 3600000)
  t('作废只删「同类 + 未用」的（已用的 t1 与另一类的 t3 都不动）', db.prepare(SQL_VOID_TOKENS).run('u1', 'verify').changes === 1)
  t('作废后 verify 类未用的没了', db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id='u1' AND kind='verify' AND used_at IS NULL").get().n === 0)
}

console.log('\n[authapi — SQL：login_attempts]')
{
  const db = newDb()
  const NOW = Date.now()
  for (let i = 0; i < 3; i++) db.prepare(SQL_INSERT_ATTEMPT).run('email', 'a@b.com', NOW)
  db.prepare(SQL_INSERT_ATTEMPT).run('email', 'a@b.com', NOW - 999999)
  db.prepare(SQL_INSERT_ATTEMPT).run('ip', '1.2.3.4', NOW)
  t('COUNT 只数窗口内的（滑窗外的老行不算）', db.prepare(SQL_COUNT_ATTEMPTS).get('email', 'a@b.com', NOW - 1000).n === 3)
  t('按 (scope,key) 分桶：ip 桶不受影响', db.prepare(SQL_COUNT_ATTEMPTS).get('ip', 'a@b.com', NOW - 1000).n === 0)
  t('清过期行（按 ts 清，不分桶）', db.prepare(SQL_PURGE_ATTEMPTS).run(NOW - 99999).changes === 1)
  t('成功后清该邮箱失败行（窗口内那 3 条）', db.prepare(SQL_CLEAR_EMAIL_ATTEMPTS).run('a@b.com').changes === 3)
}

// ═══ ③ 端到端 ═══════════════════════════════════════════════════════════════

console.log('\n[authapi — 端到端：注册 / 登录 / 我是谁 / 登出]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const req = (path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) => new Request(SITE + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const post = (path, body, opts = {}) => req(path, { method: 'POST', body, ...opts })
  const bodyOf = async (r) => { try { return await r.json() } catch { return {} } }

  const r1 = await handleAuth(post('/api/auth/register', { email: '  Ferrari@QQ.com ', password: 'correct horse 1' }), env)
  const j1 = await bodyOf(r1)
  t('注册 -> 201', r1.status === 201)
  t('邮箱归一化（trim + 小写）后落库', j1.email === 'ferrari@qq.com')
  t('未配 RESEND_API_KEY -> mailSent=false（信没发出去就如实说）', j1.mailSent === false)
  t('库里不是明文：password_hash 是 PHC 单串', /^pbkdf2-sha256\$100000\$/.test(db.prepare(SQL_USER_BY_EMAIL).get('ferrari@qq.com').password_hash))
  const userId = db.prepare(SQL_USER_BY_EMAIL).get('ferrari@qq.com').id

  t('同邮箱再注册 -> 409 email-taken', (await handleAuth(post('/api/auth/register', { email: 'ferrari@qq.com', password: 'correct horse 1' }), env)).status === 409)
  t('密码太短 -> 400 weak-password(too-short)', await (async () => {
    const r = await handleAuth(post('/api/auth/register', { email: 'c@d.com', password: '1234567' }), env)
    const j = await bodyOf(r); return r.status === 400 && j.reason === 'too-short'
  })())
  t('邮箱不合法 -> 400 invalid-email', (await handleAuth(post('/api/auth/register', { email: 'nope', password: 'correct horse 1' }), env)).status === 400)
  t('外站 Origin 的写请求 -> 403 bad-origin（注册没发生）', await (async () => {
    const r = await handleAuth(post('/api/auth/register', { email: 'evil@qq.com', password: 'correct horse 1' }, { origin: 'https://evil.com' }), env)
    return r.status === 403 && db.prepare(SQL_USER_BY_EMAIL).get('evil@qq.com') == null
  })())
  t('坏 JSON -> 400（不崩）', (await handleAuth(new Request(SITE + '/api/auth/login', { method: 'POST', headers: { Origin: ORIGIN }, body: '{not json' }), env)).status === 400)

  t('错密码 -> 401 invalid-credentials', (await handleAuth(post('/api/auth/login', { email: 'ferrari@qq.com', password: 'wrong 123' }), env)).status === 401)
  t('失败在该邮箱桶里记了一条', db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE scope='email' AND key='ferrari@qq.com'").get().n === 1)
  t('不存在的邮箱 -> 同一个 401（防枚举：先烧一次 dummyVerify）', await (async () => {
    const r = await handleAuth(post('/api/auth/login', { email: 'nobody@qq.com', password: 'wrong 123' }), env)
    return r.status === 401 && (await bodyOf(r)).error === 'invalid-credentials'
  })())

  const okRes = await handleAuth(post('/api/auth/login', { email: 'ferrari@qq.com', password: 'correct horse 1' }), env)
  const setCookie = okRes.headers.get('Set-Cookie') || ''
  t('登录成功 -> 200', okRes.status === 200 && (await bodyOf(okRes)).user.id === userId)
  t('cookie 属性：httpOnly + Secure + SameSite=Lax + Path=/ + Max-Age', /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Lax/.test(setCookie) && /Path=\//.test(setCookie) && /Max-Age=2592000/.test(setCookie))
  t('cookie 不带 Domain（同源，host-only 更紧）', !/Domain=/i.test(setCookie))
  t('成功登录清掉该邮箱的失败行', db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE scope='email' AND key='ferrari@qq.com'").get().n === 0)

  const token = readCookie(setCookie, 'mr_session')
  const cookie = 'mr_session=' + token
  t('库里的会话键是 sha256(令牌)，不是令牌原文', db.prepare(SQL_SESSION_BY_HASH).get(token) == null && db.prepare(SQL_SESSION_BY_HASH).get(await tokenHash(token)) != null)

  const me1 = await handleAuth(req('/api/auth/me', { cookie }), env)
  const mj = await bodyOf(me1)
  t('me（带 cookie）-> 200 且回的是本人', me1.status === 200 && mj.user.id === userId && mj.user.email === 'ferrari@qq.com')
  t('me 不回 password_hash / deleted_at（只出头像那点信息）', !('password_hash' in mj.user) && !('deleted_at' in mj.user))
  t('me 顺手续期：回了新 cookie', /Max-Age=/.test(me1.headers.get('Set-Cookie') || ''))
  t('me 不缓存（no-store）', /no-store/.test(me1.headers.get('Cache-Control') || ''))
  t('me（无 cookie）-> 401', (await handleAuth(req('/api/auth/me'), env)).status === 401)
  t('me（乱编的令牌）-> 401', (await handleAuth(req('/api/auth/me', { cookie: 'mr_session=made-up' }), env)).status === 401)

  const lo = await handleAuth(post('/api/auth/logout', {}, { cookie }), env)
  t('登出 -> 200 且清 cookie（Max-Age=0）', lo.status === 200 && /Max-Age=0/.test(lo.headers.get('Set-Cookie') || ''))
  t('登出后服务端会话真删了', db.prepare(SQL_SESSION_BY_HASH).get(await tokenHash(token)) == null)
  t('登出后再 me -> 401（会话已失效）', (await handleAuth(req('/api/auth/me', { cookie }), env)).status === 401)
}

console.log('\n[authapi — 端到端：验证信链接]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const req = (path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) => new Request(SITE + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const post = (path, body, opts = {}) => req(path, { method: 'POST', body, ...opts })

  await handleAuth(post('/api/auth/register', { email: 'v@qq.com', password: 'correct horse 1' }), env)
  const userId = db.prepare(SQL_USER_BY_EMAIL).get('v@qq.com').id
  const pending = () => db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND kind = 'verify' AND used_at IS NULL").get(userId).n
  t('注册时下发了 1 条待用验证令牌', pending() === 1)

  // 令牌原文只在邮件里，测试里直接塞一条已知原文的行（哈希算法与线上同源）
  const raw = 'Kk3-_'.repeat(9).slice(0, 43)
  const NOW = Date.now()
  await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(raw), userId, 'verify', NOW, NOW + 3600000).run()

  const v1 = await handleAuth(req('/api/auth/verify?token=' + raw), env)
  t('点链接 -> 200 HTML 成功页', v1.status === 200 && (await v1.text()).includes('验证成功'))
  t('email_verified_at 落地', typeof db.prepare(SQL_USER_BY_ID).get(userId).email_verified_at === 'number')
  t('验证成功即作废该账号其余未用的验证链接', pending() === 0)
  t('同一链接再点 -> 「已经用过了」（一次性）', (await (await handleAuth(req('/api/auth/verify?token=' + raw), env)).text()).includes('用过了'))
  t('乱猜的令牌 -> 「链接无效」', (await (await handleAuth(req('/api/auth/verify?token=made-up-token'), env)).text()).includes('无效'))
  t('没带 token -> 「链接不完整」', (await (await handleAuth(req('/api/auth/verify'), env)).text()).includes('不完整'))

  const rawExp = 'M'.repeat(43)
  await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(rawExp), userId, 'verify', NOW - 100000, NOW - 1).run()
  t('过期令牌 -> 「已过期」', (await (await handleAuth(req('/api/auth/verify?token=' + rawExp), env)).text()).includes('过期'))

  t('验证后登录 -> user.emailVerified=true', await (async () => {
    const r = await handleAuth(post('/api/auth/login', { email: 'v@qq.com', password: 'correct horse 1' }), env)
    return (await r.json()).user.emailVerified === true
  })())

  // 防枚举：注册过 / 没注册过 都回同一个 200
  const tokensBefore = db.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?').get(userId).n
  const sent = await handleAuth(post('/api/auth/verify-request', { email: 'v@qq.com' }), env)
  const ghost = await handleAuth(post('/api/auth/verify-request', { email: 'never-seen@qq.com' }), env)
  t('重发：注册过 / 没注册过 都是 200 且响应体一样', sent.status === 200 && ghost.status === 200 && JSON.stringify(await sent.json()) === JSON.stringify(await ghost.json()))
  t('已验过的账号重发：一条新令牌都不加（不给人添乱）', db.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?').get(userId).n === tokensBefore)

  // 未验证账号重发：旧链接作废、只留新的那条
  await handleAuth(post('/api/auth/register', { email: 'fresh@qq.com', password: 'correct horse 1' }), env)
  const fid = db.prepare(SQL_USER_BY_EMAIL).get('fresh@qq.com').id
  const fp = () => db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND kind = 'verify' AND used_at IS NULL").get(fid).n
  t('未验证账号：注册后 1 条待用', fp() === 1)
  await handleAuth(post('/api/auth/verify-request', { email: 'fresh@qq.com' }), env)
  t('重发后仍是 1 条（旧链接已作废，不是叠加）', fp() === 1)
}

console.log('\n[authapi — 端到端：登录限流]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const post = (path, body) => new Request(SITE + path, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })

  await handleAuth(post('/api/auth/register', { email: 'r@qq.com', password: 'correct horse 1' }), env)
  const NOW = Date.now()
  for (let i = 0; i < 6; i++) await env.DB.prepare(SQL_INSERT_ATTEMPT).bind('email', 'r@qq.com', NOW).run()

  const locked = await handleAuth(post('/api/auth/login', { email: 'r@qq.com', password: 'correct horse 1' }), env)
  t('同邮箱失败 6 次后，连正确密码也 429（锁窗）', locked.status === 429)
  t('429 带 Retry-After', /^\d+$/.test(locked.headers.get('Retry-After') || ''))

  const other = await handleAuth(post('/api/auth/login', { email: 'unrelated@qq.com', password: 'correct horse 1' }), env)
  t('换一个邮箱不受该桶影响（IP 桶还没到线）-> 401', other.status === 401)

  // IP 桶到线：把 ip 桶灌满
  for (let i = 0; i < 30; i++) await env.DB.prepare(SQL_INSERT_ATTEMPT).bind('ip', 'unknown', NOW).run()
  const ipLocked = await handleAuth(post('/api/auth/login', { email: 'brand-new@qq.com', password: 'correct horse 1' }), env)
  t('IP 桶到线 -> 连没见过的邮箱也 429', ipLocked.status === 429)
}

console.log('\n[authapi — 接线：index.js 真的会把它接上]')
{
  const worker = (await import('./src/index.js')).default
  const db = newDb()
  const env = { DB: d1(db) }
  const at = (path, init) => new Request('https://my-reader.ferrari11.com' + path, init)

  const r1 = await worker.fetch(at('/api/auth/me'), env)
  t('无 cookie 的 /api/auth/me -> 401（说明真分到了 auth）', r1.status === 401)
  const r2 = await worker.fetch(at('/api/auth/nope'), env)
  t('未知 auth 路径 -> 404 JSON（没掉进兜底 HTML）', r2.status === 404 && /json/.test(r2.headers.get('Content-Type') || ''))
  const r3 = await worker.fetch(at('/api/sync/pull?code=ZZZZZZZZ'), env)
  t('老路由没被抢：/api/sync/* 仍走 sync.js', r3.headers.get('Content-Type') !== null && r3.status !== 401)
  const r4 = await worker.fetch(at('/api/auth/me', { method: 'PUT' }), env)
  t('非 GET/POST 的写方法 -> 404（不是「只要不是 GET 就当写」）', r4.status === 404)
  const r5 = await worker.fetch(at('/api/auth/logout', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.com' },
  }), env)
  t('OPTIONS 预检仍由 index.js 统一接（204）', r5.status === 204)
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
