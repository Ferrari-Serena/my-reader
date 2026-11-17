/**
 * 密码策略 A 的纯逻辑（产品方案 v0 §2.2 / 线框 09）：
 *   - 长度 ≥8（上限沿用 authForm 的 200）
 *   - 不强制字符组合；强度条只看长度与「常见密码」
 *   - 本地小表拦常见密码；拦「密码＝邮箱」
 * 组件只负责展示，判断集中在这里，方便 verify-authui 裸 node 测。
 */

export const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'passw0rd', '12345678', '123456789', '1234567890',
  'qwertyui', 'qwerty123', '11111111', '00000000', 'abc12345', 'iloveyou',
  'letmein1', 'admin123', 'welcome1', '87654321', '1q2w3e4r', 'zaq12wsx',
])

/** 0=不足 8 位；1=弱；2=中；3=强。 */
export function passwordStrength(raw) {
  const s = String(raw || '')
  if (s.length < 8) return 0
  let kinds = 0
  if (/[a-z]/.test(s)) kinds++
  if (/[A-Z]/.test(s)) kinds++
  if (/\d/.test(s)) kinds++
  if (/[^A-Za-z0-9]/.test(s)) kinds++
  if (s.length >= 12) kinds++
  if (kinds >= 4) return 3
  if (kinds >= 3) return 2
  return 1
}

export function commonPasswordProblem(raw) {
  const s = String(raw || '').toLowerCase()
  return COMMON_PASSWORDS.has(s) ? '这个密码太常见，请换一个。' : null
}

export function sameAsEmailProblem(email, raw) {
  const e = String(email || '').trim().toLowerCase()
  const s = String(raw || '').toLowerCase()
  return e && s && e === s ? '密码不能和邮箱相同。' : null
}
