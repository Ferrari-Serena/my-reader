/**
 * 登录守卫的三态纯决策（不碰 DOM / 网络），App.vue 与 verify-authui 共用。
 *
 * 三态（产品方案 v0 §2.2 / 产品全景蓝图 v0.3 #1）：
 *   authenticated   —— 已登录：放行
 *   unauthenticated —— 未登录：在线首启去 /register；有本机足迹或已引导过则放行
 *   unknown         —— 加载中 / auth 网络失败：放行本机阅读，**不得误送注册页**
 *
 * 四条降级路径（离线首启、老游客升级、清缓存、慢网/auth 故障）都落在「放行」：
 * 宁可少弹一次注册墙，也不要把能读书的人锁在门外。
 */

export const AUTH_SEEN_KEY = 'mr-auth-seen'

export function markAuthSeen(storage = globalThis.localStorage) {
  try { storage.setItem(AUTH_SEEN_KEY, '1') } catch { /* 私密模式 */ }
}

export function wasAuthSeen(storage = globalThis.localStorage) {
  try { return storage.getItem(AUTH_SEEN_KEY) === '1' } catch { return false }
}

/** 本机是否已有「老游客」足迹：同步码 / 生词本 / 阅读位置。缓存清空后应为 false。 */
export function hasLocalFootprint(storage = globalThis.localStorage) {
  try {
    if (storage.getItem('reader-sync-code')) return true
    if (storage.getItem('reader-vocab-v1')) return true
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i) || ''
      if (k.startsWith('reader-reading-pos:')) return true
    }
  } catch { /* 私密模式 */ }
  return false
}

/**
 * @returns {'allow'|'wait'|'register'}
 *  - wait：auth 尚未就绪，什么都不做（unknown，不弹墙）
 *  - allow：放行
 *  - register：在线首启，去 /register
 */
export function authGateDecision({ online, authReady, authUnknown, user, hasLocal, seen }) {
  if (user) return 'allow'
  if (!authReady) return 'wait'
  if (authUnknown) return 'allow'
  if (!online) return 'allow'
  if (hasLocal) return 'allow'
  if (seen) return 'allow'
  return 'register'
}
