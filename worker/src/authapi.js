/**
 * my-reader 账号端点（第 2 步「开门」· B 块）
 *
 *   POST /api/auth/register        { email, password }  → 201 建号 + 发验证信
 *   POST /api/auth/verify-request  { email }            → 200（一律 200，防枚举）+ 重发验证信
 *   GET  /api/auth/verify?token=…                       → HTML 结果页（一次性令牌）
 *   POST /api/auth/login           { email, password }  → 200 + Set-Cookie（会话）+ csrf
 *   POST /api/auth/logout                               → 200 + 清 cookie（本地数据一律保留）
 *   GET  /api/auth/me                                   → 200 当前账号（顺带续期）+ csrf / 401
 *   POST /api/auth/reset-request   { email }            → 200（一律 200，防枚举）+ 发重置信
 *   GET  /api/auth/reset?token=…                        → HTML 表单页（填新密码）
 *   POST /api/auth/reset-confirm   token + password     → 改密 + 踢掉所有会话
 *   POST /api/auth/delete          { password }         → 注销：落冷静期标记 + 踢掉所有会话
 *   POST /api/auth/restore         { email, password }  → 冷静期内撤销注销（密码确认，重新登录）
 *
 * 设计要点（口径来源：方案 §2.x / §3.1、migrations/0003、auth.js 文件头）
 *   - 密码与令牌的**原语**全在 auth.js（纯逻辑，99 条断言）；本文件只做「取数据 → 调原语 → 落库」
 *   - 会话 30 天滚动 + 180 天绝对上限：判定只调 auth.js 的 sessionState / rollSession，不在这里另写一套
 *   - cookie：httpOnly + Secure + SameSite=Lax + Path=/；同源（站点与 /api/* 同域）→ 不设 Domain
 *   - 防枚举：邮箱不存在也烧一次 dummyVerify 再回同一个 401，快慢不泄信息
 *   - 限流：失败计数落 login_attempts（scope = 'ip' | 'email' | 'register-ip'）；
 *     失败姿态 fail-open（表读/写报错按「没失败过」放行并打日志），与 ratelimit.js 一致
 *   - CSRF 两层都在这：第一层 = Origin 校验（见 originBlocked）；第二层 = **会话派生令牌**
 *     （见 guardCsrf / auth.js 的 csrfToken）。带有效会话的写操作（logout / claim）必须带
 *     `X-CSRF-Token`，值与 /api/auth/me 回的 csrf 一致 —— 挡的是同站子域（Origin 白名单里的自家子域）
 *   - 重置密码：令牌 kind='reset'（1 小时、一次性）；改完踢掉该账号**所有**会话
 *
 * 注销（F 块，2026-10-05）：deleted_at 落软删标记，满 30 天由 purgeDeletedAccounts 真删
 *   （连带清掉主码名下的 sync_data / sync_progress）。清理入口 = index.js 的 scheduled（Cron）。
 *
 * 不在本文件范围：前端页（G 块）。
 */

import { corsFor, isAllowedOrigin } from './cors.js'
import { clientIp } from './ratelimit.js'
import { CODE_LEN, randCode } from './sync.js'
import { sendMail, siteUrl, verifyEmailContent, resetEmailContent } from './send.js'
import {
  SESSION_COOKIE, SESSION_ROLLING_MS, SESSION_ABSOLUTE_MS, VERIFY_TOKEN_MS, RESET_TOKEN_MS,
  normalizeEmail, newToken, tokenHash, sessionState, rollSession,
  sessionCookie, clearSessionCookie, hashPassword, verifyPassword, dummyVerify,
  PURGE_AFTER_MS, deletionState, purgeDueAt, daysLeft,
  checkPasswordPolicy, needsRehash, csrfToken, csrfMatches,
} from './auth.js'

/** 登录失败滑窗与阈值（同一 (scope,key) 桶内计数） */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_MAX_PER_EMAIL = 6
export const LOGIN_MAX_PER_IP = 30

/** 注册滑窗与阈值（按 IP；防「一台机器狂建号」） */
export const REGISTER_WINDOW_MS = 60 * 60 * 1000
export const REGISTER_MAX_PER_IP = 10

/** 失败行的保留时长；只在「该桶恰好清零」这个时机顺手清（与 ratelimit.js 的清法同思路） */
const ATTEMPT_KEEP_MS = 24 * 60 * 60 * 1000

/** CSRF 第二层的请求头名（前端登出等敏感写操作要带） */
export const CSRF_HEADER = 'X-CSRF-Token'

/** 注册时拿不到「刚插进去那行」的报错就按邮箱占用处理 */
const UNIQUE_VIOLATION = 'UNIQUE'

// ── SQL：导出是为了让 verify-authapi.mjs 拿**真**语句在真 SQLite 上跑 ──────────
// （抄一份迟早会和这里漂移，那样的测试没有意义 —— 同 sync.js 的 SQL_ALIVE_UPSERT）

export const SQL_INSERT_USER = `INSERT INTO users
   (id, email, password_hash, created_at, updated_at, email_verified_at, sync_code, deleted_at)
   VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`

/** 登录用：连 password_hash 一起取；**只按归一化邮箱查**（唯一索引就是这个形态） */
export const SQL_USER_BY_EMAIL = `SELECT id, email, password_hash, email_verified_at, deleted_at, sync_code
   FROM users WHERE email = ?`

/** /me 用：不带 password_hash（少一份哈希在内存里游荡） */
export const SQL_USER_BY_ID = `SELECT id, email, email_verified_at, deleted_at, sync_code FROM users WHERE id = ?`

/** 注销二次确认用：这条才带 password_hash（/me 那条刻意不带） */
export const SQL_USER_FULL_BY_ID = `SELECT id, email, password_hash, email_verified_at, deleted_at, sync_code
   FROM users WHERE id = ?`

/** 落注销标记：只在「还没被注销」时可改（并发下第二次 changes = 0） */
export const SQL_MARK_DELETED = `UPDATE users SET deleted_at = ?, updated_at = ?
   WHERE id = ? AND deleted_at IS NULL`

/** 撤销注销：清标记 + 刷 updated_at */
export const SQL_CLEAR_DELETED = `UPDATE users SET deleted_at = NULL, updated_at = ? WHERE id = ?`

