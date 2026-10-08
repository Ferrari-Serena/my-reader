/**
 * 最小监控（第 4 步 4.8）
 *
 * 目标：M1 上线后就要能回答三件事 ——
 *   谁在用 / 用了多少 / 有没有人刷词典 API。
 * 做法分两半，都不动 schema：
 *   1) 结构化请求日志：一条请求 = 一行 JSON，`console.*` 进 CF Workers Logs，
 *      供 Tail / Dashboard 按路由与状态码过滤、做 5xx 告警（见 wrangler.toml 的 [observability]）。
 *   2) 只读计数：复用现成表（rate_limit_events / dict_cache / sync_data / users）算 COUNT，
 *      由 index.js 的 GET /api/metrics 暴露（需 METRICS_TOKEN，未配置则 404）。
 *
 * 本文件全是纯函数，便于 verify-worker.mjs 直接单测；读写 D1 的部分留在 index.js。
 */

import { utcDayStart } from './ratelimit.js'

/**
 * 已知路由前缀 → 路由名。顺序敏感：长的、具体的写前面。
 * 归类只管 /api 与 /health，其余一律 'other'（静态资源等由 Pages 处理，不该走到这里）。
 */
const ROUTE_RULES = [
  ['/api/sync', 'sync'],
  ['/api/gen', 'gen'],
  ['/api/auth', 'auth'],
  ['/api/dict', 'dict'],
  ['/api/audio', 'audio'],
  ['/api/metrics', 'metrics'],
  ['/health', 'health'],
]

/** 把 URL 路径归类成路由名（纯函数）。传 null/非字符串安全回 'other'。 */
export function routeOf(pathname) {
  const p = typeof pathname === 'string' ? pathname : ''
  for (const [prefix, name] of ROUTE_RULES) {
    if (p === prefix || p.startsWith(prefix + '/')) return name
  }
  return 'other'
}

/**
 * 组装一行结构化请求日志（纯函数）。
 * 字段取首字母、固定顺序，方便在 CF 里按 `$.s >= 500` 之类过滤：
 *   t=类型 m=方法 p=路径(不含查询串) r=路由 s=状态码 ms=耗时 ip=来源
 * **只记 pathname，绝不带 query** —— /api/sync/pull 的 code、auth 的 token 都在 query/cookie 里，
 * 日志会长期留存，写进去等于泄露凭据。所以这里再保险一次：即便误传了带 query 的串也当场切掉。
 */
export function buildLogLine(rec) {
  const o = rec || {}
  return JSON.stringify({
    t: 'req',
    m: String(o.method || 'GET').toUpperCase(),
    p: String(o.path || '').split('?')[0].slice(0, 200),
    r: o.route || routeOf(o.path),
    s: Number(o.status) || 0,
    ms: Number(o.ms) || 0,
    ip: String(o.ip || 'unknown'),
  })
}

/**
 * 只读计数 SQL（纯函数，返回 {name, sql, binds}[]）。
 * 全部走 COUNT，永远不 SELECT 业务行 —— 监控端点不能变成数据导出。
 * 日切按 UTC（与限流日配额同口径，见 ratelimit.js 的 utcDayStart）。
 */
export function metricsQueries(now) {
  return [
    // 当日真去调 M-W 的次数（0.0 限流就是按这张表计数的）→ 「用了多少 / 有没有人刷」
    { name: 'dictLookupsToday', sql: 'SELECT COUNT(*) AS n FROM rate_limit_events WHERE ts > ?', binds: [utcDayStart(now)] },
    // 词典缓存规模（缓存命中不烧 M-W 额度）
    { name: 'dictCached', sql: 'SELECT COUNT(*) AS n FROM dict_cache', binds: [] },
    // 同步：活跃码数 / 存活行 / 墓碑行（谁在用 + 用了多少）
    { name: 'syncCodes', sql: 'SELECT COUNT(DISTINCT code) AS n FROM sync_data', binds: [] },
    { name: 'syncLiveRows', sql: 'SELECT COUNT(*) AS n FROM sync_data WHERE deleted_at IS NULL', binds: [] },
    { name: 'syncTombstones', sql: 'SELECT COUNT(*) AS n FROM sync_data WHERE deleted_at IS NOT NULL', binds: [] },
    // 有效账号数（注销中的不算）
    { name: 'users', sql: 'SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL', binds: [] },
  ]
}

/**
 * 把 metricsQueries 的结果行（同序的 [{n}]，可能为 null）折成一个对象（纯函数）。
 * 任一查询失败时该键回 0，不抛错、不隐藏 —— 缺数就报 0。
 */
export function shapeMetrics(rows, now) {
  const qs = metricsQueries(now)
  const out = { ok: true, serverNow: new Date(now).toISOString(), dayStart: utcDayStart(now) }
  qs.forEach((q, i) => {
    const row = Array.isArray(rows) ? rows[i] : null
    const n = row && Number(row.n)
    out[q.name] = Number.isFinite(n) ? n : 0
  })
  return out
}