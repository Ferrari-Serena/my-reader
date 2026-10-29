/**
 * 第 11 步块 A 验证：统一复习 adapter + 混队调度（纯逻辑，不依赖浏览器）。
 * 用法: node verify-review.mjs
 */

import { buildQueueFromItems, nextDueFromItems, createCard } from './src/fsrs.js'
import {
  REF_KIND_WORD,
  REF_KIND_PHRASE,
  normalizePhraseKey,
  phraseCardId,
  phraseDueTomorrowIso,
  wordReviewItem,
  phraseReviewItem,
  collectReviewItems
} from './src/review.js'

let pass = 0, fail = 0
function t(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ← ' + detail : ''}`) }
}

console.log('\n[review.js — 键与记录 id]')
t('词组键归一：大小写 + 多空格 -> 小写单空格',
  normalizePhraseKey('  Turn   Out ') === 'turn out')
t('词组键空输入 -> 空串', normalizePhraseKey('   ') === '' && normalizePhraseKey(null) === '')
const turnId = phraseCardId('Turn Out')
t('词组 card id 确定性且带 kind/refKind 前缀',
  turnId === 'card_phrase_turn%20out' && turnId === phraseCardId('turn out'))
t('词组 card id 空键 -> 空串', phraseCardId('  ') === '')
{
  const today = new Date(2026, 9, 15, 10, 0, 0)
  const expected = new Date(2026, 9, 16, 0, 0, 0).toISOString()
  t('词组首错 due = 次日本地 00:00', phraseDueTomorrowIso(today) === expected,
    `${phraseDueTomorrowIso(today)} != ${expected}`)
  t('词组首错 due 无效日期 -> null', phraseDueTomorrowIso('garbage') === null)
}

console.log('\n[review.js — 单条归一化]')
const wordItem = wordReviewItem({
  word: 'Alpha',
  addedAt: '2026-01-02T00:00:00.000Z',
  srs: null,
  snapshot: { lemma: 'Alpha', phonetic: '/a/', partOfSpeech: 'n.', definitions: ['one'] }
})
t('单词 item 字段齐', wordItem?.key === 'word:alpha' && wordItem.refKind === REF_KIND_WORD &&
  wordItem.refKey === 'alpha' && wordItem.content.definitions.join() === 'one')
t('无释义单词被排除', wordReviewItem({ word: 'x', snapshot: { definitions: [] } }) === null)
t('空单词被排除', wordReviewItem(null) === null)

const phraseItem = phraseReviewItem(
  { refKind: 'phrase', refKey: 'Turn Out', srs: null, createdAt: '2026-01-02T00:00:00.000Z' },
  { defs: ['to result'], pos: 'v' }
)
t('词组 item 字段齐', phraseItem?.key === 'phrase:turn out' && phraseItem.refKind === REF_KIND_PHRASE &&
  phraseItem.refKey === 'turn out' && phraseItem.content.definitions.join() === 'to result')
t('词典没释义的词组被排除', phraseReviewItem({ refKey: 'turn out' }, null) === null)
t('空词组被排除', phraseReviewItem(null, { defs: ['x'] }) === null)

console.log('\n[review.js — 混合汇总]')
const base = createCard()
const pastCard = { ...base, due: '2000-01-01T00:00:00.000Z' }
const midCard = { ...base, due: '2010-01-01T00:00:00.000Z' }
const futureCard = { ...base, due: '3000-01-01T00:00:00.000Z' }

const words = {
  a: { word: 'Alpha', addedAt: '2026-01-02T00:00:00.000Z', srs: null, snapshot: { lemma: 'Alpha', definitions: ['one'] } },
  b: { word: 'Beta', addedAt: '2026-01-03T00:00:00.000Z', srs: pastCard, snapshot: { lemma: 'Beta', definitions: ['two'] } },
  c: { word: 'Gamma', addedAt: '2026-01-01T00:00:00.000Z', srs: futureCard, snapshot: { lemma: 'Gamma', definitions: ['three'] } },
  empty: { word: 'Empty', addedAt: '2026-01-01T00:00:00.000Z', srs: null, snapshot: { definitions: [] } }
}
const records = {
  'card_phrase_turn%20out': {
    refKind: 'phrase', refKey: 'Turn  Out', srs: midCard,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  },
  'card_phrase_pick%20up': {
    refKind: 'phrase', refKey: 'pick up', srs: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  },
  // 历史 UUID 卡与确定性卡重复：应去重，只留 updatedAt 更新的一条
  'card_dupe': {
    refKind: 'phrase', refKey: 'turn out', srs: futureCard,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z'
  },
  'card_phrase_unknown': { refKind: 'phrase', refKey: 'missing entry', srs: pastCard }
}
const entries = {
  'turn out': { defs: ['to result'], pos: 'v' },
  'pick up': { defs: ['to lift'], pos: 'v' }
}

