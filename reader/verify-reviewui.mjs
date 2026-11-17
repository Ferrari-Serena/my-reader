#!/usr/bin/env node
/**
 * verify-reviewui.mjs · 复习页展示逻辑（今日进度／队列估算／来源）
 * 跑法：node verify-reviewui.mjs（已挂进 npm test 链）
 */
import * as R from './src/utils/reviewView.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ok ' + name) }
  else { fail++; console.log('  FAIL ' + name) }
}

const now = new Date(2026, 10, 17, 15, 0).getTime()
const at = (d, h, m) => new Date(2026, 10, d, h, m).toISOString()

console.log('[reviewView — 今日]')
{
  t('本地日期键', R.localDayKey(at(17, 9, 5)) === '2026-11-17')
  t('今天算今天', R.isReviewedToday(at(17, 0, 5), now) === true)
  t('昨天不算今天', R.isReviewedToday(at(16, 23, 59), now) === false)
  t('空值不算', R.isReviewedToday(null, now) === false && R.isReviewedToday('', now) === false)

  const items = [
    { srs: { last_review: at(17, 10, 0) } },
    { srs: { last_review: at(17, 14, 0) } },
    { srs: { last_review: at(16, 20, 0) } },
    { srs: null },
    { srs: {} },
    null,
  ]
  t('只数今天的 last_review', R.dailyReviewedCount(items, now) === 2)
  t('空队列 -> 0', R.dailyReviewedCount(null, now) === 0 && R.dailyReviewedCount([], now) === 0)
}

console.log('[reviewView — 队列估算]')
{
  t('0 张 -> 0', R.estimateMinutes(0) === 0)
  t('1 张 -> 1 分钟', R.estimateMinutes(1) === 1)
  t('5 张 = 60s -> 1', R.estimateMinutes(5) === 1)
  t('6 张 = 72s -> 2', R.estimateMinutes(6) === 2)
  t('30 张 -> 6', R.estimateMinutes(30) === 6)
  t('坏数字 -> 0', R.estimateMinutes('x') === 0 && R.estimateMinutes(-3) === 0)
  t('文案', R.estimateText(0) === '—' && R.estimateText(30) === '约 6 分钟')
}

console.log('[reviewView — 来源]')
{
  t('全是单词 -> 生词本手动收藏', R.queueSourceText([{ refKind: 'word' }, { refKind: 'word' }]) === '生词本手动收藏')
  t('含词组 -> 并列写出', R.queueSourceText([{ refKind: 'word' }, { refKind: 'phrase' }]) === '生词本 ＋ 测验错题')
  t('空 -> 生词本手动收藏', R.queueSourceText(null) === '生词本手动收藏')
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