/** 到期真删的扫描（只取一批）：冷静期已满的账号 */
export const SQL_USERS_DUE_PURGE = `SELECT id, email, sync_code FROM users
   WHERE deleted_at IS NOT NULL AND deleted_at <= ? ORDER BY deleted_at LIMIT ?`

/** 邮箱验证：已验过就不覆盖原时刻（COALESCE），但 updated_at 照刷 */
export const SQL_MARK_VERIFIED = `UPDATE users
   SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?`

export const SQL_UPDATE_PASSWORD_HASH = `UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`

export const SQL_INSERT_SESSION = `INSERT INTO sessions
   (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)`

export const SQL_SESSION_BY_HASH = `SELECT token_hash, user_id, created_at, last_seen_at, expires_at
   FROM sessions WHERE token_hash = ?`

export const SQL_ROLL_SESSION = `UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`

export const SQL_DELETE_SESSION = `DELETE FROM sessions WHERE token_hash = ?`

/** 登录时顺手清该用户已死的会话：滚动窗口过了，或越过绝对上限 */
export const SQL_PURGE_USER_SESSIONS = `DELETE FROM sessions
   WHERE user_id = ? AND (expires_at <= ? OR created_at <= ?)`

/** 改密后踢光该账号所有会话（凭据变了，旧会话不该继续有效） */
export const SQL_DELETE_USER_SESSIONS = `DELETE FROM sessions WHERE user_id = ?`
export const SQL_DELETE_USER_TOKENS = `DELETE FROM auth_tokens WHERE user_id = ?`

/** 到期真删：连带清掉该账号主码名下的两类同步数据（口径 ②） */
export const SQL_PURGE_SYNC_DATA = `DELETE FROM sync_data WHERE code = ?`
export const SQL_PURGE_SYNC_PROGRESS = `DELETE FROM sync_progress WHERE code = ?`

export const SQL_DELETE_USER = `DELETE FROM users WHERE id = ?`

export const SQL_INSERT_TOKEN = `INSERT INTO auth_tokens
   (token_hash, user_id, kind, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)`

/** 重发 = 作废同类未用令牌（口径写在 0003 注释里：旧的由 B 块按 kind 作废） */
export const SQL_VOID_TOKENS = `DELETE FROM auth_tokens WHERE user_id = ? AND kind = ? AND used_at IS NULL`

export const SQL_TOKEN_BY_HASH = `SELECT token_hash, user_id, kind, created_at, expires_at, used_at
   FROM auth_tokens WHERE token_hash = ?`

/** 一次性：只允许从「未用过」改成「用过」，重复用 changes = 0 */
export const SQL_USE_TOKEN = `UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`

export const SQL_COUNT_ATTEMPTS = `SELECT COUNT(*) AS n FROM login_attempts
   WHERE scope = ? AND key = ? AND ts > ?`

export const SQL_INSERT_ATTEMPT = `INSERT INTO login_attempts (scope, key, ts) VALUES (?, ?, ?)`

/** 登录成功后清掉该邮箱的失败行（DDL 注释里的口径） */
export const SQL_CLEAR_EMAIL_ATTEMPTS = `DELETE FROM login_attempts WHERE scope = 'email' AND key = ?`

export const SQL_PURGE_ATTEMPTS = `DELETE FROM login_attempts WHERE ts < ?`

// ── 小工具 ────────────────────────────────────────────────────────────────────

/** JSON 响应；账号响应一律 no-store（别让任何中间层缓存住凭据或 cookie） */
function json(cors, data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra },
  })
}

