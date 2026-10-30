/**
 * 第 11 步「训练闭环」块 A：统一复习适配器（纯函数，无 Vue / storage / fetch）。
 *
 * 复习队列里现在有两种来源：
 *   - 单词：useVocabulary.words 的 WordEntry（srs 在词条内）
 *   - 词组：recordStore 的 card 记录（refKind='phrase'，srs 在记录内）
 * 本模块把两者归一化成同一个 item 形状，fsrs.buildQueueFromItems 只认这个形状。
 */

import { CARD_SCHEMA_VERSION } from './storage/schema.js'

export const REF_KIND_WORD = 'word'
export const REF_KIND_PHRASE = 'phrase'

/** 词组键统一成小写 + 单空格，避免 "Turn  Out" 与 "turn out" 被当成两条记录 */
export function normalizePhraseKey(text) {
  if (typeof text !== 'string') return ''
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 词组卡片的确定性记录 id：同一词组只 upsert 一条 card 记录 */
export function phraseCardId(refKey) {
  const key = normalizePhraseKey(refKey)
  if (!key) return ''
  return `card_${REF_KIND_PHRASE}_${encodeURIComponent(key)}`
}

/** 词组首错 due：次日本地 00:00 的 ISO 串（不随答题时刻漂移） */
export function phraseDueTomorrowIso(from = new Date()) {
  const d = from instanceof Date ? new Date(from.getTime()) : new Date(from)
  if (Number.isNaN(d.getTime())) return null
  d.setHours(24, 0, 0, 0)
  return d.toISOString()
}

/**
 * 词组卡的记录工厂（W-08 D-1／D-2，2026-10-31）。
 * 抽出这个纯函数是为了让「卡里有 schemaVersion 与来源锚」可被机器断言——
 * 原先这段形状写在 QuizView 里，只能靠读源码断言。
 * bookId／chapterId 默认 null：词组题目前没有书本来源（题干来自词典）。
 */
export function makePhraseCard({ refKey, srs, now, bookId = null, chapterId = null } = {}) {
  const key = normalizePhraseKey(refKey)
  if (!key) return null
  return {
    refKind: REF_KIND_PHRASE,
    refKey: key,
    schemaVersion: CARD_SCHEMA_VERSION,
    bookId: bookId ?? null,
    chapterId: chapterId ?? null,
    srs: srs || null,
    createdAt: now || '',
    updatedAt: now || '',
  }
}

/** 单词词条 -> review item；无释义（离线空快照）不进入复习队列 */
export function wordReviewItem(entry) {
  const word = entry?.word ? String(entry.word).toLowerCase() : ''
  const definitions = Array.isArray(entry?.snapshot?.definitions) ? entry.snapshot.definitions : []
  if (!word || !definitions.length) return null
  return {
    key: `${REF_KIND_WORD}:${word}`,
    refKind: REF_KIND_WORD,
    refKey: word,
    srs: entry.srs || null,
    addedAt: typeof entry.addedAt === 'string' ? entry.addedAt : '',
    content: {
      text: entry.snapshot.lemma || word,
      phonetic: entry.snapshot.phonetic || '',
      partOfSpeech: entry.snapshot.partOfSpeech || '',
      definitions: [...definitions]
    }
  }
}

/** 词组 card 记录 -> review item；词典里找不到或没释义就不进复习队列 */
export function phraseReviewItem(payload, phraseEntry) {
  const refKey = normalizePhraseKey(payload?.refKey)
  const definitions = Array.isArray(phraseEntry?.defs) ? phraseEntry.defs : []
  if (!refKey || !definitions.length) return null
  return {
    key: `${REF_KIND_PHRASE}:${refKey}`,
    refKind: REF_KIND_PHRASE,
    refKey,
    srs: payload?.srs || null,
    addedAt: typeof payload?.createdAt === 'string' ? payload.createdAt : '',
    content: {
      text: refKey,
      partOfSpeech: phraseEntry.pos || '',
      definitions: [...definitions]
    }
  }
}

function recordLww(payload) {
  if (!payload || typeof payload !== 'object') return ''
  if (typeof payload.updatedAt === 'string' && payload.updatedAt) return payload.updatedAt
  if (typeof payload.createdAt === 'string' && payload.createdAt) return payload.createdAt
  return ''
}

/**
 * 汇总当前复习池：
 *   words          生词本（key → WordEntry）
 *   phraseRecords  记录通道本地表 {'card:<id>': payload}
 *   phraseEntries  词组词典（key → { defs, pos, verb, particle, forms }）
 *
 * 词组记录按 refKey 去重，同名记录取 LWW 最新的一条，避免历史 UUID 卡造成重复复习。
 */
export function collectReviewItems(words, phraseRecords, phraseEntries) {
  const items = []
  for (const entry of Object.values(words || {})) {
    const item = wordReviewItem(entry)
    if (item) items.push(item)
  }

  const best = new Map()
  for (const payload of Object.values(phraseRecords || {})) {
    if (!payload || payload.refKind !== REF_KIND_PHRASE) continue
    const refKey = normalizePhraseKey(payload.refKey)
    if (!refKey) continue
    const prev = best.get(refKey)
    if (!prev || recordLww(payload) > recordLww(prev)) best.set(refKey, payload)
  }

  const entries = phraseEntries || {}
  for (const [refKey, payload] of best) {
    const item = phraseReviewItem(payload, entries[refKey])
    if (item) items.push(item)
  }
  return items
}
