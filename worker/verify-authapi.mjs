/**
 * authapi.js 的验证。三层：
 *   ① 纯助手 —— cookie 解析 / Origin 闸 / 限流表的 fail-open
 *   ② 真 SQLite 上跑**真** SQL（users / sessions / auth_tokens / login_attempts）
 *   ③ 端到端：register → login → me → logout、验证信链接、重发、限流、注销 / 撤销 / 到期真删
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
  SQL_USER_FULL_BY_ID, SQL_MARK_DELETED, SQL_CLEAR_DELETED, SQL_USERS_DUE_PURGE,
  SQL_DELETE_USER, SQL_DELETE_USER_TOKENS, SQL_PURGE_SYNC_DATA, SQL_PURGE_SYNC_PROGRESS,
  purgeDeletedAccounts, PURGE_BATCH_LIMIT,
} from './src/authapi.js'
import { tokenHash, SESSION_ABSOLUTE_MS, PURGE_AFTER_MS } from './src/auth.js'
import { handleSync } from './src/sync.js'

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
        async all() { return { results: stmt.all(...args) } },
      }
      return api
    },
    /**
     * D1 的 batch 是一个事务。这里这个适配器只能顺序跑（没实现回滚）——
     * 所以「要么整批成功、要么都不做」这一条**测不到**，只能靠真 D1。
     */
    batch(stmts) {
      return (async () => {
        const out = []
        for (const s of stmts) out.push(await s.run())
        return out
      })()
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

console.log('\n[authapi — SQL：注销标记 / 撤销 / 到期扫描]')
{
  const db = newDb()
  const NOW = Date.now()
  db.prepare(SQL_INSERT_USER).run('u1', 'a@qq.com', 'h', NOW, NOW)
  db.prepare(SQL_INSERT_USER).run('u2', 'b@qq.com', 'h', NOW, NOW)
  t('SQL_USER_FULL_BY_ID 带 password_hash（注销二次确认要用）', db.prepare(SQL_USER_FULL_BY_ID).get('u1').password_hash === 'h')
  t('落注销标记 changes=1', db.prepare(SQL_MARK_DELETED).run(NOW + 1, NOW + 1, 'u1').changes === 1)
  t('重复落标记 changes=0（deleted_at IS NULL 守卫）', db.prepare(SQL_MARK_DELETED).run(NOW + 2, NOW + 2, 'u1').changes === 0)
  t('标记写进 deleted_at', db.prepare(SQL_USER_BY_EMAIL).get('a@qq.com').deleted_at === NOW + 1)
  t('撤销：清标记 changes=1', db.prepare(SQL_CLEAR_DELETED).run(NOW + 3, 'u1').changes === 1)
  t('撤销后 deleted_at 为空', db.prepare(SQL_USER_BY_EMAIL).get('a@qq.com').deleted_at === null)

  db.prepare(SQL_MARK_DELETED).run(NOW - PURGE_AFTER_MS - 10, NOW, 'u1') // 已到期
  db.prepare(SQL_MARK_DELETED).run(NOW - 1000, NOW, 'u2')                // 冷静期中
  const due = db.prepare(SQL_USERS_DUE_PURGE).all(NOW - PURGE_AFTER_MS, PURGE_BATCH_LIMIT)
  t('到期扫描只挑冷静期已满的账号', due.length === 1 && due[0].id === 'u1')
}

// ═══ ③ 端到端 ═══════════════════════════════════════════════════════════════

console.log('\n[authapi — 端到端：注册 / 登录 / 我是谁 / 登出]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const req = (path, { method = 'GET', body, cookie, origin = ORIGIN, csrf } = {}) => new Request(SITE + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf === undefined ? {} : { 'X-CSRF-Token': csrf }),
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
  t('登录响应带 csrf（CSRF 第二层要前端拿得到这张通行证）', /^[0-9a-f]{64}$/.test(String((await bodyOf(await handleAuth(post('/api/auth/login', { email: 'ferrari@qq.com', password: 'correct horse 1' }), env))).csrf)))
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

  // ── CSRF 第二层（spec 2.5）：带有效会话的登出必须带 X-CSRF-Token ──────────────
  const csrf = mj.csrf
  t('me 带回了 csrf（与登录那次同值，派生式所以稳定）', /^[0-9a-f]{64}$/.test(String(csrf)))
  t('登出（不带 CSRF 头）-> 403 bad-csrf，且会话**没被删**', await (async () => {
    const r = await handleAuth(post('/api/auth/logout', {}, { cookie }), env)
    return r.status === 403 && (await bodyOf(r)).error === 'bad-csrf'
      && db.prepare(SQL_SESSION_BY_HASH).get(await tokenHash(token)) != null
  })())
  t('登出（带错 CSRF）-> 403', (await handleAuth(post('/api/auth/logout', {}, { cookie, csrf: 'x'.repeat(64) }), env)).status === 403)
  t('登出（拿别的会话的 CSRF）-> 403（跨会话不通用）', (await handleAuth(post('/api/auth/logout', {}, { cookie, csrf: 'y'.repeat(64) }), env)).status === 403)

  const lo = await handleAuth(post('/api/auth/logout', {}, { cookie, csrf }), env)
  t('登出（带对 CSRF）-> 200 且清 cookie（Max-Age=0）', lo.status === 200 && /Max-Age=0/.test(lo.headers.get('Set-Cookie') || ''))
  t('登出后服务端会话真删了', db.prepare(SQL_SESSION_BY_HASH).get(await tokenHash(token)) == null)
  t('登出后再 me -> 401（会话已失效）', (await handleAuth(req('/api/auth/me', { cookie }), env)).status === 401)
  t('会话已死的 cookie 再登出 -> 200（死 cookie 不该把用户卡住）', (await handleAuth(post('/api/auth/logout', {}, { cookie }), env)).status === 200)
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

console.log('\n[authapi — 端到端：注册 / 重发限流给的等待秒数（回归：曾经恒等于 1 秒）]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const post = (path, body) => new Request(SITE + path, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const NOW = Date.now()

  for (let i = 0; i < 10; i++) await env.DB.prepare(SQL_INSERT_ATTEMPT).bind('register-ip', 'unknown', NOW).run()
  const reg = await handleAuth(post('/api/auth/register', { email: 'x1@qq.com', password: 'correct horse 1' }), env)
  t('注册 IP 桶到线 -> 429', reg.status === 429)
  t('注册 429 的 retryAfter = 3600 秒（不是 1 秒）', (await reg.json()).retryAfter === 3600)
  t('注册 429 的 Retry-After 头 = 3600', reg.headers.get('Retry-After') === '3600')

  for (let i = 0; i < 10; i++) await env.DB.prepare(SQL_INSERT_ATTEMPT).bind('verify-ip', 'unknown', NOW).run()
  const ver = await handleAuth(post('/api/auth/verify-request', { email: 'x2@qq.com' }), env)
  t('重发 IP 桶到线 -> 429', ver.status === 429)
  t('重发 429 的 retryAfter = 3600 秒', (await ver.json()).retryAfter === 3600)
}

console.log('\n[authapi — 端到端：重置密码]')
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
  const form = (body) => new Request(SITE + '/api/auth/reset-confirm', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  await handleAuth(post('/api/auth/register', { email: 'p@qq.com', password: 'old password 1' }), env)
  const uid = db.prepare(SQL_USER_BY_EMAIL).get('p@qq.com').id
  const pendingReset = () => db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND kind = 'reset' AND used_at IS NULL").get(uid).n

  // 防枚举：注册过 / 没注册过 都回同一个 200
  const rExisting = await handleAuth(post('/api/auth/reset-request', { email: 'p@qq.com' }), env)
  const rGhost = await handleAuth(post('/api/auth/reset-request', { email: 'never-seen@qq.com' }), env)
  t('reset-request：注册过 / 没注册过 都是 200 且响应体一样',
    rExisting.status === 200 && rGhost.status === 200 && JSON.stringify(await rExisting.json()) === JSON.stringify(await rGhost.json()))
  t('给存在的账号下了 1 条重置令牌', pendingReset() === 1)
  t('给不存在的邮箱一条都不下', db.prepare("SELECT COUNT(*) AS n FROM auth_tokens WHERE kind='reset'").get().n === 1)

  await handleAuth(post('/api/auth/reset-request', { email: 'p@qq.com' }), env)
  t('重复申请 -> 仍是 1 条（旧链接作废，不叠加）', pendingReset() === 1)
  t('邮箱不合法 -> 400', (await handleAuth(post('/api/auth/reset-request', { email: 'nope' }), env)).status === 400)

  // 令牌原文只在邮件里 —— 测试里直接塞一条已知原文（哈希算法与线上同源）
  const raw = 'Rr7-_'.repeat(9).slice(0, 43)
  const NOW = Date.now()
  await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(raw), uid, 'reset', NOW, NOW + 3600000).run()

  const pageText = await (await handleAuth(req('/api/auth/reset?token=' + raw), env)).text()
  t('重置页 -> HTML 表单（不是「点开即改密」）', /<form/.test(pageText) && /name="password"/.test(pageText))
  t('表单把令牌带回来（提交时不用重翻邮件）', pageText.includes('value="' + raw + '"'))
  t('令牌无效 -> 「链接无效」且不给表单', await (async () => {
    const txt = await (await handleAuth(req('/api/auth/reset?token=made-up'), env)).text()
    return txt.includes('无效') && !/<form/.test(txt)
  })())
  t('没带 token -> 「链接不完整」', (await (await handleAuth(req('/api/auth/reset'), env)).text()).includes('不完整'))

  const rawExp = 'X'.repeat(43)
  await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(rawExp), uid, 'reset', NOW - 100000, NOW - 1).run()
  t('过期令牌 -> 「已过期」', (await (await handleAuth(req('/api/auth/reset?token=' + rawExp), env)).text()).includes('过期'))
  t('验证令牌不能当重置令牌用（kind 隔离）', await (async () => {
    const rawV = 'Vv7-_'.repeat(9).slice(0, 43)
    await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(rawV), uid, 'verify', NOW, NOW + 3600000).run()
    return (await (await handleAuth(req('/api/auth/reset?token=' + rawV), env)).text()).includes('无效')
  })())

  // 表单校验：出错要带令牌重画表单，而且**不能**把令牌烧掉
  const before = pendingReset()
  t('两次输入不一致 -> 提示重填且带表单', await (async () => {
    const txt = await (await handleAuth(form('token=' + raw + '&password=newpassword9&confirm=nope1234567'), env)).text()
    return txt.includes('不一致') && /<form/.test(txt)
  })())
  t('密码太短 -> 提示重填', (await (await handleAuth(form('token=' + raw + '&password=short&confirm=short'), env)).text()).includes('至少 8 位'))
  t('被表单校验挡下时令牌没被烧掉（还能再填一次）', pendingReset() === before)

  // 先登录一台，用来验证「改密会踢掉所有会话」
  const l1 = await handleAuth(post('/api/auth/login', { email: 'p@qq.com', password: 'old password 1' }), env)
  const oldCookie = 'mr_session=' + readCookie(l1.headers.get('Set-Cookie'), 'mr_session')
  t('改密前：旧密码能登', l1.status === 200)

  const okForm = await handleAuth(form('token=' + raw + '&password=new+password+9&confirm=new+password+9'), env)
  t('表单提交成功 -> HTML 成功页', okForm.status === 200 && (await okForm.text()).includes('已重置'))
  t('令牌被烧掉（一次性）', db.prepare(SQL_TOKEN_BY_HASH).get(await tokenHash(raw)).used_at !== null)
  t('同一令牌再提交 -> 「已经用过了」', (await (await handleAuth(form('token=' + raw + '&password=newpassword9&confirm=newpassword9'), env)).text()).includes('已经用过'))
  t('其余未用的重置链接一并作废', pendingReset() === 0)
  t('旧密码 -> 401', (await handleAuth(post('/api/auth/login', { email: 'p@qq.com', password: 'old password 1' }), env)).status === 401)
  t('新密码 -> 200', (await handleAuth(post('/api/auth/login', { email: 'p@qq.com', password: 'new password 9' }), env)).status === 200)
  t('改密踢掉所有设备：老会话的 me -> 401', (await handleAuth(req('/api/auth/me', { cookie: oldCookie }), env)).status === 401)

  // JSON 入口（前端 SPA 走这条）
  const raw2 = 'Jj7-_'.repeat(9).slice(0, 43)
  await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(raw2), uid, 'reset', NOW, NOW + 3600000).run()
  const jRes = await handleAuth(post('/api/auth/reset-confirm', { token: raw2, password: 'json password 9' }), env)
  t('JSON 提交 -> 200 { ok: true }', jRes.status === 200 && (await jRes.json()).ok === true)
  t('JSON 提交后新密码可用', (await handleAuth(post('/api/auth/login', { email: 'p@qq.com', password: 'json password 9' }), env)).status === 200)
  t('JSON 错令牌 -> 400 invalid-token', (await handleAuth(post('/api/auth/reset-confirm', { token: 'nope', password: 'json password 9' }), env)).status === 400)
  t('JSON 弱密码 -> 400 weak-password', await (async () => {
    const raw3 = 'Ww7-_'.repeat(9).slice(0, 43)
    await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(raw3), uid, 'reset', NOW, NOW + 3600000).run()
    const r = await handleAuth(post('/api/auth/reset-confirm', { token: raw3, password: 'short' }), env)
    return r.status === 400 && (await r.json()).error === 'weak-password'
  })())
  t('JSON 两次输入不一致 -> 400 password-mismatch', await (async () => {
    const raw4 = 'Mm7-_'.repeat(9).slice(0, 43)
    await env.DB.prepare(SQL_INSERT_TOKEN).bind(await tokenHash(raw4), uid, 'reset', NOW, NOW + 3600000).run()
    const r = await handleAuth(post('/api/auth/reset-confirm', { token: raw4, password: 'json password 9', confirm: 'other password 9' }), env)
    return r.status === 400 && (await r.json()).error === 'password-mismatch'
  })())
}

