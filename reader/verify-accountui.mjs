#!/usr/bin/env node
/**
 * verify-accountui.mjs · 「我的」页纯逻辑（额度／存储／最近任务／时间）
 * 跑法：node verify-accountui.mjs（已挂进 npm test 链）
 */
import * as A from './src/utils/accountData.js'
import { normalizeGenStatus } from './src/utils/genApi.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ok ' + name) }
  else { fail++; console.log('  FAIL ' + name) }
}

console.log('[accountData — 额度]')
{
  const q = A.quotaSummary({ chaptersUsed: 2, chaptersLeft: 3 })
  t('2 用 / 3 余 -> max 5、40%', q.known === true && q.used === 2 && q.max === 5 && q.pct === 40)
  t('unknown -> 不编数字', A.quotaSummary({ unknown: true, chaptersUsed: 0, chaptersLeft: 5 }).known === false)
  t('缺字段 -> 不知道', A.quotaSummary(null).known === false && A.quotaSummary(null).used === 0)
  t('负数用量按 0', A.quotaSummary({ chaptersUsed: -3, chaptersLeft: 5 }).used === 0)
}

console.log('[accountData — 存储]')
{
  const s = A.storageSummary({ usedBytes: 858993459, limitBytes: 1073741824 })
  t('0.8 GiB / 1.0 GiB', s.known === true && s.usedText === '0.8 GiB' && s.limitText === '1.0 GiB')
  t('80%', s.pct === 80)
  t('usedBytes -1 -> 不知道', A.storageSummary({ usedBytes: -1, limitBytes: 1073741824 }).known === false)
  t('full 透传', A.storageSummary({ usedBytes: 5, limitBytes: 5, full: true }).full === true)
  t('小用量退回通用单位', A.gibText(5 * 1024 * 1024) === '5.0 MB')
}

console.log('[accountData — 时间]')
{
  const now = new Date(2026, 10, 17, 15, 30).getTime()
  const at = (d, h, m) => new Date(2026, 10, d, h, m).toISOString()
  t('今天', A.formatWhen(at(17, 12, 40), now) === '今天 12:40')
  t('昨天', A.formatWhen(at(16, 9, 5), now) === '昨天 09:05')
  t('更早', A.formatWhen(at(15, 8, 0), now) === '11月15日 08:00')
  t('认不出 -> 空串', A.formatWhen('', now) === '' && A.formatWhen('not-a-date', now) === '')
}

console.log('[accountData — 状态与任务合并]')
{
  const now = new Date(2026, 10, 17, 15, 0).getTime()
  t('pending 带队列位', A.statusLabel('pending', { queuePosition: 2 }) === '排队中 · 第 2 位')
  t('pending 无队列位', A.statusLabel('pending') === '排队中')
  t('running', A.statusLabel('running') === '生成中')
  t('done', A.statusLabel('done') === '已完成')
  t('failed', A.statusLabel('failed') === '失败')

  const mk = (body, bookId) => normalizeGenStatus(body, bookId)
  const statuses = [
    {
      bookId: 'bk_a', bookTitle: '经济学原理', chapterIds: ['ch-01', 'ch-02'],
      data: mk({
        chapters: {
          'ch-01': { status: 'done', title: 'A', updatedAt: new Date(2026, 10, 17, 12, 40).toISOString(), finishedAt: new Date(2026, 10, 17, 12, 41).toISOString() },
          'ch-02': { status: 'failed', title: 'B', error: 'synth failed', updatedAt: new Date(2026, 10, 17, 13, 0).toISOString() },
          'ch-03': { status: 'purged', updatedAt: new Date(2026, 10, 17, 9, 0).toISOString() },
        },
        queue: { position: 2 },
      }, 'bk_a')
    },
    {
      bookId: 'bk_b', bookTitle: 'The Great Gatsby', chapterIds: ['ch-01'],
      data: mk({
        chapters: {
          'ch-01': { status: 'pending', title: 'C', updatedAt: new Date(2026, 10, 17, 12, 55).toISOString() },
        },
        queue: { ahead: 1, position: 2 },
      }, 'bk_b')
    }
  ]
  const rows = A.recentTasks(statuses, { now })
  t('按时间倒序：失败 > 排队 > 完成', rows.map((r) => r.chapterId).join(',') === 'ch-02,ch-01,ch-01')
  t('第一行是失败、可重试', rows[0].status === 'failed' && rows[0].canRetry === true)
  t('章号来自 chapterIds', rows[0].chapterNo === 2 && rows[1].chapterNo === 1)
  t('排队行带队列位', rows[1].label === '排队中 · 第 2 位')
  t('purged 不进列表', rows.every((r) => r.status !== 'purged'))
  t('上限生效', A.recentTasks(statuses, { now, limit: 1 }).length === 1)
  t('标题拼装', A.taskTitle(rows[0]) === '《经济学原理》第 2 章')
  t('空输入 -> []', A.recentTasks(null).length === 0 && A.recentTasks([]).length === 0)
}

console.log('[genApi — 时间字段透传]')
{
  const s = normalizeGenStatus({
    chapters: { 'ch-01': { status: 'done', updatedAt: '2026-11-17T04:40:00.000Z', finishedAt: '2026-11-17T04:41:00.000Z' } },
  }, 'bk_x')
  t('updatedAt 保留', s.chapters['ch-01'].updatedAt === '2026-11-17T04:40:00.000Z')
  t('finishedAt 保留', s.chapters['ch-01'].finishedAt === '2026-11-17T04:41:00.000Z')
  t('缺时间 -> null', normalizeGenStatus({ chapters: { 'ch-01': { status: 'done' } } }).chapters['ch-01'].updatedAt === null)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