function htmlPage(cors, title, body, status = 200) {
  const doc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.8;max-width:560px;margin:12vh auto;padding:0 20px;color:#222">
${body}
</body></html>`
  return new Response(doc, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  })
}

/**
 * 从 Cookie 头里取一个 cookie。
 * 只做最基本的分号切分 —— 我们自己只写一个 cookie，不需要 RFC 全解析器；
 * 值里的 '=' 靠「第一个 = 之前是名字」处理，base64url 令牌不含 '='。
 */
export function readCookie(header, name) {
  if (typeof header !== 'string' || !header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/**
 * CSRF 第一层：写操作要求 Origin 缺席或命中白名单。
 * 浏览器跨站 POST 必带 Origin → 挡掉「evil.com 借用户浏览器打我们」。
 * 挡不住的正是同站子域（白名单本就放行 *.ferrari11.com）—— 那才是 spec 2.5 要 token 的场景。
 * 「Origin 缺席即放行」不会松掉这一层的意义：脚本本来就没有用户的 cookie 可用。
 * 'Origin: null'（沙箱 iframe / file://）也照挡：正常自家页面永远不会发 'null'。
 */
export function originBlocked(request, env) {
  const o = request.headers.get('Origin')
  return !!o && !isAllowedOrigin(o, env)
}

/** 数窗口内的失败条数；读失败 → 0（fail-open） */
export async function attemptCount(env, scope, key, since) {
  try {
    const row = await env.DB.prepare(SQL_COUNT_ATTEMPTS).bind(scope, key, since).first()
    return (row && row.n) || 0
  } catch (e) {
    console.error('login_attempts read failed (fail-open):', e.message)
    return 0
  }
}

/** 记一条失败；purgeOld 时顺手清过老的行。整体 fail-open。 */
export async function noteAttempt(env, scope, key, nowMs, purgeOld = false) {
  try {
    if (purgeOld) await env.DB.prepare(SQL_PURGE_ATTEMPTS).bind(nowMs - ATTEMPT_KEEP_MS).run()
    await env.DB.prepare(SQL_INSERT_ATTEMPT).bind(scope, key, nowMs).run()
  } catch (e) {
    console.error('login_attempts insert failed (fail-open):', e.message)
  }
}

/** 对外可见的用户形态：**不含** password_hash / deleted_at */
function publicUser(row) {
  // syncCode = 账号主码（第 3 步「登录 ↔ 数据」的租户键）。NULL = 还没认领过 ——
  // 前端拿它对账本机的租户键。
  return { id: row.id, email: row.email, emailVerified: !!row.email_verified_at, syncCode: row.sync_code || null }
}

/** 建一个会话行，返回令牌**原文**（只进 cookie；库里只有 sha256） */
async function createSession(env, userId, nowMs) {
  const token = newToken(32)
  await env.DB.prepare(SQL_INSERT_SESSION)
    .bind(await tokenHash(token), userId, nowMs, nowMs, nowMs + SESSION_ROLLING_MS)
    .run()
  return token
}

/**
 * 生成验证令牌并发信。作废旧未用令牌在前 —— 重发后老链接立即失效。
 * 返回 { ok, error }；**发信失败不抛**，由调用方决定怎么告诉用户。
 */
async function issueVerifyToken(env, userId, email, nowMs) {
  await env.DB.prepare(SQL_VOID_TOKENS).bind(userId, 'verify').run()
  const token = newToken(32)
  await env.DB.prepare(SQL_INSERT_TOKEN)
    .bind(await tokenHash(token), userId, 'verify', nowMs, nowMs + VERIFY_TOKEN_MS)
    .run()

  const site = siteUrl(env)
  // 链接指向 Worker 自己（/api/auth/verify），不是前端页 —— 点开即验证，不经前端路由
  const link = `${site}/api/auth/verify?token=${encodeURIComponent(token)}`
  const { subject, text, html } = verifyEmailContent({ link, site, validHours: VERIFY_TOKEN_MS / 3600000 })
  const res = await sendMail(env, { to: email, subject, text, html })
  return res.ok ? { ok: true } : { ok: false, error: res.detail || `resend ${res.status}` }
}

// ── 端点 ──────────────────────────────────────────────────────────────────────

async function handleRegister(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }

  const email = normalizeEmail(body && body.email)
  if (!email) return json(cors, { error: 'invalid-email' }, 400)

  const policy = checkPasswordPolicy(body && body.password)
  if (policy) return json(cors, { error: 'weak-password', reason: policy }, 400)

  const nowMs = Date.now()
  const ip = clientIp(request)

  const ipN = await attemptCount(env, 'register-ip', ip, nowMs - REGISTER_WINDOW_MS)
  if (ipN >= REGISTER_MAX_PER_IP) {
    // 按窗口长度给整值。原写法把窗口起止两端都写成 nowMs（自加自减），结果恒等于 1 秒
    // —— 429 会告诉用户「约 1 分钟」而实际要等 60 分钟，越试越锁。
    const retryAfter = Math.ceil(REGISTER_WINDOW_MS / 1000)
    return json(cors, { error: 'too-many-attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }
  await noteAttempt(env, 'register-ip', ip, nowMs, ipN === 0)

  // 占用检测与插入之间仍有竞态窗口，靠 users.email 的唯一索引兜底（见 catch）
  const existing = await env.DB.prepare(SQL_USER_BY_EMAIL).bind(email).first()
  if (existing) return json(cors, { error: 'email-taken' }, 409)

  const userId = crypto.randomUUID()
  const hash = await hashPassword(String(body.password))
  try {
    await env.DB.prepare(SQL_INSERT_USER).bind(userId, email, hash, nowMs, nowMs).run()
  } catch (e) {
    if (String(e && e.message).includes(UNIQUE_VIOLATION)) return json(cors, { error: 'email-taken' }, 409)
    throw e
  }

  const sent = await issueVerifyToken(env, userId, email, nowMs)
  // 账号已建、信没发出去：如实告诉客户端「信没发成，可以重发」，不假装成功
  return json(cors, { ok: true, email, emailVerified: false, mailSent: sent.ok, ...(sent.ok ? {} : { mailError: sent.error }) }, 201)
}

async function handleVerifyRequest(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }

  const email = normalizeEmail(body && body.email)
  if (!email) return json(cors, { error: 'invalid-email' }, 400)

  const nowMs = Date.now()
  const ip = clientIp(request)
  const ipN = await attemptCount(env, 'verify-ip', ip, nowMs - REGISTER_WINDOW_MS)
  if (ipN >= REGISTER_MAX_PER_IP) {
    // 按窗口长度给整值。原写法把窗口起止两端都写成 nowMs（自加自减），结果恒等于 1 秒
    // —— 429 会告诉用户「约 1 分钟」而实际要等 60 分钟，越试越锁。
    const retryAfter = Math.ceil(REGISTER_WINDOW_MS / 1000)
    return json(cors, { error: 'too-many-attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }
  await noteAttempt(env, 'verify-ip', ip, nowMs, ipN === 0)

  const user = await env.DB.prepare(SQL_USER_BY_EMAIL).bind(email).first()
  // 无论账号在不在、验没验过，一律回同一个 200 —— 否则这个端点就成了「邮箱是否注册」的探测器
  if (user && !user.email_verified_at) {
    const sent = await issueVerifyToken(env, user.id, user.email, nowMs)
    if (!sent.ok) console.error('verify-request send failed:', sent.error)
  }
  return json(cors, { ok: true })
}

async function handleVerify(request, env, cors) {
  const token = new URL(request.url).searchParams.get('token') || ''
  const fail = (title, body) => htmlPage(cors, title, body, 200)

  if (!token) {
    return fail('链接不完整', '<h2>链接不完整</h2><p>这封邮件里的链接似乎被截断了。请回到 my-reader 重新发送一封。</p>')
  }

  const nowMs = Date.now()
  const row = await env.DB.prepare(SQL_TOKEN_BY_HASH).bind(await tokenHash(token)).first()

  // 查不到、类型不对、已用过、已过期：四种情况给四种说法 —— 这里**不怕**枚举，
  // 令牌是 32 字节随机串，猜不中；而且这个页面的受众本来就是点开邮件的本人。
  if (!row || row.kind !== 'verify') {
    return fail('链接无效', '<h2>链接无效</h2><p>这条链接无效或已被替换。请回到 my-reader 重新发送一封。</p>')
  }
  if (row.used_at) {
    return fail('链接已用过', '<h2>链接已经用过了</h2><p>一个链接只能用一次。如果你的邮箱还没验证成功，请重新发送一封。</p>')
  }
  if (nowMs > row.expires_at) {
    return fail('链接已过期', '<h2>链接已过期</h2><p>验证链接 24 小时内有效。请回到 my-reader 重新发送一封。</p>')
  }

  // 标记已用在前：两个标签页同时点开时，只有 changes=1 的那个继续往下走
  const used = await env.DB.prepare(SQL_USE_TOKEN).bind(nowMs, row.token_hash).run()
  if (!((used && used.meta && used.meta.changes) || 0)) {
    return fail('链接已用过', '<h2>链接已经用过了</h2><p>请回到 my-reader 重新发送一封。</p>')
  }
  await env.DB.prepare(SQL_MARK_VERIFIED).bind(nowMs, nowMs, row.user_id).run()
  // 验证成功即作废该账号其余未用的验证链接（重发链路会留下几条，别让它们继续有效）
  try {
    await env.DB.prepare(SQL_VOID_TOKENS).bind(row.user_id, 'verify').run()
  } catch (e) {
    console.error('void verify tokens failed (非致命):', e.message)
  }

  const site = siteUrl(env)
  return htmlPage(cors, '邮箱验证成功',
    `<h2>邮箱验证成功 ✅</h2>
     <p>现在回 my-reader 登录就能用了。</p>
     <p><a href="${site}/">打开 my-reader</a></p>`)
}

async function handleLogin(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }

  const email = normalizeEmail(body && body.email)
  if (!email) return json(cors, { error: 'invalid-email' }, 400)
  const password = typeof (body && body.password) === 'string' ? body.password : ''

  const nowMs = Date.now()
  const ip = clientIp(request)

  const ipN = await attemptCount(env, 'ip', ip, nowMs - LOGIN_WINDOW_MS)
  const mailN = await attemptCount(env, 'email', email, nowMs - LOGIN_WINDOW_MS)
  if (ipN >= LOGIN_MAX_PER_IP || mailN >= LOGIN_MAX_PER_EMAIL) {
    const retryAfter = Math.ceil(LOGIN_WINDOW_MS / 1000)
    return json(cors, { error: 'too-many-attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }

  const user = await env.DB.prepare(SQL_USER_BY_EMAIL).bind(email).first()
  // 密码先照验 —— 冷静期（deleted_at 非空）不在这里直接当「凭据无效」：那会让用户
  // 无法撤销注销。验过之后再分流（F 块 2026-10-05）。
  const ok = user ? await verifyPassword(password, user.password_hash) : false

  if (!ok) {
    // 邮箱不存在也烧掉同等时间：响应快慢不能回答「这个邮箱注册过没有」
    if (!user) await dummyVerify(password)
    const purge = ipN === 0 && mailN === 0
    await noteAttempt(env, 'ip', ip, nowMs, purge)
    await noteAttempt(env, 'email', email, nowMs)
    return json(cors, { error: 'invalid-credentials' }, 401)
  }

  // 凭据对、但账号在冷静期：**不下发会话**，只如实告诉客户端「它在注销中」＋ 到期时刻，
  // 由前端引导去「撤销注销」（POST /restore）。已到期的（逻辑上已不存在）按凭据无效处理。
  if (user.deleted_at) {
    if (deletionState(user.deleted_at, nowMs) !== 'pending') {
      return json(cors, { error: 'invalid-credentials' }, 401)
    }
    try {
      await env.DB.prepare(SQL_CLEAR_EMAIL_ATTEMPTS).bind(email).run()
    } catch (e) {
      console.error('login cleanup failed (非致命):', e.message)
    }
    return json(cors, {
      ok: false, pendingDeletion: true, email: user.email,
      purgeAfter: purgeDueAt(user.deleted_at), daysLeft: daysLeft(user.deleted_at, nowMs),
    }, 200)
  }

  // 成功：清掉该邮箱的失败行（DDL 注释的口径），顺手清死会话
  try {
    await env.DB.prepare(SQL_CLEAR_EMAIL_ATTEMPTS).bind(email).run()
    await env.DB.prepare(SQL_PURGE_USER_SESSIONS).bind(user.id, nowMs, nowMs - SESSION_ABSOLUTE_MS).run()
  } catch (e) {
    console.error('login cleanup failed (非致命):', e.message)
  }

  // 圈数升档：当前口径下永远为假（存的已是顶格 10 万），平台放开上限后才有意义
  if (needsRehash(user.password_hash)) {
    try {
      await env.DB.prepare(SQL_UPDATE_PASSWORD_HASH).bind(await hashPassword(password), nowMs, user.id).run()
    } catch (e) {
      console.error('rehash failed (非致命):', e.message)
    }
  }

  const token = await createSession(env, user.id, nowMs)
  return json(cors, { ok: true, user: publicUser(user), csrf: await csrfToken(token) }, 200, {
    'Set-Cookie': sessionCookie(token, Math.floor(SESSION_ROLLING_MS / 1000)),
  })
}

async function handleLogout(request, env, cors) {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  // CSRF 第二层：只有**真带着有效会话**的登出才要令牌。死 cookie 没什么可被伪造的，
  // 一律放行清掉 —— 别让浏览器里的残留把用户卡在「退不出去」。
  const csrfRes = await guardCsrf(request, env, cors, token)
  if (csrfRes) return csrfRes
  if (token) {
    try {
      await env.DB.prepare(SQL_DELETE_SESSION).bind(await tokenHash(token)).run()
    } catch (e) {
      console.error('logout delete failed (非致命):', e.message)
    }
  }
  // 本地数据一律保留 —— 登出只清服务端会话与本机登录标记，不动书/生词/进度
  return json(cors, { ok: true }, 200, { 'Set-Cookie': clearSessionCookie() })
}

// ── 认领游客同步码（D 块 · 登录 ↔ 数据 链）───────────────────────────────

export const SQL_SET_USER_SYNC_CODE = `UPDATE users SET sync_code = ?, updated_at = ? WHERE id = ?`
export const SQL_USER_BY_SYNC_CODE = `SELECT id FROM users WHERE sync_code = ? LIMIT 1`
export const SQL_SYNC_DATA_RENAME = `UPDATE sync_data SET code = ? WHERE code = ?`
export const SQL_SYNC_PROGRESS_RENAME = `UPDATE sync_progress SET code = ? WHERE code = ?`
export const SQL_CODE_IN_DATA = `SELECT 1 AS ok FROM sync_data WHERE code = ? LIMIT 1`
export const SQL_CODE_IN_PROGRESS = `SELECT 1 AS ok FROM sync_progress WHERE code = ? LIMIT 1`

/** 洗同步码：只留大写字母数字，长度不对就当「没码」（返回空串） */
function normalizeCode(raw) {
  if (typeof raw !== 'string') return ''
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return clean.length === CODE_LEN ? clean : ''
}

/** 这个码在服务端有没有行（两张表都看）—— 用于避开重名/冲突 */
async function codeInUse(env, code) {
  const a = await env.DB.prepare(SQL_CODE_IN_DATA).bind(code).first()
  if (a) return true
  const b = await env.DB.prepare(SQL_CODE_IN_PROGRESS).bind(code).first()
  return !!b
}

/** 铸一个未被占用的新码；连撞 5 次就放弃（概率上不可能） */
async function mintCode(env) {
  for (let i = 0; i < 5; i++) {
    const code = randCode()
    if (!(await codeInUse(env, code))) return code
  }
  return null
}

/**
 * POST /api/auth/claim  body: { code }  —— 把「本机游客码」认领成账号主码。
 *
 * 为什么是「改名」而不是「就地把 users.sync_code 写成本机码」：
 * 已裁「认领后换新码」—— 而旧码正是数据的租户键。所以给账号铸一个**新**主码，
 * 把旧码底下的行**整体改到新码下**（一次事务、不复制）。旧码的哨兵行随之搬走
 * → 旧码从这一刻起就是 404；数据一行不丢、一个字节不摆。
 *
 * 四种进入姿态（更新店里只认领一次）：
 *   - 账号已有主码 + 本机码就是它      → 无事（幂等，reason='already-mine'）
 *   - 账号已有主码 + 本机码另有其人    → **不认领**，回账号主码（换新设备登录走这条）
 *   - 账号未认领 + 本机码在别人名下  → 不吞别人的码，只给账号铸一个空主码
 *   - 账号未认领 + 本机码是自己的      → 真认领（铸新码 ＋ 改名 ＋ 落 sync_code）
 */
async function handleClaim(request, env, cors) {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  // 认领是敏感写操作：与 logout 同一道 CSRF 闸（没会话就不要令牌，下面直接 401）
  const csrfRes = await guardCsrf(request, env, cors, token)
  if (csrfRes) return csrfRes
  if (!token) return json(cors, { error: 'unauthenticated' }, 401)

  let body = null
  try { body = await request.json() } catch { body = null }

  const nowMs = Date.now()
  const row = await env.DB.prepare(SQL_SESSION_BY_HASH).bind(await tokenHash(token)).first()
  if (sessionState(row, nowMs) !== 'ok') return json(cors, { error: 'unauthenticated' }, 401)

  const user = await env.DB.prepare(SQL_USER_BY_ID).bind(row.user_id).first()
  if (!user || user.deleted_at) return json(cors, { error: 'unauthenticated' }, 401)

  const want = normalizeCode(body && body.code)

  // ① 账号已经有主码：认领只发生一次，后面的设备只是「接管」
  if (user.sync_code) {
    return json(cors, {
      ok: true, code: user.sync_code, claimed: false,
      reason: want && want === user.sync_code ? 'already-mine' : 'already-claimed'
    }, 200)
  }

  // ② 账号未认领：只能搬自己的码 —— 不能是别人账号的主码，也要真有行可搬
  let movable = false
  if (want) {
    const owner = await env.DB.prepare(SQL_USER_BY_SYNC_CODE).bind(want).first()
    if (!owner && await codeInUse(env, want)) movable = true
  }

  const code = await mintCode(env)
  if (!code) return json(cors, { error: 'could not allocate code' }, 503)

  try {
    if (movable) {
      // 一个事务：要么整批改名 + 落主码，要么都不做（别留下「数据搬了、主码没落」的半截状态）
      await env.DB.batch([
        env.DB.prepare(SQL_SYNC_DATA_RENAME).bind(code, want),
        env.DB.prepare(SQL_SYNC_PROGRESS_RENAME).bind(code, want),
        env.DB.prepare(SQL_SET_USER_SYNC_CODE).bind(code, nowMs, user.id),
      ])
    } else {
      await env.DB.prepare(SQL_SET_USER_SYNC_CODE).bind(code, nowMs, user.id).run()
    }
  } catch (e) {
    // 并发：另一个请求刚给这个账号落了主码 → 读回来就是了（幂等）
    if (String(e && e.message).includes(UNIQUE_VIOLATION)) {
      const again = await env.DB.prepare(SQL_USER_BY_ID).bind(user.id).first()
      if (again && again.sync_code) {
        return json(cors, { ok: true, code: again.sync_code, claimed: false, reason: 'already-claimed' }, 200)
      }
    }
    throw e
  }

  return json(cors, { ok: true, code, claimed: movable, moved: movable, from: movable ? want : '' }, 200)
}

async function handleMe(request, env, cors) {
  const nowMs = Date.now()
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  if (!token) return json(cors, { error: 'unauthenticated' }, 401)

  const hash = await tokenHash(token)
  const row = await env.DB.prepare(SQL_SESSION_BY_HASH).bind(hash).first()
  const state = sessionState(row, nowMs)
  if (state !== 'ok') {
    // 死会话顺手清掉（坏数据/过期/越绝对上限都清），免得表越滚越大
    if (row) {
      try { await env.DB.prepare(SQL_DELETE_SESSION).bind(hash).run() } catch (e) { console.error('session gc failed:', e.message) }
    }
    return json(cors, { error: 'unauthenticated', reason: state }, 401, { 'Set-Cookie': clearSessionCookie() })
  }

  const rolled = rollSession(row, nowMs)
  const user = await env.DB.prepare(SQL_USER_BY_ID).bind(row.user_id).first()
  if (!user || user.deleted_at) {
    try { await env.DB.prepare(SQL_DELETE_SESSION).bind(hash).run() } catch { /* 尽力而为 */ }
    return json(cors, { error: 'unauthenticated' }, 401, { 'Set-Cookie': clearSessionCookie() })
  }

  try {
    await env.DB.prepare(SQL_ROLL_SESSION).bind(rolled.last_seen_at, rolled.expires_at, hash).run()
  } catch (e) {
    // 续期失败不挡住这次请求：cookie 还是有效的，下次访问再续
    console.error('session roll failed (非致命):', e.message)
  }

  const maxAge = Math.max(0, Math.floor((rolled.expires_at - nowMs) / 1000))
  return json(cors, { ok: true, user: publicUser(user), csrf: await csrfToken(token) }, 200, {
    'Set-Cookie': sessionCookie(token, maxAge),
  })
}

// ── 注销（F 块）：软删标记 + 30 天冷静期，到期由 purgeDeletedAccounts 真删 ──────────

/**
 * POST /api/auth/delete  body: { password }
 * 三道门：有效会话 ＋ CSRF 令牌 ＋ **重输密码**（二次确认）。
 * 只落 deleted_at 标记并踢掉所有会话 —— 数据**不动**（本地数据也不动），满 30 天由定时清理真删。
 */
async function handleDelete(request, env, cors) {
  const token = readCookie(request.headers.get('Cookie'), SESSION_COOKIE)
  const csrfRes = await guardCsrf(request, env, cors, token)
  if (csrfRes) return csrfRes
  if (!token) return json(cors, { error: 'unauthenticated' }, 401)

  let body = null
  try { body = await request.json() } catch { body = null }
  const password = typeof (body && body.password) === 'string' ? body.password : ''
  if (!password) return json(cors, { error: 'password-required' }, 400)

  const nowMs = Date.now()
  const row = await env.DB.prepare(SQL_SESSION_BY_HASH).bind(await tokenHash(token)).first()
  if (sessionState(row, nowMs) !== 'ok') return json(cors, { error: 'unauthenticated' }, 401)

  const user = await env.DB.prepare(SQL_USER_FULL_BY_ID).bind(row.user_id).first()
  if (!user || user.deleted_at) return json(cors, { error: 'unauthenticated' }, 401)

  // 二次确认：密码不对就不动。失败也计数 —— 劫持来的会话不能靠这个端点爆破密码。
  if (!(await verifyPassword(password, user.password_hash))) {
    await noteAttempt(env, 'ip', clientIp(request), nowMs)
    await noteAttempt(env, 'email', user.email, nowMs)
    return json(cors, { error: 'invalid-credentials' }, 401)
  }

  try {
    await env.DB.batch([
      env.DB.prepare(SQL_MARK_DELETED).bind(nowMs, nowMs, user.id),
      env.DB.prepare(SQL_DELETE_USER_SESSIONS).bind(user.id),
    ])
  } catch (e) {
    console.error('delete account failed:', e && e.message)
    return json(cors, { error: 'internal' }, 500)
  }

  return json(cors, {
    ok: true, deletedAt: nowMs,
    purgeAfter: purgeDueAt(nowMs), daysLeft: daysLeft(nowMs, nowMs),
  }, 200, { 'Set-Cookie': clearSessionCookie() })
}

/**
 * POST /api/auth/restore  body: { email, password }
 * 冷静期内撤销注销。与登录同形（密码确认 ＋ 同一套失败限流），成功后直接给会话 ——
 * 注销已把会话都踢了，所以这里只能靠**密码**认人，不能要求会话。
 */
async function handleRestore(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }

  const email = normalizeEmail(body && body.email)
  if (!email) return json(cors, { error: 'invalid-email' }, 400)
  const password = typeof (body && body.password) === 'string' ? body.password : ''

  const nowMs = Date.now()
  const ip = clientIp(request)
  const ipN = await attemptCount(env, 'ip', ip, nowMs - LOGIN_WINDOW_MS)
  const mailN = await attemptCount(env, 'email', email, nowMs - LOGIN_WINDOW_MS)
  if (ipN >= LOGIN_MAX_PER_IP || mailN >= LOGIN_MAX_PER_EMAIL) {
    const retryAfter = Math.ceil(LOGIN_WINDOW_MS / 1000)
    return json(cors, { error: 'too-many-attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }

  const user = await env.DB.prepare(SQL_USER_BY_EMAIL).bind(email).first()
  const ok = user ? await verifyPassword(password, user.password_hash) : false
  if (!ok) {
    if (!user) await dummyVerify(password)
    await noteAttempt(env, 'ip', ip, nowMs, ipN === 0 && mailN === 0)
    await noteAttempt(env, 'email', email, nowMs)
    return json(cors, { error: 'invalid-credentials' }, 401)
  }
  if (!user.deleted_at) return json(cors, { error: 'not-pending' }, 409)
  if (deletionState(user.deleted_at, nowMs) !== 'pending') return json(cors, { error: 'gone' }, 410)

  await env.DB.prepare(SQL_CLEAR_DELETED).bind(nowMs, user.id).run()
  try {
    await env.DB.prepare(SQL_CLEAR_EMAIL_ATTEMPTS).bind(email).run()
  } catch (e) {
    console.error('restore cleanup failed (非致命):', e.message)
  }

  const fresh = await createSession(env, user.id, nowMs)
  return json(cors, {
    ok: true, user: publicUser({ ...user, deleted_at: null }), csrf: await csrfToken(fresh),
  }, 200, { 'Set-Cookie': sessionCookie(fresh, Math.floor(SESSION_ROLLING_MS / 1000)) })
}

/** 到期真删一次最多清多少个账号（Cron 单次预算；剩下的下一轮继续） */
export const PURGE_BATCH_LIMIT = 100

/**
 * 到期真删（Cron 入口，见 index.js 的 scheduled）。对每个冷静期已满的账号：
 *   - 主码名下的 sync_data / sync_progress（口径 ②：**连带清**）
 *   - 该账号的会话 / 邮件令牌 / 邮箱失败计数行
 *   - 最后删 users 行（dict_cache 是全体共享的词典缓存，**不动**）
 * 幂等：删过的下一轮查不到，天然不重复。
 */
export async function purgeDeletedAccounts(env, nowMs = Date.now()) {
  const cutoff = nowMs - PURGE_AFTER_MS
  const res = await env.DB.prepare(SQL_USERS_DUE_PURGE).bind(cutoff, PURGE_BATCH_LIMIT).all()
  const rows = (res && res.results) || []
  let purged = 0
  for (const u of rows) {
    const stmts = []
    if (u.sync_code) {
      stmts.push(env.DB.prepare(SQL_PURGE_SYNC_DATA).bind(u.sync_code))
      stmts.push(env.DB.prepare(SQL_PURGE_SYNC_PROGRESS).bind(u.sync_code))
    }
    stmts.push(env.DB.prepare(SQL_DELETE_USER_SESSIONS).bind(u.id))
    stmts.push(env.DB.prepare(SQL_DELETE_USER_TOKENS).bind(u.id))
    if (u.email) stmts.push(env.DB.prepare(SQL_CLEAR_EMAIL_ATTEMPTS).bind(u.email))
    stmts.push(env.DB.prepare(SQL_DELETE_USER).bind(u.id))
    await env.DB.batch(stmts)
    purged++
  }
  return { purged, scanned: rows.length }
}

// ── 重置密码（B-2 剩余）+ CSRF 第二层（spec 2.5）──────────────────────────────

/**
 * CSRF 第二层闸门。返回 null = 放行；返回 Response = 直接拒。
 *
 * 只在「请求真带着一个**有效**会话」时才要求令牌 —— 没有会话就没有能被伪造的动作
 * （登出空会话仍然一律成功）。**令牌不落库**：它是会话令牌的 sha256 派生值
 * （见 auth.js 的 csrfToken），所以子域脚本既读不到 cookie 也读不到 /me 的响应体。
 */
async function guardCsrf(request, env, cors, sessionToken) {
  if (!sessionToken) return null
  let row = null
  try {
    row = await env.DB.prepare(SQL_SESSION_BY_HASH).bind(await tokenHash(sessionToken)).first()
  } catch (e) {
    // 读失败按「会话已死」处理：宁可少挡一次，也不把登出打停（与限流表的 fail-open 同向）
    console.error('csrf session read failed (fail-open):', e.message)
    return null
  }
  if (sessionState(row, Date.now()) !== 'ok') return null
  const provided = request.headers.get(CSRF_HEADER)
  if (await csrfMatches(sessionToken, provided)) return null
  return json(cors, { error: 'bad-csrf' }, 403)
}

/**
 * 读 application/x-www-form-urlencoded 体（重置页的表单就是这一种）。
 * 不引依赖、不做 RFC 全解析：够用就好，坏编码的键值对直接跳过。
 */
export async function parseFormBody(request) {
  const txt = await request.text()
  const out = {}
  for (const pair of txt.split('&')) {
    if (!pair) continue
    const i = pair.indexOf('=')
    const k = i < 0 ? pair : pair.slice(0, i)
    const v = i < 0 ? '' : pair.slice(i + 1)
    try {
      out[decodeURIComponent(k.replace(/\+/g, ' '))] = decodeURIComponent(v.replace(/\+/g, ' '))
    } catch { /* 坏编码：跳过这一对 */ }
  }
  return out
}

/** 生成重置令牌并发信。作废旧未用重置令牌在前。返回 { ok, error }；发信失败不抛。 */
async function issueResetToken(env, userId, email, nowMs) {
  await env.DB.prepare(SQL_VOID_TOKENS).bind(userId, 'reset').run()
  const token = newToken(32)
  await env.DB.prepare(SQL_INSERT_TOKEN)
    .bind(await tokenHash(token), userId, 'reset', nowMs, nowMs + RESET_TOKEN_MS)
    .run()

  const site = siteUrl(env)
  // 与验证信不同：这里指向一个**带表单的页面**，不是「点开即改密」
  const link = `${site}/api/auth/reset?token=${encodeURIComponent(token)}`
  const { subject, text, html } = resetEmailContent({ link, site, validHours: RESET_TOKEN_MS / 3600000 })
  const res = await sendMail(env, { to: email, subject, text, html })
  return res.ok ? { ok: true } : { ok: false, error: res.detail || `resend ${res.status}` }
}

/** 令牌体检：能用回 null，否则回失败页的 { title, body }（口径与 verify 页一致） */
async function resetTokenVerdict(env, token) {
  const fail = (title, body) => ({ title, body })
  const row = await env.DB.prepare(SQL_TOKEN_BY_HASH).bind(await tokenHash(token)).first()
  if (!row || row.kind !== 'reset') {
    return fail('链接无效', '<h2>链接无效</h2><p>这条链接无效或已被替换。请回到 my-reader 重新申请一次。</p>')
  }
  if (row.used_at) {
    return fail('链接已用过', '<h2>链接已经用过了</h2><p>重置链接只能用一次。请回到 my-reader 重新申请一次。</p>')
  }
  if (Date.now() > row.expires_at) {
    return fail('链接已过期', '<h2>链接已过期</h2><p>重置链接 1 小时内有效。请回到 my-reader 重新申请一次。</p>')
  }
  return null
}

/** 新密码表单。令牌是 base64url，仍按白名单洗一遍再插 HTML（不给自己留注入的口子）。 */
function resetFormHtml(token) {
  const safe = String(token).replace(/[^A-Za-z0-9_-]/g, '')
  const box = 'width:100%;padding:10px;font-size:16px;box-sizing:border-box'
  return `<h2>设置新密码</h2>
  <form method="POST" action="/api/auth/reset-confirm">
    <input type="hidden" name="token" value="${safe}">
    <p><input name="password" type="password" required minlength="8" maxlength="200"
              placeholder="新密码（至少 8 位）" autocomplete="new-password" style="${box}"></p>
    <p><input name="confirm" type="password" required minlength="8" maxlength="200"
              placeholder="再输一遍" autocomplete="new-password" style="${box}"></p>
    <p><button type="submit" style="padding:10px 18px;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-size:16px">改密码</button></p>
  </form>
  <p style="color:#777777">改完密码后，所有设备上的登录都会被清掉，需要用新密码重新登录。</p>`
}

async function handleResetRequest(request, env, cors) {
  let body
  try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }

  const email = normalizeEmail(body && body.email)
  if (!email) return json(cors, { error: 'invalid-email' }, 400)

  const nowMs = Date.now()
  const ip = clientIp(request)
  const ipN = await attemptCount(env, 'reset-ip', ip, nowMs - REGISTER_WINDOW_MS)
  if (ipN >= REGISTER_MAX_PER_IP) {
    // 直接按窗口长度给整值 —— 别用「拿窗口长度自加自减」那类算式，那会算出 1 秒
    const retryAfter = Math.ceil(REGISTER_WINDOW_MS / 1000)
    return json(cors, { error: 'too-many-attempts', retryAfter }, 429, { 'Retry-After': String(retryAfter) })
  }
  await noteAttempt(env, 'reset-ip', ip, nowMs, ipN === 0)

  const user = await env.DB.prepare(SQL_USER_BY_EMAIL).bind(email).first()
  // 一律 200 —— 与 verify-request 同一个理由：这个端点不能变成「邮箱注册过没有」的探测器。
  // 注销冷静期内的账号不发信（那号正在删；F 块再定「冷静期内登录算不算撤销注销」）。
  if (user && !user.deleted_at) {
    const sent = await issueResetToken(env, user.id, user.email, nowMs)
    if (!sent.ok) console.error('reset-request send failed:', sent.error)
  }
  return json(cors, { ok: true })
}

/**
 * 重置页 = **Worker 自带的 HTML 表单**，不依赖前端 SPA。
 * 理由：改密码是低频动作，邮件链接可能在任何浏览器/设备上点开；把表单放在这里
 * 「点开就能填」，不要求那个浏览器已经加载过我们的前端 bundle。
 */
async function handleResetPage(request, env, cors) {
  const token = new URL(request.url).searchParams.get('token') || ''
  if (!token) {
    return htmlPage(cors, '链接不完整',
      '<h2>链接不完整</h2><p>这封邮件里的链接似乎被截断了。请回到 my-reader 重新申请一次。</p>')
  }
  const verdict = await resetTokenVerdict(env, token)
  if (verdict) return htmlPage(cors, verdict.title, verdict.body)
  return htmlPage(cors, '重置密码', resetFormHtml(token))
}

async function handleResetConfirm(request, env, cors) {
  const wantsJson = (request.headers.get('Content-Type') || '').toLowerCase().includes('application/json')

  let token = '', password = '', confirm = null
  if (wantsJson) {
    let body
    try { body = await request.json() } catch { return json(cors, { error: 'invalid-json' }, 400) }
    token = typeof (body && body.token) === 'string' ? body.token : ''
    password = typeof (body && body.password) === 'string' ? body.password : ''
    confirm = body && typeof body.confirm === 'string' ? body.confirm : null
  } else {
    let form = {}
    try { form = await parseFormBody(request) } catch { form = {} }
    token = typeof form.token === 'string' ? form.token : ''
    password = typeof form.password === 'string' ? form.password : ''
    confirm = typeof form.confirm === 'string' ? form.confirm : null
  }

  // 表单出错就**带着令牌重画一次表单**，别让用户为了一个错别字重翻邮件
  const refill = (msg) => htmlPage(cors, '重置密码',
    `<p style="color:#c00">${msg}</p>` + resetFormHtml(token))
  const badToken = (verdict) => wantsJson
    ? json(cors, { error: 'invalid-token' }, 400)
    : htmlPage(cors, verdict.title, verdict.body)

  if (!token) {
    return wantsJson ? json(cors, { error: 'invalid-token' }, 400)
      : htmlPage(cors, '链接不完整', '<h2>链接不完整</h2><p>请回到 my-reader 重新申请一次。</p>')
  }
  if (confirm !== null && confirm !== password) {
    return wantsJson ? json(cors, { error: 'password-mismatch' }, 400) : refill('两次输入的新密码不一致，请重填。')
  }
  const policy = checkPasswordPolicy(password)
  if (policy) {
    return wantsJson ? json(cors, { error: 'weak-password', reason: policy }, 400)
      : refill('新密码至少 8 位，请重填。')
  }

  const verdict = await resetTokenVerdict(env, token)
  if (verdict) return badToken(verdict)

  const nowMs = Date.now()
  // 一次性：先核销再改密 —— 两个标签页同时提交时只有 changes=1 的那个往下走
  const used = await env.DB.prepare(SQL_USE_TOKEN)
    .bind(nowMs, await tokenHash(token)).run()
  if (!((used && used.meta && used.meta.changes) || 0)) {
    return badToken({ title: '链接已用过', body: '<h2>链接已经用过了</h2><p>请回到 my-reader 重新申请一次。</p>' })
  }

  const row = await env.DB.prepare(SQL_TOKEN_BY_HASH).bind(await tokenHash(token)).first()
  await env.DB.prepare(SQL_UPDATE_PASSWORD_HASH)
    .bind(await hashPassword(password), nowMs, row.user_id).run()

  // 改密 = 踢掉该账号所有设备的登录（凭据变了，旧会话不该活着）；其余未用重置链接一并作废
  try {
    await env.DB.prepare(SQL_DELETE_USER_SESSIONS).bind(row.user_id).run()
    await env.DB.prepare(SQL_VOID_TOKENS).bind(row.user_id, 'reset').run()
  } catch (e) {
    console.error('reset cleanup failed (非致命):', e.message)
  }

  if (wantsJson) return json(cors, { ok: true }, 200)
  const site = siteUrl(env)
  return htmlPage(cors, '密码已重置',
    `<h2>密码已重置 ✅</h2>
     <p>所有设备上的登录都已清掉，请用新密码重新登录。</p>
     <p><a href="${site}/">打开 my-reader</a></p>`)
}

/**
 * /api/auth/* 分发。不匹配就回 null，让 index.js 继续往下走（与 handleSync 同形）。
 */
export async function handleAuth(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/auth/')) return null

  const cors = corsFor(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const isWrite = request.method === 'POST'
  if (isWrite && originBlocked(request, env)) return json(cors, { error: 'bad-origin' }, 403)

  try {
    if (isWrite && url.pathname === '/api/auth/register') return await handleRegister(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/verify-request') return await handleVerifyRequest(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/login') return await handleLogin(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/logout') return await handleLogout(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/claim') return await handleClaim(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/delete') return await handleDelete(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/restore') return await handleRestore(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/reset-request') return await handleResetRequest(request, env, cors)
    if (isWrite && url.pathname === '/api/auth/reset-confirm') return await handleResetConfirm(request, env, cors)
    if (request.method === 'GET' && url.pathname === '/api/auth/verify') return await handleVerify(request, env, cors)
    if (request.method === 'GET' && url.pathname === '/api/auth/me') return await handleMe(request, env, cors)
    if (request.method === 'GET' && url.pathname === '/api/auth/reset') return await handleResetPage(request, env, cors)
    return json(cors, { error: 'not-found' }, 404)
  } catch (e) {
    console.error('auth error:', e && e.message, e && e.stack)
    return json(cors, { error: 'internal' }, 500)
  }
}
