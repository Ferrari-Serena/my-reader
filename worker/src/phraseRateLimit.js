/**
 * 词组模型调用的独立限流账本。
 *
 * 与 M-W 查词限流分开：词组这里保护的是付费模型调用，不是词典免费额度。
 * 只给「D1 缓存未命中、即将真的调用模型」的请求记账。
 *
 * 失败姿态与 M-W 相反：D1 读写失败时 fail-closed，宁可暂时不可用，
 * 也不要在无法计数时把付费端点放开。
 */

import { WINDOW_MS, utcDayStart } from './ratelimit.js'

const DAY_MS = 86_400_000

export const DEFAULT_PHRASE_PER_MIN = 6
export const DEFAULT_PHRASE_DAILY = 300

function threshold(raw, dflt) {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

function storageDown() {
  return { allowed: false, scope: 'storage' }
}

/**
 * 判定并记账。返回：
 *   { allowed: true }
 *   { allowed: false, scope: 'ip' | 'quota' | 'storage', retryAfter? }
 */
export async function takePhraseToken(env, { ip, now = Date.now() } = {}) {
  if (!env || !env.DB) return storageDown()

  const perMin = threshold(env.PHRASE_RATE_PER_MIN, DEFAULT_PHRASE_PER_MIN)
  const dailyCap = threshold(env.PHRASE_DAILY_LIMIT, DEFAULT_PHRASE_DAILY)
  const dayStart = utcDayStart(now)
  const winStart = now - WINDOW_MS

  let ipN = 0
  let dayN = 0
  try {
    const row = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM phrase_rate_events WHERE ip = ? AND ts > ?) AS ip_n,' +
      ' (SELECT COUNT(*) FROM phrase_rate_events WHERE ts > ?) AS day_n'
    ).bind(ip, winStart, dayStart).first()
    ipN = (row && row.ip_n) || 0
    dayN = (row && row.day_n) || 0
  } catch (e) {
    console.error('phrase rate_limit read failed (fail-closed):', e && e.message)
    return storageDown()
  }

  if (ipN >= perMin) {
    return { allowed: false, scope: 'ip', retryAfter: Math.ceil(WINDOW_MS / 1000) }
  }
  if (dayN >= dailyCap) {
    return { allowed: false, scope: 'quota', retryAfter: Math.ceil((dayStart + DAY_MS - now) / 1000) }
  }

  // 当天第一条顺手清掉旧行；不删仍落在当前滑动窗口里的记录。
  if (dayN === 0) {
    try {
      await env.DB.prepare('DELETE FROM phrase_rate_events WHERE ts < ?')
        .bind(Math.min(dayStart, winStart)).run()
    } catch (e) {
      console.error('phrase rate_limit purge failed:', e && e.message)
    }
  }

  try {
    await env.DB.prepare('INSERT INTO phrase_rate_events (ip, ts) VALUES (?, ?)')
      .bind(ip, now).run()
  } catch (e) {
    console.error('phrase rate_limit insert failed (fail-closed):', e && e.message)
    return storageDown()
  }

  return { allowed: true }
}
