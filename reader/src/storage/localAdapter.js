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
