#!/usr/bin/env node
/**
 * verify-exportui.mjs · 数据导出纯逻辑（UI-22）
 * 跑法：node verify-exportui.mjs（已挂进 npm test 链）
 */
import * as E from './src/utils/exportData.js'

let pass = 0, fail = 0
function t(name, cond) {
  if (cond) { pass++; console.log('  ok ' + name) }
  else { fail++; console.log('  FAIL ' + name) }
}

const notes = [
  {
    id: 'note-1', bookId: 'bk_a', bookTitle: '经济学原理', chapterId: 'ch-01', paraId: 'p-3',
    charStart: 10, charEnd: 24, quote: '供给与需求', text: '弹性取决于替代品', color: 'yellow',
    createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '2026-11-02T02:00:00.000Z',
    serverOnly: 'must-not-leak', dirty: true,
  },
  { id: '', text: '坏记录' },
  null,
]
const vocab = {
  words: {
    'apple': {
      word: 'apple', addedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z',
      bookId: 'bk_a', chapterId: 'ch-01', dirty: true, tombstone: false,
      snapshot: { lemma: 'apple', phonetic: '/ˈæpl/', definitions: ['苹果'], level: null, chapters: ['ch-01'], surfaces: ['apples'] },
      srs: { due: '2026-11-20T00:00:00.000Z', stability: 4.2, difficulty: 5.1, elapsed_days: 2, scheduled_days: 3, reps: 2, lapses: 0, state: 2, last_review: '2026-11-17T00:00:00.000Z' },
      quiz: { last: 1 },
    },
    'bad': { word: '', srs: null },
    'pear': { word: 'PEAR', addedAt: '2026-11-02T00:00:00.000Z', srs: { due: 123 } },
  },
}

console.log('[exportData — 组装]')
{
  const out = E.buildExport({ notes, vocab, exportedAt: '2026-11-17T10:00:00.000Z' })
  t('schema 固定', out.schema === E.EXPORT_SCHEMA)
  t('计数：1 条笔记、2 张卡片', out.counts.notes === 1 && out.counts.cards === 2)
  t('笔记白名单：不含 dirty/serverOnly', out.notes[0].dirty === undefined && out.notes[0].serverOnly === undefined)
  t('笔记保留锚点与正文', out.notes[0].paraId === 'p-3' && out.notes[0].text === '弹性取决于替代品')
  const apple = out.cards.find((c) => c.word === 'apple')
  t('卡片不含脏标记/墓碑', apple.dirty === undefined && apple.tombstone === undefined)
  t('词头小写', out.cards.some((c) => c.word === 'pear'))
  t('snapshot 只留白名单字段', apple.snapshot && apple.snapshot.definitions.length === 1 && apple.snapshot.surfaces === undefined)
  t('FSRS 状态保留 due/reps', apple.srs && apple.srs.due === '2026-11-20T00:00:00.000Z' && apple.srs.reps === 2)
  const pear = out.cards.find((c) => c.word === 'pear')
  t('坏的 srs（due 非字符串）→ null', pear.srs === null)
  t('空词条被丢弃', !out.cards.some((c) => c.word === 'bad'))
  t('空 note 被丢弃', out.notes.length === 1)
}

console.log('[exportData — 空与文件名]')
{
  const empty = E.buildExport({ notes: [], vocab: { words: {} } })
  t('空导出', E.isEmptyExport(empty) === true)
  t('非空导出', E.isEmptyExport(E.buildExport({ notes })) === false)
  const at = new Date(2026, 10, 17, 18, 5).toISOString()
  t('文件名带本地时间', E.exportFileName(at) === 'my-reader-export-20261117-1805.json')
  t('坏时间退回默认名', E.exportFileName('not-a-date') === 'my-reader-export.json')
  t('计数文案', E.exportCountsText({ counts: { notes: 12, cards: 48 } }) === '12 条笔记 · 48 张卡片')
}

console.log('[exportData — 浏览器边界]')
{
  t('Node 里不假装能下载', E.downloadJson('x.json', {}) === false)
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
