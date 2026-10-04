/**
 * localStorage 适配器 —— 项目里唯一直接读写用户数据存储的地方。
 * 产品化时新建 apiAdapter.js 实现同一组接口，storage/index.js 换出口即可。
 */

import { emptyVocab, migrate, sanitizeEntry } from './schema.js'

const KEY = 'reader-vocab-v1'
const TOMB_KEY = 'reader-vocab-tombstones'

let doc = null // 内存文档，首次 load 时填充

function persist() {
  doc.updatedAt = new Date().toISOString()
  try {
    localStorage.setItem(KEY, JSON.stringify(doc))
    return true
  } catch {
    return false // 配额满 / 私有模式；调用方决定是否提示
  }
}

// ── 删除台账 ──────────────────────────────────────────────
// 服务端没有「删除」这个动作可推——它只能推一条墓碑。台账记下「哪个词在什么时候被删」，
// 由 useSync 在下次推送时带上。写在 removeWord 里是为了让所有删除路径都自动记账，
// 调用方一行都不用改；addWord 反向清账，于是「删了又加」天然变成一次复活。

function readTombstones() {
  try {
    const raw = localStorage.getItem(TOMB_KEY)
    const obj = raw ? JSON.parse(raw) : null
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch {
    return {}
  }
}

function writeTombstones(map) {
  try {
    localStorage.setItem(TOMB_KEY, JSON.stringify(map))
    return true
  } catch {
    return false
  }
}

/** 当前待推送的删除台账（同步层读它） */
export function loadTombstones() {
  return readTombstones()
}

/** 清除指定词的墓碑（远程墓碑已应用、或该词被重新收藏时调用） */
export function clearTombstones(words) {
  const map = readTombstones()
  let changed = false
  for (const w of words) {
    const k = (w + '').toLowerCase()
    if (k in map) { delete map[k]; changed = true }
  }
  if (changed) writeTombstones(map)
}

/**
 * 把外来墓碑并入本地台账（备份回导用）。
 * 同词取**较晚**的时间戳；**绝不删除本地已有的墓碑** ——
 * 那是本机还没推出去的删除，被或写掉就会被服务器的旧存活条目静默复活。
 * @returns {number} 实际并入 / 更新的条数
 */
export function mergeTombstones(incoming) {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return 0
  const tombs = readTombstones()
  let n = 0
  for (const [word, ts] of Object.entries(incoming)) {
    if (word === '__proto__' || word === 'constructor' || word === 'prototype') continue
    const key = (word + '').toLowerCase()
    if (!key || typeof ts !== 'string' || !ts) continue
    const cur = tombs[key]
    if (cur && !(ts > cur)) continue // 本地已有同刻或更新的墓碑，不动
    tombs[key] = ts
    n++
  }
  if (n) writeTombstones(tombs)
  return n
}

// ── 待推送脏词集合（0.1） ──────────────────────────────────
// 与删除台账同理：脏集合以前只活在内存里，页面一关就没了。于是「改了但没推出去」的
// 改动会随关页一起消失 —— 下次启动脏集合是空的，只有再次修改那个词才会重新标脏，
// 这次编辑就**永远不上云**。离线改词、keepalive 载荷被裁、关页打断 in-flight 推送，
// 都会踩到这个坑（见 sync/budget.js 里那段的说明）。
// 第二层（0.1 真机验收）：落盘必须「推送成功才清账」，否则关页打断推送时清盘已发生、
// 恢复却永远不会执行。见 useVocabulary 的 clearDirty。

const DIRTY_KEY = 'reader-vocab-dirty'

/** 恢复上次没推出去的脏词（小写、去重已在写入侧保证） */
export function loadDirtyWords() {
  try {
    const raw = localStorage.getItem(DIRTY_KEY)
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr.filter(w => typeof w === 'string' && w) : []
  } catch {
    return []
  }
}

/** 覆盖写脏集合；空集合顺手删掉 key，不留 `[]` 垃圾 */
export function saveDirtyWords(words) {
  try {
    const arr = [...new Set((words || []).map(w => (w + '').toLowerCase()).filter(Boolean))]
    if (arr.length) localStorage.setItem(DIRTY_KEY, JSON.stringify(arr))
    else localStorage.removeItem(DIRTY_KEY)
    return true
  } catch {
    return false // 配额满 / 私有模式：退回「只活在内存里」的旧行为，不影响主流程
  }
}

export async function loadVocabulary() {
  if (doc) return doc
  try {
    const raw = localStorage.getItem(KEY)
    doc = raw ? (migrate(JSON.parse(raw)) || emptyVocab()) : emptyVocab()
  } catch {
    doc = emptyVocab() // JSON 损坏等一律回退空结构，不抛给上层
  }
  return doc
}

/**
 * 把一个词从墓碑台账里划掉，并返回它应当使用的时间戳。
 * 若词此前被删过，这次写入就是一次「复活」：服务端拿墓碑时刻与本次时间戳比较，
 * 并列（同毫秒）会判为不占优而拒收，所以必须严格晚于墓碑时刻。
 */
function retireTombstone(tombs, word, updatedAt) {
  const tombTs = tombs[word]
  if (!tombTs) return { updatedAt, changed: false }
  delete tombs[word]
  const t = Date.parse(tombTs)
  if (Number.isFinite(t) && !(updatedAt > tombTs)) {
    return { updatedAt: new Date(t + 1).toISOString(), changed: true }
  }
  return { updatedAt, changed: true }
}

export async function addWord(entry) {
  await loadVocabulary()
  const clean = sanitizeEntry(entry)
  if (!clean) return false
  const tombs = readTombstones()
  const r = retireTombstone(tombs, clean.word, clean.updatedAt)
  clean.updatedAt = r.updatedAt
  if (r.changed) writeTombstones(tombs)
  doc.words[clean.word] = clean
  return persist()
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.record] 是否记删除台账。默认 true——用户主动删词时必须记，
 *   否则别的设备下次拉取会把词带回来。应用**远程**墓碑时传 false：
 *   那个删除已经在服务端了，本地再记一条只会推回去，而并列时间戳会被服务端拒收，
 *   白白触发一轮「有拒收就重新拉」。
 */
export async function removeWord(word, opts = {}) {
  await loadVocabulary()
  const key = (word + '').toLowerCase()
  delete doc.words[key]
  if (opts.record !== false) {
    const tombs = readTombstones()
    tombs[key] = new Date().toISOString()
    writeTombstones(tombs)
  }
  return persist()
}

/**
 * 批量写入：语义与逐条 addWord 完全一致（净化 + 复活台账），只在最后落盘一次。
 * mergeAndApply 一次合并可能写进上千条，而逐条 addWord 每条都 persist()——
 * 每次 persist 都把**整张词表** JSON.stringify 一遍，加起来就是 O(N²)。
 * 返回 {word: 净化后条目}：调用方直接拿这份更新响应式状态，不必再逐条
 * loadVocabulary() 回读（doc 就在内存里，那几行纯粹是白跑）。
 */
export async function addWords(entries) {
  await loadVocabulary()
  const applied = {}
  const tombs = readTombstones()
  let tombChanged = false
  for (const raw of entries || []) {
    const clean = sanitizeEntry(raw)
    if (!clean) continue
    const r = retireTombstone(tombs, clean.word, clean.updatedAt)
    clean.updatedAt = r.updatedAt
    tombChanged = tombChanged || r.changed
    doc.words[clean.word] = clean
    applied[clean.word] = clean
  }
  if (tombChanged) writeTombstones(tombs)
  if (Object.keys(applied).length) persist()
  return applied
}

/**
 * 批量删除：语义与逐条 removeWord 一致（词不在词表里也照记台账），同样只在最后落盘一次。
 * 应用**远程**墓碑时传 { record: false }——理由见 removeWord 的注释。
 */
export async function removeWords(words, opts = {}) {
  await loadVocabulary()
  const list = (words || []).map(w => (w + '').toLowerCase())
  if (!list.length) return false
  const tombs = opts.record === false ? null : readTombstones()
  const ts = new Date().toISOString()
  for (const key of list) {
    delete doc.words[key]
    if (tombs) tombs[key] = ts
  }
  if (tombs) writeTombstones(tombs)
  return persist()
}

export async function updateWord(word, patch) {
  await loadVocabulary()
  const key = word.toLowerCase()
  const prev = doc.words[key]
  if (!prev) return false
  // 这里也要过 sanitizeEntry：addWord 会净化而 updateWord 不会的话，
  // 同一个存储层就有两条口径，补丁里的任意字段都能绕过白名单落盘
  const clean = sanitizeEntry({ ...prev, ...patch })
  if (!clean) return false
  doc.words[key] = clean
  return persist()
}

export async function clearVocabulary() {
  await loadVocabulary()
  const ts = new Date().toISOString()
  const tombs = readTombstones()
  for (const k of Object.keys(doc.words)) tombs[k] = ts
  writeTombstones(tombs)
  doc = emptyVocab()
  return persist()
}

/**
 * 导入：merge 模式跳过已存在词（保护本地学习记录），replace 模式整体替换。
 * data 需已经过 migrate 校验。
 */
export async function importVocabulary(data, mode = 'merge') {
  await loadVocabulary()
  let added = 0
  let skipped = 0
  if (mode === 'replace') {
    // 被替换掉的词必须留墓碑，否则别的设备下次 pull 会把它们原样带回来
    const ts = new Date().toISOString()
    const tombs = readTombstones()
    for (const k of Object.keys(doc.words)) {
      if (!data.words[k]) tombs[k] = ts
    }
    writeTombstones(tombs)
    doc = { ...data }
    added = Object.keys(data.words).length
  } else {
    const tombs = readTombstones()
    let tombChanged = false
    for (const [key, entry] of Object.entries(data.words)) {
      if (doc.words[key]) { skipped++; continue }
      const clean = sanitizeEntry(entry)
      if (!clean) { skipped++; continue }
      // 导入进来的词若此前被删过，同样算一次复活
      const r = retireTombstone(tombs, clean.word, clean.updatedAt)
      clean.updatedAt = r.updatedAt
      tombChanged = tombChanged || r.changed
      doc.words[clean.word] = clean
      added++
    }
    if (tombChanged) writeTombstones(tombs)
  }
  persist()
  return { added, skipped }
}

/** 跨设备同步预留：产品化阶段由 apiAdapter 实现增量同步，本地适配器为 no-op */
export async function sync() {}
