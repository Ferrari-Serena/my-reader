/**
 * 「会话 → 租户」闸 —— **一处判、两处用**（第 16.5 步 D16；语义与第 16 步 `/api/sync/book`
 * 的 D14-b 完全同一套，故抽出来共用，免得两条路由各写一份、慢慢漂开）。
 *
 * 三档，**顺序不许反**：
 *   无会话（含只持 8 位码的未登录设备）→ **401**
 *   有会话但账号还没认领主码（查不出租户）  → **403**
 *   URL 里出现 `?code=`                     → **400**（Ferrari 2026-10-06 裁「严禁任何 code 入 URL」）
 *
 * 为什么 401 要排在 400 前面：先问「你是谁」，不因为有会话才去挑 URL 的毛病 ——
 * 反了会把未登录的 401 变成 400，等于泄路径/契约形状。
 * 400 又为什么**刻意不忽略**：忽略会让「前端还在带码」这种错悄悄活下来，而租户
 * 更不该被 URL 参数牵着走（它只由 `users.sync_code` 决定）。
 *
 * 本模块**不 import sync.js**（它 import authapi）：authapi 反向依赖 sync 的
 * CODE_LEN 那条线已在 D16 被剪到 `code.js`，所以这里没有环。
 */

import { sessionUserId, SQL_USER_BY_ID } from './authapi.js'

/**
 * 有效会话（且账号未注销）→ `{ userId, code }`；否则 null。
 * `code` 可能是 `''` ＝ **还没认领主码**（调用方按 403 处理，不在这里铸码）。
 */
export async function sessionAccount(request, env) {
  const userId = await sessionUserId(request, env)
  if (!userId) return null
  const user = await env.DB.prepare(SQL_USER_BY_ID).bind(userId).first()
  if (!user || user.deleted_at) return null
  return { userId, code: String(user.sync_code || '') }
}

/**
 * 判闸。放行 → `{ acct }`；不放行 → `{ status, error }`（响应体由各路由自己成形 ——
 * 两条路由的 json 助手不一样，但**判定**只有这一份）。
 * `url` 可省（不判码时就传 null，例如按 bookId 定路径的路由自己另判形状）。
 */
export async function sessionTenant(request, env, url) {
  const acct = await sessionAccount(request, env)
  if (!acct) return { status: 401, error: 'unauthenticated' }
  if (!acct.code) return { status: 403, error: 'account has no sync code' }
  if (url && url.searchParams.has('code')) {
    return { status: 400, error: 'code must not be in url' }
  }
  return { acct }
}