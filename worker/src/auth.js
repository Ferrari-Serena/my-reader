/**
 * my-reader · 账号与会话的纯逻辑原语（第 2 步「开门」B / C 块地基）
 *
 * 这里**只放不碰网络、不碰 D1 的东西**，好让 verify-auth.mjs 全离线跑：
 *   - 邮箱归一化（唯一约束与查表都只认归一化后的形态）
 *   - 会话令牌 / 邮件令牌的生成与哈希（**原文只进 cookie 与邮件链接，库里只存哈希**）
 *   - 常量时间比较（防时序侧信道）
 *   - 会话有效期口径（已裁：30 天滚动 ＋ 180 天绝对上限）
 *
 * 密码哈希的落点**已实测定案**（2026-10-04，一次性探针 Worker 实测，见项目日志）：
 *   平台对 PBKDF2 **硬上限 10 万圈**（100 000 过、100 001 起直接报
 *   `iteration counts above 100000 are not supported`），而 **10 万圈在免费版的普通 Worker
 *   里跑得动**（同批对照：纯 JS 空转 50 ms 才撞 `Error 1102`）。
 *   → **放服务器算，不必付费，也不需要 Durable Object**；代价 = 圈数只能到平台上限 10 万
 *     （OWASP 建议 60 万，平台不给）。
 */

/** 会话滚动窗口：每次带 cookie 访问就顺延这么多 */
export const SESSION_ROLLING_MS = 30 * 24 * 60 * 60 * 1000
/** 会话绝对上限：从 created_at 起算，越过就不再续期（要重登一次） */
export const SESSION_ABSOLUTE_MS = 180 * 24 * 60 * 60 * 1000
/** 邮箱验证令牌有效期 */
export const VERIFY_TOKEN_MS = 24 * 60 * 60 * 1000
/** 重置密码令牌有效期 */
export const RESET_TOKEN_MS = 60 * 60 * 1000
/** 会话 cookie 名 */
export const SESSION_COOKIE = 'mr_session'

/**
 * 弱校验：只挡「明显不是邮箱」的串。
 * 真伪不靠正则下结论，靠验证邮件（发得出去、点得开才算数）。
 * 归一化 = trim + 小写；users.email 的唯一约束只认这个形态。
 */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  if (e.length < 3 || e.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

/** 字节 → base64url（无填充）。32 字节令牌 ≈ 43 字符 */
export function bytesToBase64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32 字节密码学随机串 —— 令牌原文，只出现在 cookie 或邮件链接里 */
export function newToken(bytes = 32) {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return bytesToBase64url(b)
}

/** 十六进制小写 */
export function toHex(buf) {
  let s = ''
  for (const x of new Uint8Array(buf)) s += x.toString(16).padStart(2, '0')
  return s
}

/** 库里存的就是这个：sha256(令牌原文) 的十六进制 */
export async function tokenHash(token) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return toHex(d)
}

/** 常量时间比较两个字符串（长度不同直接 false —— 长度本身不是秘密） */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * 会话状态判定 —— C 块的**单一判据**：读侧与写侧都调它，免得两处口径打架。
 *   'ok'       有效
 *   'expired'  滚动窗口过了
 *   'absolute' 越过 created_at + 180 天
 *   'unknown'  记录缺字段（坏数据，按无效处理）
 */
export function sessionState(row, now) {
  if (!row || typeof row.created_at !== 'number' || typeof row.expires_at !== 'number') return 'unknown'
  if (now > row.created_at + SESSION_ABSOLUTE_MS) return 'absolute'
  if (now > row.expires_at) return 'expired'
  return 'ok'
}

/** 续期：给出新的 { last_seen_at, expires_at }；不该续（已过期 / 越过绝对上限 / 坏数据）返回 null */
export function rollSession(row, now) {
  if (sessionState(row, now) !== 'ok') return null
  const cap = row.created_at + SESSION_ABSOLUTE_MS
  return { last_seen_at: now, expires_at: Math.min(now + SESSION_ROLLING_MS, cap) }
}

/** 会话 cookie：httpOnly + Secure + SameSite=Lax；Max-Age 给的是滚动窗口 */
export function sessionCookie(token, maxAgeSec) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
}

/** 登出 / 会话失效：同名 + Max-Age=0 */
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

/**
 * CSRF 第二层（spec 2.5）—— **会话派生**的令牌：不落库、不加 cookie、不加表列。
 *
 * 为什么需要：同源 + SameSite=Lax 挡得住「外站」POST（Origin 校验那一层），
 *   挡不住**同站子域** —— 有人拿 `evil.ferrari11.com` 打我们：同为 ferrari11.com，
 *   浏览器照带 cookie（Lax 只限跨站），Origin 又在我们的白名单里。
 * 为什么派生式就够：令牌 = sha256('mr-csrf:' + 会话令牌)，而会话令牌只活在 httpOnly
 *   cookie 里 —— 子域脚本读不到那个 cookie，也读不到我们 API 的响应体（没开
 *   Allow-Credentials），所以拿不到这个值；它发的请求缺这个头，我们直接拒。
 * 为什么不用「双 cookie 双提交」：同站子域能给父域写同名 cookie（cookie tossing），
 *   而派生式不依赖任何可被第三方覆写的存储。
 */
const CSRF_PREFIX = 'mr-csrf:'

