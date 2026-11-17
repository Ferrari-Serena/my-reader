/**
 * 法务页（UI-08）的纯逻辑：投诉正文拼装、表单校验、回执号。
 * 口径：分类与受理时限待 LG 定 —— 本版只有「其他」一档，不编 SLA。
 */

export const COMPLAINT_PREFIX = '【侵权投诉】'
export const COMPLAINT_CATEGORY = '其他（分类口径待 LG 定）'
export const MIN_BODY = 10
export const MAX_BODY = 1500
export const MAX_CONTACT = 120

export function composeComplaintMessage({ body, category } = {}) {
  const b = String((body && body.trim) ? body.trim() : '')
  const c = String(category || COMPLAINT_CATEGORY).trim()
  return COMPLAINT_PREFIX + '分类：' + c + '\n' + b
}

/** 返回第一条错误文案；通过回 null。 */
export function complaintProblem({ body, contact, agreed } = {}) {
  const b = String(body || '').trim()
  if (b.length < MIN_BODY) return '请至少写 ' + MIN_BODY + ' 个字说明作品与侵权情况。'
  if (b.length > MAX_BODY) return '正文请控制在 ' + MAX_BODY + ' 字以内。'
  const c = String(contact || '').trim()
  if (!c) return '请留下邮箱或电话，便于回复。'
  if (c.length > MAX_CONTACT) return '联系方式请控制在 ' + MAX_CONTACT + ' 字以内。'
  if (!agreed) return '请先勾选「所述情况属实」。'
  return null
}

const pad3 = (n) => String(n).padStart(3, '0')

/** R-20261117-001；id 认不出回空串（不编回执号）。 */
export function receiptNumber(id, now = Date.now()) {
  const n = Number(id)
  if (!Number.isFinite(n) || n <= 0) return ''
  const d = new Date(Number.isFinite(now) ? now : Date.now())
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  return 'R-' + ymd + '-' + pad3(Math.floor(n))
}

/** 从「我提过的」里取最新一条的 id（越大越新）；取不到回 0。 */
export function receiptFromItems(items) {
  let best = 0
  for (const it of Array.isArray(items) ? items : []) {
    const n = Number(it && it.id)
    if (Number.isFinite(n) && n > best) best = n
  }
  return best
}
