/**
 * 生词本单例状态（模块级 reactive，跨视图共享）。
 * 组件只调这里的方法，持久化细节全部在 storage 层。
 */

import { reactive, computed } from 'vue'
import * as storage from '../storage/index.js'
import { SCHEMA_VERSION, migrate } from '../storage/schema.js'
import { nowIso } from '../sync/clock.js'

const state = reactive({
  words: {},   // key: lemma 小写 → WordEntry
  loaded: false,
  persistFailed: false // localStorage 写失败标记（私有模式等），视图可提示一次
})

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

/**
 * 待推送的脏词集合。同步只推这些词，而不是每次变异都推全量词表——
 * 原来每答一道测验题就推一次全部词条，词表上千时那是上千条 upsert。
 *
 * 0.1：集合同时持久化一份到 localStorage。只活在内存里的话，「改了但没推出去」的
 * 改动会随关页一起消失（下次启动脏集合是空的，只有再改一次那个词才会重新标脏），
 * 这次编辑就永远不上云。恢复后由 useSync 在冷启动时补推一次。
 *
 * 清账时机（0.1 真机验收第二轮抓到）：脏集合**只读不取走**，推送成功后才用 clearDirty 落账。
 * 原来的「先取走清盘、失败再还回来」在 pagehide/关页那条路径上不成立——keepalive 请求刚
 * 发出去页面就被销毁，catch 里的「还回来」永远不会执行，欠推记录就此从盘上消失。
 */
let _dirty = new Set()
let _dirtyLoaded = false

/** 首次访问时把上次没推出去的脏词捞回来（惰性，避免模块加载期就碰 localStorage） */
function ensureDirtyLoaded() {
  if (_dirtyLoaded) return
  _dirtyLoaded = true
  for (const w of storage.loadDirtyWords()) _dirty.add(w)
}

/** 把内存里的脏集合覆盖写回 localStorage */
function persistDirty() {
  storage.saveDirtyWords([..._dirty])
}

function markDirty(...keys) {
  ensureDirtyLoaded()
  let added = false
  for (const k of keys) {
    if (typeof k !== 'string' || !k) continue
    const key = k.toLowerCase()
    if (!_dirty.has(key)) { _dirty.add(key); added = true }
  }
  // 只在真有新增时落盘：答题连点会反复标同一个词，没必要每次都写一遍
  if (added) persistDirty()
}

/**
 * 推送成功后落账：把这些词从脏集合划掉并落盘。
 * 只划掉本次**真推出去**的那些（keepalive 裁剪掉的由调用方排除），关页打断的不会被划掉。
 */
function clearDirty(keys) {
  ensureDirtyLoaded()
  let changed = false
  for (const k of keys || []) {
    if (typeof k !== 'string' || !k) continue
    if (_dirty.delete(k.toLowerCase())) changed = true
  }
  if (changed) persistDirty()
  return changed
}

/** 只读看一眼还有哪些词欠推（冷启动据此决定要不要补推、pushNow 据此取待推集合；都不删盘） */
function pendingDirty() {
  ensureDirtyLoaded()
  return [..._dirty]
}

/** 把当前所有词标脏（新建同步码时用：本机数据对远程来说全是新的） */
function markAllDirty() {
  ensureDirtyLoaded()
  for (const k of Object.keys(state.words)) _dirty.add(k)
  persistDirty()
}

async function init() {
  if (state.loaded) return
  const doc = await storage.loadVocabulary()
  // 浅拷贝切断与 adapter 内存文档的共享引用：
  // 若直接引用同一对象，adapter 先原始写入会让后续 proxy 写被 Vue 误判为 SET/无效 DELETE，
  // savedSet/count 等依赖 Object.keys 迭代的 computed 全部收不到通知
  state.words = { ...doc.words }
  state.loaded = true
  // 0.1：把上次没推出去的脏词捞回来（否则页面重开后它们永远不会被推）
  ensureDirtyLoaded()
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
    addedAt: nowIso(),
    snapshot: {
      lemma: snap.lemma || key,
      phonetic: snap.phonetic || '',
      partOfSpeech: snap.partOfSpeech || '',
      definitions: Array.isArray(snap.definitions) ? [...snap.definitions] : [],
      audioUrl: snap.audioUrl || '',
      level: snap.level ?? null,
      chapters: Array.isArray(snap.chapters) ? [...snap.chapters] : [],
      // 词条记住正文里它出现过的写法（词典 surfaces）：收藏态高亮要靠它
      surfaces: Array.isArray(snap.surfaces) ? [...snap.surfaces] : []
    },
    srs: null,  // 7.2 FSRS 槽位
    quiz: null,  // 7.3 槽位
    updatedAt: nowIso()
  }
  const ok = await storage.addWord(entry)
  if (!ok) state.persistFailed = true
  state.words[key] = entry
  markDirty(key)
  // 异步推送到远程（开新微任务，不阻塞 UI）
  Promise.resolve().then(() => _schedulePush())
}

