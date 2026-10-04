/**
 * 「登录 ↔ 数据」的租户键对账（第 3 步）。**纯编排层**：自己不碰存储、不组请求体，
 * 只把 useAuth 的「认领」与 useSync 的「换键」按正确顺序串起来 —— 这两件事分属身份域与同步域，
 * 谁都不该 import 对方，接缝就落在这里。
 *
 * Ferrari 2026-10-04 裁的三条：
 *   ① 登录时**自动**认领本机游客码（不弹窗问）；
 *   ② 认领后旧码立刻作废 —— 服务端做法是**改名**（见 worker/src/authapi.js 的 handleClaim）：
 *      给账号铸一个新主码，把旧码底下的行整体搬到新主码下，旧码的哨兵行随之消失 → 旧码从此 404；
 *   ③ 账号早就认领过时（换新设备登录），本机原游客码在服务端**原样不动**（当人工回退的备份），
 *      本机只是「接管」账号主码。
 *
 * ⚠️ 一个容易误会的地方：本机的生词是**一份全局词表**（localStorage 'reader-vocab-v1'，
 * 不按同步码分家）。所以换键之后本机内容会跟着流进账号主码下 —— 「本地那份不合并」在这一层
 * 做不到，也不该做；③ 说的是**服务端旧码不删不改**，不是「本地不合并」。
 */

import { useSync } from '../composables/useSync.js'

/**
 * 纯判据：这次对账该做什么。不碰网络/存储，所以能被自检直接钉住。
 *   'claim' —— 账号还没有主码 → 把本机码交给服务端去认领（顺带把账号的码定下来）
 *   'adopt' —— 账号已有主码，且与本机不同 → 本机改用账号的码
 *   'none'  —— 已经是同一个码 → 什么都不做
 */
export function tenantAction({ accountCode, localCode }) {
  if (!accountCode) return 'claim'
  if (accountCode === localCode) return 'none'
  return 'adopt'
}

let _running = false // 并发去重：user 可能在一场会话里被判「出现」多次

/**
 * 对账一次。幂等、失败静默 —— 对不上不该影响读书（与 useSync / useAuth 同姿态）。
 * 返回这次做了什么（给自检 / 调用方看）；没登录回 null。
 */
export async function reconcileTenant(auth) {
  const user = auth && auth.user && auth.user.value
  if (!user) return null
  if (_running) return { action: 'busy' }

  const sync = useSync()
  const local = sync.code.value
  const action = tenantAction({ accountCode: user.syncCode || '', localCode: local })
  if (action === 'none') return { action }

  _running = true
  try {
    if (action === 'adopt') {
      await sync.adoptCode(user.syncCode)
      return { action, code: user.syncCode }
    }

    const r = await auth.claim(local)
    const code = r && r.ok && r.data ? r.data.code : ''
    if (!code) return { action, ok: false }
    await sync.adoptCode(code)
    // 真认领才提一句；换新设备登录（只是接管）不提，免得每次开账号页都弹一句
    if (r.data.claimed) {
      auth.note('Your words and progress on this device are now part of this account.')
    }
    return { action, code, claimed: !!r.data.claimed }
  } finally {
    _running = false
  }
}
