/**
 * 离线补推的指数退避（M3 · 4.5 离线队列）。
 *
 * 推送失败不能就此放弃：网络恢复前可能连续失败很多次。这里给出「下一次等多久」——
 * 5s → 10s → 20s → 40s → 60s 封顶：失败越久等得越久（不空转打服务端），
 * 又永远不超过 1 分钟（网络一恢复最多 1 分钟就补上）。
 *
 * 纯函数、无状态：当前延迟由调用方持有（useSync 的 _retryDelay），便于单测。
 */

export const RETRY_BASE_MS = 5000
export const RETRY_MAX_MS = 60000

/**
 * 上一次等待 → 下一次等待。
 * 首次（prev 缺失/非法）直接回**基准**，不是基准的两倍 —— 第一次失败只等 5s。
 */
export function nextRetryDelay(prev, base = RETRY_BASE_MS, max = RETRY_MAX_MS) {
  if (!(Number.isFinite(prev) && prev > 0)) return base
  return Math.min(prev * 2, max)
}