async function remove(word) {
  await init()
  const key = word.toLowerCase()
  // 删除台账由 storage.removeWord 自动记下，同步时作为墓碑推出去
  const ok = await storage.removeWord(key)
  if (!ok) state.persistFailed = true
  delete state.words[key]
  Promise.resolve().then(() => _schedulePush())
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
    audioUrl: dictEntry.audioUrl || '',
    surfaces: Array.isArray(dictEntry.surfaces) && dictEntry.surfaces.length
      ? [...dictEntry.surfaces]
      : (entry.snapshot.surfaces || [])
  }
  const now = nowIso()
  await storage.updateWord(key, { snapshot, updatedAt: now })
  entry.snapshot = snapshot
  entry.updatedAt = now
  markDirty(key)
  Promise.resolve().then(() => _schedulePush())
}

async function clearAll() {
  // clearVocabulary 会给每个被清掉的词记墓碑，同步时作为删除推出去；
  // 以前这里根本没有推送调用，整本清空从来不会同步到别的设备
  const ok = await storage.clearVocabulary()
  if (!ok) state.persistFailed = true
  state.words = {}
  Promise.resolve().then(() => _schedulePush())
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
    q.wrongHistory.push({ date: nowIso(), questionType: questionType || '' })
  }
  const now = nowIso()
  const ok = await storage.updateWord(key, { quiz: q, updatedAt: now })
  if (!ok) state.persistFailed = true
  entry.quiz = q
  entry.updatedAt = now
  markDirty(key)
  // 每次答题都变异，但推送由 useSync 尾随防抖收拢，不再一题一推
  Promise.resolve().then(() => _schedulePush())
}

/** SRS 更新（FlashcardsView 调用，同步更新 localStorage + reactive state） */
async function updateSRS(word, srsCard) {
  await init()
  const key = word.toLowerCase()
  const entry = state.words[key]
  if (!entry) return false
  const now = nowIso()
  entry.srs = srsCard
  entry.updatedAt = now
  const ok = await storage.updateWord(key, { srs: srsCard, updatedAt: now })
  if (!ok) state.persistFailed = true
  markDirty(key)
  Promise.resolve().then(() => _schedulePush())
  return ok
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
  const before = new Set(Object.keys(state.words))
  const result = await storage.importVocabulary(data, 'merge')
  const doc = await storage.loadVocabulary()
  state.words = { ...doc.words } // 重新指向合并后的文档
  // 导入进来的词必须推给别的设备——以前这个函数里根本没有推送调用，
  // 「从文件导入生词本」是个纯本地动作，换台设备就没了
  const imported = Object.keys(state.words).filter(k => !before.has(k))
  if (imported.length) {
    markDirty(...imported)
    Promise.resolve().then(() => _schedulePush())
  }
  return result
}

// 懒加载 useSync（避免循环导入：useSync → useVocabulary → useSync）
let _pushCache = undefined
function _schedulePush() {
  if (_pushCache === undefined) {
    // 懒加载：只在第一次变异操作时 import
    import('./useSync.js').then(m => {
      _pushCache = m.useSync
      if (_pushCache) _pushCache().pushSoon()
    }).catch(() => { _pushCache = undefined }) // 失败保持 undefined，下次调用还能重试
  } else if (_pushCache) {
    // 走尾随防抖：连点答题不再一题一推，由 useSync 收拢成一次
    _pushCache().pushSoon()
  }
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
    updateSRS,
    clearAll,
    exportJSON,
    importJSON,
    // 同步层用来做「只推脏词」：useSync 取走脏集合，推送失败再还回来
    markDirty,
    clearDirty,
    markAllDirty,
    pendingDirty
  }
}
