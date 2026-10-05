/**
 * 账号表单的**纯逻辑**（不碰网络、不碰 vue）—— 前端这一层唯一值得单测的东西。
 *
 * 为什么单拎出来：端点真伪在 worker 侧已有 421 条断言；前端容易错的不是「能不能调通」，
 * 而是「同一个错误码在不同表单里该说什么」「按钮什么时候该禁用」——
 * 埋在组件里就只能靠手点，测不到。校验口径与后端逐条对齐：
 *   - 邮箱：与 worker/src/auth.js 的 normalizeEmail 同口径（有 @、有点、无空白、长度）
 *   - 密码：8–200 字符（worker 的 checkPasswordPolicy）
 */

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200

/** 邮箱弱校验（前端只挡明显的错，真伪靠验证信）；过 -> null，否则回一句给用户看的话 */
export function emailProblem(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return 'Enter your email address.'
  if (s.length > 254) return 'That email address is too long.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'That does not look like an email address.'
  return null
}

/** 密码长度；过 -> null */
export function passwordProblem(raw) {
  const s = typeof raw === 'string' ? raw : ''
  if (s.length < PASSWORD_MIN) return 'Password needs at least ' + PASSWORD_MIN + ' characters.'
  if (s.length > PASSWORD_MAX) return 'Password must be at most ' + PASSWORD_MAX + ' characters.'
  return null
}

/** 两次输入是否一致；过 -> null */
export function confirmProblem(password, confirm) {
  return password === confirm ? null : 'The two passwords do not match.'
}

/** 多少秒换算成「大约几分钟」；不足一分钟按 1 分钟说 */
export function retryMinutes(seconds) {
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return 0
  return Math.max(1, Math.ceil(s / 60))
}

/**
 * 后端错误码 -> 给用户看的一句话。
 * 顺序要紧：先认 code（具体），再按 status 兜底（笼统）—— 反了的话 429 会被说成
 * 「试太多次」而丢掉具体的 retryAfter。
 */
export function authErrorMessage(status, payload) {
  const data = payload || {}
  const code = data.error || ''
  if (code === 'invalid-email') return 'Enter a valid email address.'
  if (code === 'weak-password') {
    return data.reason === 'too-long'
      ? 'Password must be at most ' + PASSWORD_MAX + ' characters.'
      : 'Password needs at least ' + PASSWORD_MIN + ' characters.'
  }
  if (code === 'email-taken') return 'That email is already registered — try signing in instead.'
  if (code === 'invalid-credentials') return 'Email or password is incorrect.'
  if (code === 'too-many-attempts' || status === 429) {
    const mins = retryMinutes(data.retryAfter)
    return mins
      ? 'Too many attempts. Try again in about ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.'
      : 'Too many attempts. Try again a bit later.'
  }
  if (code === 'bad-origin' || code === 'bad-csrf') return 'That request was blocked for safety — reload the page and try again.'
  if (code === 'password-required') return 'Enter your password to confirm.'
  if (code === 'gone') return 'That account can no longer be restored — its 30-day window has passed.'
  if (code === 'not-pending') return 'This account is not scheduled for deletion.'
  if (code === 'network' || status === 0) return 'Cannot reach the server. Check your connection and try again.'
  if (code === 'internal' || status >= 500) return 'Something went wrong on our side. Try again in a moment.'
  return 'Something went wrong. Try again.'
}
