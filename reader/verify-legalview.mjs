#!/usr/bin/env node
/**
 * verify-legalview.mjs · 法务页纯逻辑（投诉正文／校验／回执号）
 * 跑法：node verify-legalview.mjs（已挂进 npm test 链）
 */
import * as L from './src/utils/legalView.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ok ' + name) }
  else { fail++; console.log('  FAIL ' + name) }
}

console.log('[legalView — 正文]')
{
  const msg = L.composeComplaintMessage({ body: '  作品 A 被全文转载：https://x.example  ', category: '其他（分类口径待 LG 定）' })
  t('带前缀与分类', msg.startsWith(L.COMPLAINT_PREFIX) && msg.includes('分类：'))
  t('正文去首尾空白', msg.endsWith('作品 A 被全文转载：https://x.example'))
  t('默认分类', L.composeComplaintMessage({ body: 'x' }).includes(L.COMPLAINT_CATEGORY))
}

console.log('[legalView — 校验]')
{
  const ok = { body: '这是一段足够长的侵权说明文字', contact: 'a@b.co', agreed: true }
  t('通过', L.complaintProblem(ok) === null)
  t('正文太短', /10/.test(L.complaintProblem({ ...ok, body: '太短' })))
  t('正文太长', /1500/.test(L.complaintProblem({ ...ok, body: 'x'.repeat(1501) })))
  t('缺联系方式', /邮箱或电话/.test(L.complaintProblem({ ...ok, contact: '' })))
  t('联系方式太长', /120/.test(L.complaintProblem({ ...ok, contact: 'x'.repeat(121) })))
  t('未勾选', /属实/.test(L.complaintProblem({ ...ok, agreed: false })))
}

console.log('[legalView — 回执]')
{
  const now = new Date(2026, 10, 17, 12, 0).getTime()
  t('回执号格式', L.receiptNumber(1, now) === 'R-20261117-001')
  t('三位补零', L.receiptNumber(42, now) === 'R-20261117-042')
  t('超三位不截断', L.receiptNumber(1234, now) === 'R-20261117-1234')
  t('坏 id -> 空串', L.receiptNumber(0, now) === '' && L.receiptNumber('x', now) === '' && L.receiptNumber(null, now) === '')
  t('取最新 id', L.receiptFromItems([{ id: 3 }, { id: 9 }, { id: 6 }]) === 9)
  t('空/坏列表 -> 0', L.receiptFromItems(null) === 0 && L.receiptFromItems([{ id: 0 }, {}]) === 0)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
