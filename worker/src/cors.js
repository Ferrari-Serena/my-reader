/**
 * CORS 白名单（0.0 止血）
 *
 * 此前 Worker 对所有响应硬编码 Access-Control-Allow-Origin: *，等于任何网站都能借用户的
 * 浏览器调我们的词典/同步接口，把 M-W 免费额度（1000 次/天）烧掉。这里改成按请求回显自家 Origin：
 *   - 命中的 Origin → 回显它本身（不能用 *，否则将来带凭据的请求会被浏览器拒）
 *   - 未命中 → 不发 ACAO，浏览器按 CORS 失败处理
 *
 * ⚠️ CORS 只挡浏览器跨站读取，挡不住脚本（curl / 后端直连）。脚本滥用靠边缘限流，
 * 见 第0-1步任务卡.md 的 0.0（CF Rate limiting 规则）。
 *
 * 白名单来源（按优先级）：
 *   1. env.ALLOWED_ORIGINS —— 逗号分隔的完整 Origin，精确匹配（给未来留的口子）
 *   2. 内置规则：ferrari11.com 及其任意子域 + 本地开发主机
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function extraAllowed(env) {
  const raw = env && env.ALLOWED_ORIGINS
  if (!raw) return []
  return String(raw).split(',').map(s => s.trim()).filter(Boolean)
}

/** 是否放行这个 Origin */
export function isAllowedOrigin(origin, env = {}) {
  if (!origin || origin === 'null') return false
  if (extraAllowed(env).includes(origin)) return true

  let u
  try { u = new URL(origin) } catch { return false }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false

  const host = u.hostname
  if (host === 'ferrari11.com' || host.endsWith('.ferrari11.com')) return true
  if (LOCAL_HOSTS.has(host)) return true
  return false
}

/**
 * 构造本次响应的 CORS 头。
 * 无论是否命中都带 Vary: Origin —— 否则 CDN 会把「给 A 站的 ACAO」缓存下来再发给 B 站。
 */
export function corsFor(request, env = {}) {
  const origin = (request && request.headers && request.headers.get('Origin')) || ''
  const headers = {
    // PUT/DELETE：第 16 步 BYO 书体（/api/sync/book）要用；预检答的是「允许的动词集合」
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // X-CSRF-Token：CSRF 第二层的自定义头（见 authapi.js）。同源请求根本不走 CORS，
    // 这里放行只为「白名单内的跨源页面（本地开发 / 同站子域）也能发对请求」。
    'Access-Control-Allow-Headers': 'Content-Type, Range, X-CSRF-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (isAllowedOrigin(origin, env)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}