const items = collectReviewItems(words, records, entries)
t('汇总：3 词 + 2 词组，空词与缺词典词组被排除', items.length === 5, `got ${items.length}`)
t('重复词组去重后只剩一条', items.filter(i => i.refKind === 'phrase' && i.refKey === 'turn out').length === 1)
t('重复词组取 LWW 最新的一条', items.find(i => i.refKey === 'turn out').srs === midCard)
t('词组不依赖 id 解析，直接读 refKey', items.some(i => i.key === 'phrase:pick up'))

const queue = buildQueueFromItems(items, { newLimit: 1 })
t('到期队列：单词 Beta(2000) 在词组 turn out(2010) 前',
  queue.due.map(i => i.key).join() === 'word:beta,phrase:turn out')
t('新卡队列按 addedAt 升序：词组 pick up(01-01) 在单词 Alpha(01-02) 前',
  buildQueueFromItems(items, { newLimit: 20 }).fresh.map(i => i.key).join() === 'phrase:pick up,word:alpha',
  buildQueueFromItems(items, { newLimit: 20 }).fresh.map(i => i.key).join())
t('新卡上限 newLimit=1 生效', queue.fresh.length === 1 && queue.fresh[0].key === 'phrase:pick up')
t('未到期的 Gamma 不进任何队列',
  !queue.due.some(i => i.refKey === 'gamma') && !queue.fresh.some(i => i.refKey === 'gamma'))

const full = buildQueueFromItems(items, { newLimit: 20 })
t('newLimit 放宽后 fresh 全量', full.fresh.length === 2)
t('nextDueFromItems 取最早到期时间', nextDueFromItems(items)?.getTime() === new Date(pastCard.due).getTime())
t('nextDueFromItems 只看有 due 的 item（含未来到期）',
  nextDueFromItems([{ key: 'x', refKind: 'word', refKey: 'x', srs: futureCard, content: { definitions: ['x'] } }])?.getTime() === new Date(futureCard.due).getTime())

console.log('\n[recordStore — 词组首错落卡 / wrong 记录]')
{
  const store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    key: i => [...store.keys()][i] ?? null,
    get length() { return store.size }
  }
  const recordStore = await import('./src/sync/recordStore.js')
  const refKey = 'Turn Out'
  const normalized = normalizePhraseKey(refKey)
  const cardId = phraseCardId(refKey)
  const due = phraseDueTomorrowIso(new Date(2026, 9, 15, 10, 0, 0))
  const now = '2026-10-15T10:00:00.000Z'
  const card = recordStore.putRecord('card', {
    refKind: 'phrase',
    refKey: normalized,
    srs: { ...createCard(), due },
    createdAt: now,
    updatedAt: now
  }, { id: cardId })
  t('词组 card 以确定性 id 落盘', !!card && card.id === cardId && !!recordStore.loadRecordsMap()['card:' + cardId])
  const cardRec = recordStore.loadRecordsMap()['card:' + cardId]
  t('card 白名单保存 refKind/refKey/srs', cardRec?.refKind === 'phrase' && cardRec?.refKey === 'turn out' && !!cardRec?.srs?.due)
  t('card due 保持次日本地 00:00', cardRec?.srs?.due === due, `${cardRec?.srs?.due} != ${due}`)
  t('card 写入即标脏（等同步推上去）', recordStore.loadRecordDirty().includes('card:' + cardId))

  const wrong = recordStore.putRecord('wrong', {
    type: 'phraseCloze',
    refKey,
    yourAnswer: 'call out',
    rightAnswer: 'turn out',
    createdAt: now,
    updatedAt: now
  })
  t('词组 wrong 记录落盘', !!wrong && !!recordStore.loadRecordsMap()['wrong:' + wrong.id])
  const wrongRec = recordStore.loadRecordsMap()['wrong:' + wrong.id]
  t('wrong 记录字段完整且无多余字段',
    wrongRec && Object.keys(wrongRec).sort().join() === 'createdAt,refKey,rightAnswer,schema_version,type,updatedAt,yourAnswer',
    wrongRec && Object.keys(wrongRec).sort().join())
  t('wrong 记录同样标脏', recordStore.loadRecordDirty().includes('wrong:' + wrong.id))
  delete globalThis.localStorage
}

console.log(`\n═══ 结果: ${pass} 通过, ${fail} 失败 ═══`)
process.exit(fail ? 1 : 0)