console.log('\n[authapi — 端到章：游客码认领（D 块）]')
{
  const db = newDb()
  const env = { DB: d1(db) }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = 'https://my-reader.ferrari11.com'
  const req = (path, { method = 'GET', body, cookie, csrf } = {}) => new Request(SITE + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf === undefined ? {} : { 'X-CSRF-Token': csrf }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const post = (path, body, opts = {}) => req(path, { method: 'POST', body, ...opts })

  const META = '__meta__'
  const NOW = Date.now()
  const seedData = (code, word, ts) => db.prepare(
    'INSERT INTO sync_data (code, word, payload, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)'
  ).run(code, word, JSON.stringify({ snapshot: { word } }), ts)
  const seedMeta = (code, ts) => db.prepare(
    'INSERT INTO sync_data (code, word, payload, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)'
  ).run(code, META, JSON.stringify({ created: new Date().toISOString() }), ts)
  const seedProgress = (code, key, ts) => db.prepare(
    'INSERT INTO sync_progress (code, key, payload, updated_at) VALUES (?, ?, ?, ?)'
  ).run(code, key, JSON.stringify({ pct: 42 }), ts)
  const codeOf = (email) => db.prepare('SELECT sync_code FROM users WHERE email = ?').get(email).sync_code
  const uidOf = (email) => db.prepare('SELECT id FROM users WHERE email = ?').get(email).id
  const rowsUnder = (code) => db.prepare('SELECT COUNT(*) AS n FROM sync_data WHERE code = ?').get(code).n
  const progsUnder = (code) => db.prepare('SELECT COUNT(*) AS n FROM sync_progress WHERE code = ?').get(code).n

  async function signupAndLogin(email) {
    await handleAuth(post('/api/auth/register', { email, password: 'correct horse 1' }), env)
    const r = await handleAuth(post('/api/auth/login', { email, password: 'correct horse 1' }), env)
    const j = await r.json()
    return { cookie: 'mr_session=' + readCookie(r.headers.get('Set-Cookie'), 'mr_session'), csrf: j.csrf, login: j }
  }
  const claim = (s, code) => handleAuth(post('/api/auth/claim', { code }, { cookie: s.cookie, csrf: s.csrf }), env)

  // ① 门禁
  const A = await signupAndLogin('claim-a@qq.com')
  t('无 cookie 的 claim -> 401', (await handleAuth(post('/api/auth/claim', { code: 'AAAABBBB' }), env)).status === 401)
  const noCsrf = await handleAuth(post('/api/auth/claim', { code: 'AAAABBBB' }, { cookie: A.cookie }), env)
  t('带会话但不带 CSRF 头 -> 403 bad-csrf', noCsrf.status === 403 && (await noCsrf.json()).error === 'bad-csrf')
  t('登录响应就带 syncCode（未认领时为 null）', A.login.user.syncCode === null)

  // ② 真认领：本机码底下有数据
  const G1 = 'AAAA2222'
  seedMeta(G1, NOW)
  seedData(G1, 'alpha', NOW)
  seedProgress(G1, 'the-giver/ch-01', NOW)
  t('认领前：旧码底下 2 行', rowsUnder(G1) === 2 && progsUnder(G1) === 1)

  const c1 = await claim(A, G1)
  const b1 = await c1.json()
  t('认领 -> 200 ＋ claimed=true ＋ 回一个 8 位新主码',
    c1.status === 200 && b1.ok === true && b1.claimed === true && typeof b1.code === 'string' && b1.code.length === 8 && b1.code !== G1)
  t('账号主码落库（users.sync_code）', codeOf('claim-a@qq.com') === b1.code)
  t('旧码一行不剩 -> 它从此就是 404', rowsUnder(G1) === 0 && progsUnder(G1) === 0)
  t('数据原样在新码下（META ＋ alpha）', rowsUnder(b1.code) === 2)
  t('进度也跟着搬了', progsUnder(b1.code) === 1)
  // pull 属于 /api/sync/*，走 handleSync（handleAuth 只接 /api/auth/*，不匹配就回 null）
  // D16：租户由会话反推 —— 未登录 401；URL 里出现 code 一律 400（旧码新码一视同仁）
  t('无会话 pull -> 401（D16：必须登录才能同步）',
    (await handleSync(req('/api/sync/pull'), env)).status === 401)
  t('URL 带码（旧码 / 新码都一样）-> 400',
    (await handleSync(req('/api/sync/pull?code=' + G1, { cookie: A.cookie }), env)).status === 400
    && (await handleSync(req('/api/sync/pull?code=' + b1.code, { cookie: A.cookie }), env)).status === 400)
  t('未登录 + 带码 -> 401（闸先问「你是谁」，再看 URL 契约）',
    (await handleSync(req('/api/sync/pull?code=' + G1), env)).status === 401)
  t('带会话 pull -> 200（且能读到搬过去的词）', await (async () => {
    const r = await handleSync(req('/api/sync/pull', { cookie: A.cookie }), env)
    if (r.status !== 200) return false
    const j = await r.json()
    return 'alpha' in (j.words || {})
  })())
  const me1 = await handleAuth(req('/api/auth/me', { cookie: A.cookie }), env)
  t('/me 也带上了主码', (await me1.json()).user.syncCode === b1.code)

  // ③ 幂等：认领只发生一次
  const c2 = await claim(A, b1.code)
  const b2 = await c2.json()
  t('拿同一个码再认领 -> claimed=false ＋ already-mine ＋ 主码不变',
    c2.status === 200 && b2.claimed === false && b2.reason === 'already-mine' && b2.code === b1.code)
  const c3 = await claim(A, 'ZZZZZZZZ')
  const b3 = await c3.json()
  t('拿别的码再认领 -> 不换主码（already-claimed）', b3.claimed === false && b3.reason === 'already-claimed' && b3.code === b1.code)

  // ④ 不吞别人的码：本机码正是另一个账号的主码
  const C = await signupAndLogin('claim-c@qq.com')
  const c4 = await claim(C, b1.code)
  const b4 = await c4.json()
  t('摸到别人的主码 -> 不认领（claimed=false）', c4.status === 200 && b4.claimed === false)
  t('不吞：A 的主码仍在 A 名下', db.prepare('SELECT id FROM users WHERE sync_code = ?').get(b1.code).id === uidOf('claim-a@qq.com'))
  t('不吞：A 的数据一行未动', rowsUnder(b1.code) === 2)
  t('且 C 也拿到了自己的主码（与 A 不同）', typeof b4.code === 'string' && b4.code.length === 8 && b4.code !== b1.code && codeOf('claim-c@qq.com') === b4.code)

  // ⑤ 本机没码 / 码在服务端查不到 / 码形状不对 -> 都只是「铸一个空主码」，不报错
  const D = await signupAndLogin('claim-d@qq.com')
  const b5 = await (await claim(D, '')).json()
  t('本机没码（空串）-> 铸为空主码、claimed=false', b5.claimed === false && typeof b5.code === 'string' && b5.code.length === 8)
  const E = await signupAndLogin('claim-e@qq.com')
  const b6 = await (await claim(E, 'QWER9999')).json()
  t('码在服务端查不到 -> 同样铸新码、claimed=false', b6.claimed === false && b6.code !== 'QWER9999')
  const F = await signupAndLogin('claim-f@qq.com')
  const ff = await claim(F, 'AB')
  t('码形状不对（长度）-> 不报 400，当作没码处理', ff.status === 200 && (await ff.json()).claimed === false)

  // ⑥ 一账号一主码：各账号主码两两不同
  const codes = ['claim-a@qq.com', 'claim-c@qq.com', 'claim-d@qq.com', 'claim-e@qq.com', 'claim-f@qq.com'].map(codeOf)
  t('五个账号五个不同主码（唯一索引真在管事）', new Set(codes).size === 5 && codes.every(c => typeof c === 'string' && c.length === 8))
}

console.log('\n[authapi — 端到章：注销 / 冷静期撤销 / 到期真删（F 块）]')
{
  const db = newDb()
  // 块 E：注销真删也要清账号空间的音频（`user/<code>/`）—— 最小 R2 替身，只需 list/delete
  const audioStore = new Map()
  const env = { DB: d1(db), AUDIO: {
    async list({ prefix = '' } = {}) {
      const all = [...audioStore.keys()].filter((k) => k.startsWith(prefix)).sort()
      return { objects: all.map((k) => ({ key: k, size: 1 })), truncated: false }
    },
    async delete(keys) { for (const k of (Array.isArray(keys) ? keys : [keys])) audioStore.delete(k) },
  } }
  const ORIGIN = 'https://my-reader.ferrari11.com'
  const SITE = ORIGIN
  const req = (path, { method = 'GET', body, cookie, origin = ORIGIN, csrf } = {}) => new Request(SITE + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf === undefined ? {} : { 'X-CSRF-Token': csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const post = (path, body, opts = {}) => req(path, { method: 'POST', body, ...opts })
  const bodyOf = async (r) => { try { return await r.json() } catch { return {} } }
  const PW = 'correct horse 1'
  const userOf = (e) => db.prepare(SQL_USER_BY_EMAIL).get(e)
  const sessionCount = (uid) => db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(uid).n

  // 建号 + 登录 + 认领主码 + 灌同步数据（供「到期连带清」验证）
  await handleAuth(post('/api/auth/register', { email: 'del@qq.com', password: PW }), env)
  const uid = userOf('del@qq.com').id
  const login = await handleAuth(post('/api/auth/login', { email: 'del@qq.com', password: PW }), env)
  const cookie = 'mr_session=' + readCookie(login.headers.get('Set-Cookie') || '', 'mr_session')
  const csrf = (await bodyOf(login)).csrf
  const claimRes = await handleAuth(post('/api/auth/claim', { code: '' }, { cookie, csrf }), env)
  const mainCode = (await bodyOf(claimRes)).code
  db.prepare('INSERT INTO sync_data (code, word, payload, updated_at, deleted_at) VALUES (?, ?, ?, ?, NULL)').run(mainCode, 'w1', '{}', String(Date.now()))
  db.prepare('INSERT INTO sync_progress (code, key, payload, updated_at) VALUES (?, ?, ?, ?)').run(mainCode, 'reading:x', '{}', String(Date.now()))
  t('前置就位：账号 / 主码 / 两类同步数据', !!uid && typeof mainCode === 'string' && mainCode.length === 8)

  // 门禁
  t('注销：无会话 -> 401', (await handleAuth(post('/api/auth/delete', { password: PW }), env)).status === 401)
  t('注销：有会话无 CSRF -> 403 且没落标记', await (async () => {
    const r = await handleAuth(post('/api/auth/delete', { password: PW }, { cookie }), env)
    return r.status === 403 && (await bodyOf(r)).error === 'bad-csrf' && userOf('del@qq.com').deleted_at === null
  })())
  t('注销：空密码 -> 400 password-required', (await handleAuth(post('/api/auth/delete', {}, { cookie, csrf }), env)).status === 400)
  t('注销：密码不对 -> 401 且没落标记', await (async () => {
    const r = await handleAuth(post('/api/auth/delete', { password: 'wrong wrong' }, { cookie, csrf }), env)
    return r.status === 401 && userOf('del@qq.com').deleted_at === null
  })())

  // 真注销
  const del = await handleAuth(post('/api/auth/delete', { password: PW }, { cookie, csrf }), env)
  const dj = await bodyOf(del)
  t('注销（密码对）-> 200 ＋ 落 deleted_at', del.status === 200 && typeof dj.deletedAt === 'number' && userOf('del@qq.com').deleted_at === dj.deletedAt)
  t('注销 -> 清 cookie（Max-Age=0）', /Max-Age=0/.test(del.headers.get('Set-Cookie') || ''))
  t('注销 -> 该账号会话全踢', sessionCount(uid) === 0)
  t('注销 -> 数据还没动（冷静期内不删）', db.prepare('SELECT COUNT(*) AS n FROM sync_data WHERE code = ?').get(mainCode).n === 1)
  t('注销后旧 cookie 的 me -> 401', (await handleAuth(req('/api/auth/me', { cookie }), env)).status === 401)

  // 冷静期内登录：不下发会话，只报告待注销
  const pl = await handleAuth(post('/api/auth/login', { email: 'del@qq.com', password: PW }), env)
  const plj = await bodyOf(pl)
  t('冷静期内登录 -> 200 pendingDeletion 且**无**会话 cookie', pl.status === 200 && plj.pendingDeletion === true && !/Max-Age=2592000/.test(pl.headers.get('Set-Cookie') || ''))
  t('冷静期内登录 -> 带到期时刻与剩余天数', typeof plj.purgeAfter === 'number' && plj.daysLeft === 30)
  t('冷静期内登录：错的密码照样 401', (await handleAuth(post('/api/auth/login', { email: 'del@qq.com', password: 'nope nope' }), env)).status === 401)

  // 撤销注销
  t('撤销：密码不对 -> 401', (await handleAuth(post('/api/auth/restore', { email: 'del@qq.com', password: 'nope nope' }), env)).status === 401)
  const rs = await handleAuth(post('/api/auth/restore', { email: 'del@qq.com', password: PW }), env)
  const rsj = await bodyOf(rs)
  t('撤销（密码对）-> 200 ＋ 直接给会话', rs.status === 200 && rsj.user && rsj.user.id === uid && /Max-Age=2592000/.test(rs.headers.get('Set-Cookie') || ''))
  t('撤销后 deleted_at 清空', userOf('del@qq.com').deleted_at === null)
  const rcookie = 'mr_session=' + readCookie(rs.headers.get('Set-Cookie') || '', 'mr_session')
  t('撤销后新会话能用（me -> 200）', (await handleAuth(req('/api/auth/me', { cookie: rcookie }), env)).status === 200)
  t('未在注销中时撤销 -> 409 not-pending', (await handleAuth(post('/api/auth/restore', { email: 'del@qq.com', password: PW }), env)).status === 409)

  // 到期真删
  const T = Date.now()
  await handleAuth(post('/api/auth/delete', { password: PW }, { cookie: rcookie, csrf: rsj.csrf }), env)
  db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?').run(T - PURGE_AFTER_MS - 1, uid) // 拨到已到期
  t('已到期：restore -> 410 gone', (await handleAuth(post('/api/auth/restore', { email: 'del@qq.com', password: PW }), env)).status === 410)
  // 该主码名下的 BYO 音频（两件）＋ 另一个账号的一件（**不许**被连带清掉）
  const bidE = 'bk_0011223344556677'
  audioStore.set(`user/${mainCode}/${bidE}/ch-01.mp3`, 1)
  audioStore.set(`user/${mainCode}/${bidE}/audio-index.json`, 1)
  audioStore.set(`books/${mainCode}/${bidE}.json`, 1)          // D22：注销真删也要清 BYO 正文
  audioStore.set('user/OTHER789/deadbeef/ch-01.mp3', 1)
  audioStore.set('books/OTHER789/deadbeef.json', 1)            // 别的账号的正文，不许动
  const purge = await purgeDeletedAccounts(env, T)
  t('到期真删：清掉 1 个账号', purge.purged === 1)
  t('到期真删：users 行没了', userOf('del@qq.com') == null)
  t('到期真删：连带清掉主码名下 sync_data', db.prepare('SELECT COUNT(*) AS n FROM sync_data WHERE code = ?').get(mainCode).n === 0)
  t('到期真删：连带清掉 sync_progress', db.prepare('SELECT COUNT(*) AS n FROM sync_progress WHERE code = ?').get(mainCode).n === 0)
  t('块 E：到期真删连带清掉账号空间的音频（user/<code>/ 下 2 件都清）',
    [...audioStore.keys()].filter((k) => k.startsWith(`user/${mainCode}/`)).length === 0)
  t('块 E：**别的账号**的音频不许动', audioStore.has('user/OTHER789/deadbeef/ch-01.mp3'))
  t('D22：到期真删连带清掉账号空间的 BYO 正文（books/<code>/ 下清空）',
    [...audioStore.keys()].filter((k) => k.startsWith(`books/${mainCode}/`)).length === 0)
  t('D22：**别的账号**的 BYO 正文不许动', audioStore.has('books/OTHER789/deadbeef.json'))

  // 未到期的账号不受影响
  await handleAuth(post('/api/auth/register', { email: 'keep@qq.com', password: PW }), env)
  const kuid = userOf('keep@qq.com').id
  db.prepare(SQL_MARK_DELETED).run(T - 1000, T, kuid) // 刚注销 1 秒
  const purge2 = await purgeDeletedAccounts(env, T)
  t('未到期的账号不动（purged=0、行还在）', purge2.purged === 0 && userOf('keep@qq.com') != null)
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
  // D16 起 /api/sync 不再认 URL 里的码，用「/create 已退役 → 410」当路标最干净
  const r3 = await worker.fetch(at('/api/sync/create', { method: 'POST' }), env)
  t('老路由没被抢：/api/sync/* 仍走 sync.js（/create 退役 -> 410）',
    r3.status === 410 && (await r3.json()).error === 'gone')
  const r3b = await worker.fetch(at('/api/sync/pull'), env)
  t('无会话 pull 由 sync.js 自己回 401（JSON，不是兜底 HTML）',
    r3b.status === 401 && /json/.test(r3b.headers.get('Content-Type') || ''))
  const r4 = await worker.fetch(at('/api/auth/me', { method: 'PUT' }), env)
  t('非 GET/POST 的写方法 -> 404（不是「只要不是 GET 就当写」）', r4.status === 404)
  const r5 = await worker.fetch(at('/api/auth/logout', {
    method: 'OPTIONS', headers: { Origin: 'https://evil.com' },
  }), env)
  t('OPTIONS 预检仍由 index.js 统一接（204）', r5.status === 204)
  t('index.js 导出 scheduled（Cron 入口在）', typeof worker.scheduled === 'function')
}
console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