/** 由会话令牌派生 CSRF 令牌（sha256 十六进制，64 字符）。没有会话令牌 -> 空串 */
export async function csrfToken(sessionToken) {
  if (typeof sessionToken !== 'string' || !sessionToken) return ''
  return tokenHash(CSRF_PREFIX + sessionToken)
}

/** 常量时间比对；缺值 / 非字符串 / 空会话令牌一律 false */
export async function csrfMatches(sessionToken, provided) {
  const want = await csrfToken(sessionToken)
  if (!want) return false
  return timingSafeEqual(want, typeof provided === 'string' ? provided.trim() : '')
}
// ─────────────────────────────────────────────────────────────────────────────
// 密码：PBKDF2-HMAC-SHA256（平台硬上限 10 万圈，依据见文件头）
// ─────────────────────────────────────────────────────────────────────────────

/** 平台硬上限：实测 100 000 可用、100 001 直接报错。**不要试图调高** */
export const PBKDF2_MAX_ITERATIONS = 100_000
/** 当前口径：顶格用平台允许的最大值 */
export const PBKDF2_ITERATIONS = 100_000
/** 盐长度（字节）；每个用户一把，落库时与参数同列 */
export const SALT_BYTES = 16
/** 派生密钥长度（bit） */
export const KEY_BITS = 256
/** 存储串的算法标识（PHC 风格单串第一段） */
const PHC_ALGO = 'pbkdf2-sha256'

/** 密码长度政策（字符数；上限只为防超长请求体，与哈希成本无关） */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/

function clampIterations(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x < 1) return PBKDF2_ITERATIONS
  return Math.min(Math.floor(x), PBKDF2_MAX_ITERATIONS)
}

/** base64url → 字节；非法输入回 null（不抛，调用方按「校验失败」处理） */
export function base64urlToBytes(s) {
  if (typeof s !== 'string' || s.length === 0 || !BASE64URL_RE.test(s)) return null
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}

/** 字节版常量时间比较 */
export function timingSafeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * 派生 256 bit。**密码不做 Unicode 归一化**（NFKC 之类会悄悄改掉用户的密码，
 * 且同一串在不同端可能归一化成不同结果）—— 就按原始 UTF-8 字节算。
 */
async function deriveKeyBits(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, KEY_BITS)
  return new Uint8Array(bits)
}

/**
 * 造一行密码记录：`pbkdf2-sha256$<圈数>$<盐b64>$<哈希b64>`
 * 盐与参数都写在串里 → 将来平台放开上限，旧串仍能验证、并在登录时无痛升档（见 needsRehash）。
 */
export async function hashPassword(password, opts = {}) {
  const iterations = clampIterations(opts.iterations === undefined ? PBKDF2_ITERATIONS : opts.iterations)
  const salt = new Uint8Array(opts.saltBytes === undefined ? SALT_BYTES : opts.saltBytes)
  crypto.getRandomValues(salt)
  const hash = await deriveKeyBits(String(password), salt, iterations)
  return [PHC_ALGO, iterations, bytesToBase64url(salt), bytesToBase64url(hash)].join('$')
}

/** 解析存储串；任何一处不对就回 null（坏数据 / 被改过 / 圈数越界一律当「不匹配」） */
export function parsePasswordRecord(stored) {
  if (typeof stored !== 'string') return null
  const parts = stored.split('$')
  if (parts.length !== 4) return null
  const [algo, iterStr, saltB64, hashB64] = parts
  if (algo !== PHC_ALGO) return null
  const iterations = Number(iterStr)
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > PBKDF2_MAX_ITERATIONS) return null
  const salt = base64urlToBytes(saltB64)
  const hash = base64urlToBytes(hashB64)
  if (!salt || salt.length < 8) return null
  if (!hash || hash.length !== KEY_BITS / 8) return null
  return { iterations, salt, hash }
}

/** 校验密码：解析失败 / 长度不符 / 内容不符一律 false（不抛，登录路径好写） */
export async function verifyPassword(password, stored) {
  const rec = parsePasswordRecord(stored)
  if (!rec) return false
  const got = await deriveKeyBits(String(password), rec.salt, rec.iterations)
  return timingSafeEqualBytes(got, rec.hash)
}

/** 需要重新哈希吗（圈数升档用）；解析不了也回 true */
export function needsRehash(stored, target = PBKDF2_ITERATIONS) {
  const rec = parsePasswordRecord(stored)
  if (!rec) return true
  return rec.iterations < clampIterations(target)
}

/**
 * 防枚举用的「假校验」：邮箱没注册时也烧掉同等的时间，
 * 免得攻击者靠响应快慢探出「这个邮箱到底注册过没有」。恒回 false。
 */
const DUMMY_SALT = new Uint8Array(SALT_BYTES)
export async function dummyVerify(password, iterations = PBKDF2_ITERATIONS) {
  const p = password === undefined ? '' : password
  await deriveKeyBits(String(p), DUMMY_SALT, clampIterations(iterations))
  return false
}

/** 注册 / 改密时的长度政策：通过回 null，否则回原因串 */
export function checkPasswordPolicy(password) {
  if (typeof password !== 'string') return 'not-a-string'
  if (password.length < PASSWORD_MIN) return 'too-short'
  if (password.length > PASSWORD_MAX) return 'too-long'
  return null
}