/**
 * 账号表单的**纯逻辑**（不碰网络、不碰 vue）—— 前端这一层唯一值得单测的东西。
 *
 * 为什么单拎出来：端点真伪在 worker 侧已有 447 条断言；前端容易错的不是「能不能调通」，
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
  if (!s) return '请输入邮箱。'
  if (s.length > 254) return '邮箱地址太长了。'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return '这不像一个邮箱地址。'
  return null
}

/** 密码长度；过 -> null */
export function passwordProblem(raw) {
  const s = typeof raw === 'string' ? raw : ''
  if (s.length < PASSWORD_MIN) return '密码至少 ' + PASSWORD_MIN + ' 位。'
  if (s.length > PASSWORD_MAX) return '密码最多 ' + PASSWORD_MAX + ' 位。'
  return null
}

/** 两次输入是否一致；过 -> null */
export function confirmProblem(password, confirm) {
  return password === confirm ? null : '两次输入的密码不一致。'
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
  if (code === 'invalid-email') return '请输入有效的邮箱地址。'
  if (code === 'weak-password') {
    return data.reason === 'too-long'
      ? '密码最多 ' + PASSWORD_MAX + ' 位。'
      : '密码至少 ' + PASSWORD_MIN + ' 位。'
  }
  if (code === 'email-taken') return '这个邮箱已经注册过了，直接登录就行。'
  if (code === 'invalid-credentials') return '邮箱或密码不对。'
  if (code === 'too-many-attempts' || status === 429) {
    const mins = retryMinutes(data.retryAfter)
    return mins
      ? '尝试次数太多了，大约 ' + mins + ' 分钟后再试。'
      : '尝试次数太多了，稍后再试。'
  }
  if (code === 'bad-origin' || code === 'bad-csrf') return '这次请求被安全拦截了，刷新页面再试一次。'
  if (code === 'password-required') return '请输入密码确认。'
  if (code === 'gone') return '这个账号已经过了 30 天撤销期，无法恢复。'
  if (code === 'not-pending') return '这个账号不在注销状态。'
  if (code === 'network' || status === 0) return '连不上服务器，检查网络后再试。'
  if (code === 'internal' || status >= 500) return '我们这边出了点问题，稍后再试。'
  return '出了点问题，再试一次。'
}
