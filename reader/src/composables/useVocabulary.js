/**
 * 生词本单例状态（模块级 reactive，跨视图共享）。
 * 组件只调这里的方法，持久化细节全部在 storage 层。
 */

import { reactive, computed } from 'vue'
import * as storage from '../storage/index.js'
import { SCHEMA_VERSION, migrate } from '../storage/schema.js'

const state = reactive({
  words: {},   // key: lemma 小写 → WordEntry
  loaded: false,
  persistFailed: false // localStorage 写失败标记（私有模式等），视图可提示一次
})

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

async function init() {
  if (state.loaded) return
  const doc = await storage.loadVocabulary()
  // 浅拷贝切断与 adapter 内存文档的共享引用：
  // 若直接引用同一对象，adapter 先原始写入会让后续 proxy 写被 Vue 误判为 SET/无效 DELETE，
  // savedSet/count 等依赖 Object.keys 迭代的 computed 全部收不到通知
  state.words = { ...doc.words }
  state.loaded = true
}

function entryKey(word, dictEntry) {
  return ((dictEntry?.lemma || word) + '').toLowerCase()
}

async function add({ word, dictEntry, bookId, chapterId }) {
  await init()
  const key = entryKey(word, dictEntry)
  const snap = dictEntry || {}
  const entry = {
    word: key,
    bookId: bookId || null,
    chapterId: chapterId || null,
    addedAt: new Date().toISOString(),
    snapshot: {
      lemma: snap.lemma || key,
      phonetic: snap.phonetic || '',
      partOfSpeech: snap.partOfSpeech || '',
      definitions: Array.isArray(snap.definitions) ? [...snap.definitions] : [],
      audioUrl: snap.audioUrl || '',
      level: snap.level ?? null,
      chapters: Array.isArray(snap.chapters) ? [...snap.chapters] : []
    },
    srs: null,  // 7.2 FSRS 槽位
    quiz: null  // 7.3 槽位
  }
  const ok = await storage.addWord(entry)
  if (!ok) state.persistFailed = true
  state.words[key] = entry
}

async function remove(word) {
  await init()
  const key = word.toLowerCase()
  const ok = await storage.removeWord(key)
  if (!ok) state.persistFailed = true
  delete state.words[key]
}

/** 在线释义到达后补全空快照（离线收藏自愈）。
 * key 双查：离线收藏时 key 可能是表面词（went），在线 lemma 是 go —— 两个都试 */
async function refreshSnapshot(word, dictEntry) {
  await init()
  const byLemma = entryKey(word, dictEntry)
  const bySurface = (word + '').toLowerCase()
  const key = state.words[byLemma] ? byLemma : (state.words[bySurface] ? bySurface : null)
  if (!key) return
  const entry = state.words[key]
  if (entry.snapshot.definitions.length > 0 || !dictEntry?.definitions?.length) return
  const snapshot = {
    ...entry.snapshot,
    lemma: dictEntry.lemma || entry.snapshot.lemma,
    phonetic: dictEntry.phonetic || '',
    partOfSpeech: dictEntry.partOfSpeech || '',
    definitions: [...dictEntry.definitions],
    audioUrl: dictEntry.audioUrl || ''
  }
  await storage.updateWord(key, { snapshot })
  entry.snapshot = snapshot
}

async function clearAll() {
  const ok = await storage.clearVocabulary()
  if (!ok) state.persistFailed = true
  state.words = {}
}

/**
 * 测验答题记录（quiz 槽位 lazy-init）。
 * 错题池是派生视图：wrongHistory 非空 且 correctStreak < 3。
 * 任何测验中的答对都计入 streak；连对 3 次自动"出池"（派生条件不再满足）。
 */
async function recordQuizAnswer(word, correct, questionType) {
  await init()
  const key = (word + '').toLowerCase()
  const entry = state.words[key]
  if (!entry) return
  const q = entry.quiz && typeof entry.quiz === 'object'
    ? entry.quiz
    : { wrongHistory: [], correctStreak: 0, totalAttempts: 0, totalCorrect: 0 }
  q.totalAttempts++
  if (correct) {
    q.totalCorrect++
    q.correctStreak++
  } else {
    q.correctStreak = 0
    q.wrongHistory.push({ date: new Date().toISOString(), questionType: questionType || '' })
  }
  const ok = await storage.updateWord(key, { quiz: q })
  if (!ok) state.persistFailed = true
  entry.quiz = q
}

/** 错题池：答错过且尚未连对 3 次的词 */
function inErrorPool(entry) {
  return !!(entry.quiz && entry.quiz.wrongHistory.length > 0 && entry.quiz.correctStreak < 3)
}

async function exportJSON() {
  await init()
  return {
    app: 'my-reader',
    type: 'vocabulary',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: { version: SCHEMA_VERSION, updatedAt: new Date().toISOString(), words: { ...state.words } }
  }
}

/** 返回 { added, skipped }；文件非法时 throw Error（视图 catch 后提示） */
async function importJSON(file) {
  await init()
  if (file.size > MAX_IMPORT_BYTES) throw new Error('File too large (max 5 MB)')
  const text = await file.text()
  const envelope = JSON.parse(text) // 非法 JSON 直接 throw
  if (envelope?.type !== 'vocabulary' || typeof envelope?.data !== 'object') {
    throw new Error('Not a my-reader vocabulary file')
  }
  const data = migrate(envelope.data)
  if (!data) throw new Error('Unrecognized data version')
  const result = await storage.importVocabulary(data, 'merge')
  const doc = await storage.loadVocabulary()
  state.words = { ...doc.words } // 重新指向合并后的文档
  return result
}

export function useVocabulary() {
  return {
    words: computed(() => state.words),
    count: computed(() => Object.keys(state.words).length),
    savedSet: computed(() => new Set(Object.keys(state.words))),
    persistFailed: computed(() => state.persistFailed),
    errorPool: computed(() => Object.values(state.words).filter(inErrorPool)),
    has: (word) => !!state.words[(word + '').toLowerCase()],
    init,
    add,
    remove,
    refreshSnapshot,
    recordQuizAnswer,
    clearAll,
    exportJSON,
    importJSON
  }
}
