/**
 * 限流 + M-W 日配额（0.0 止血 · 第二半）
 *
 * 背景：CORS 只挡浏览器跨站读取，挡不住 curl / 后端直连。M-W 免费 key 是
 * 1000 次/天，一条脚本几分钟就能刷爆，把整个产品的查词打停。
 * 这里在 Worker 里加两道闸，都只对「真的会去调 M-W」的请求计数
 * （D1 缓存命中不计数、也不烧额度）：
 *
 *   1. 每 IP 滑动窗口（默认 60 次 / 60 秒）—— 挡单机刷词
 *   2. 全局日配额（默认 900 次 / UTC 日）—— 兜底，保证永久不超 M-W 免费额度
 *
 * 计数落在 D1 表 rate_limit_events（见 schema.sql 与 migrations/0002_rate_limit.sql）。
 * 为什么用「逐条日志 + COUNT」而不是计数器 UPSERT：只依赖最基础的 SQL，
 * 不碰 RETURNING / UPSERT 返回值；量小（一天最多几百行），成本可忽略。
 *
 * 已知边界：
 *   - Worker 是无状态多实例，计数落 D1 所以全局一致，但「先查后插」之间有极小
 *     的竞态窗口（高并发下可能多放几条过去）。对「保护免费额度」这个目标足够；
 *     要严格串行得用 Durable Object。
 *   - 失败姿态是 fail-open：D1 读/写报错时放行并打日志，宁可少挡也不把正常
 *     查词打停（D1 挂了本来也查不到缓存，功能已经降级）。
 */

const DAY_MS = 86_400_000

/** 滑动窗口长度（ms），固定值 */
export const WINDOW_MS = 60_000

/** 默认阈值；可用 env.RATE_LIMIT_PER_MIN / env.MW_DAILY_LIMIT 覆盖（字符串或数字都行） */
export const DEFAULT_PER_MIN = 60
export const DEFAULT_MW_DAILY = 900

/**
 * 取客户端 IP。CF 边缘会注入 CF-Connecting-IP，客户端伪造不了；
 * 取不到（本地 wrangler dev 等）就归到 'unknown' 单桶，宁可一起限也不放过。
 */
export function clientIp(request) {
  const h = request && request.headers
  const v = h && typeof h.get === 'function' ? h.get('CF-Connecting-IP') : ''
  return (v && String(v).trim()) || 'unknown'
}

/** 某时刻所在 UTC 日的 0 点（ms）—— 日配额按 UTC 日重置 */
export function utcDayStart(now) {
  return Math.floor(now / DAY_MS) * DAY_MS
}

/**
 * 纯函数：数出 stamps 里落在窗口内的条数。
 * 边界取「严格大于 cutoff」：恰好 windowMs 之前的那条不算，窗口不会永远卡住。
 */
export function countInWindow(stamps, now, windowMs = WINDOW_MS) {
  const cutoff = now - windowMs
  let n = 0
  for (const ts of stamps) if (ts > cutoff) n++
  return n
}

/** 读阈值：env 覆盖 -> 兜底默认；非法/非正数一律回默认 */
function threshold(raw, dflt) {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

/**
 * 判定并记账（只给「即将去调 M-W」的请求调用）。
 * 返回：
 *   { allowed: true }                       放行（已记一条）
 *   { allowed: false, scope, retryAfter }   拦截；scope = 'ip' 或 'quota'，retryAfter 为秒
 */
export async function takeToken(env, { ip, now = Date.now() } = {}) {
  const perMin = threshold(env.RATE_LIMIT_PER_MIN, DEFAULT_PER_MIN)
  const dailyCap = threshold(env.MW_DAILY_LIMIT, DEFAULT_MW_DAILY)
  const dayStart = utcDayStart(now)
  const winStart = now - WINDOW_MS

  let ipN = 0
  let dayN = 0
  try {
    const row = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM rate_limit_events WHERE ip = ? AND ts > ?) AS ip_n,' +
      ' (SELECT COUNT(*) FROM rate_limit_events WHERE ts > ?) AS day_n'
    ).bind(ip, winStart, dayStart).first()
    ipN = (row && row.ip_n) || 0
    dayN = (row && row.day_n) || 0
  } catch (e) {
    console.error('rate_limit read failed (fail-open):', e.message)
    return { allowed: true }
  }

  if (ipN >= perMin) {
    return { allowed: false, scope: 'ip', retryAfter: Math.ceil(WINDOW_MS / 1000) }
  }
  if (dayN >= dailyCap) {
    const retryAfter = Math.ceil((dayStart + DAY_MS - now) / 1000)
    return { allowed: false, scope: 'quota', retryAfter }
  }

  // dayN === 0 说明这是本 UTC 日的第一条 -> 顺手清掉上一日及更早的行。
  // 取 min(dayStart, winStart) 作阈值，保证不删仍在滑动窗口内的行。
  if (dayN === 0) {
    try {
      await env.DB.prepare('DELETE FROM rate_limit_events WHERE ts < ?')
        .bind(Math.min(dayStart, winStart)).run()
    } catch (e) {
      console.error('rate_limit purge failed:', e.message)
    }
  }

  try {
    await env.DB.prepare('INSERT INTO rate_limit_events (ip, ts) VALUES (?, ?)')
      .bind(ip, now).run()
  } catch (e) {
    console.error('rate_limit insert failed (fail-open):', e.message)
  }
  return { allowed: true }
}