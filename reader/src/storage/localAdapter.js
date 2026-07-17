/**
 * localStorage 适配器 —— 项目里唯一直接读写用户数据存储的地方。
 * 产品化时新建 apiAdapter.js 实现同一组接口，storage/index.js 换出口即可。
 */

import { emptyVocab, migrate, sanitizeEntry } from './schema.js'

const KEY = 'reader-vocab-v1'

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

export async function addWord(entry) {
  await loadVocabulary()
  const clean = sanitizeEntry(entry)
  if (!clean) return false
  doc.words[clean.word] = clean
  return persist()
}

export async function removeWord(word) {
  await loadVocabulary()
  delete doc.words[word.toLowerCase()]
  return persist()
}

export async function updateWord(word, patch) {
  await loadVocabulary()
  const key = word.toLowerCase()
  if (!doc.words[key]) return false
  doc.words[key] = { ...doc.words[key], ...patch }
  return persist()
}

export async function clearVocabulary() {
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
    doc = { ...data }
    added = Object.keys(data.words).length
  } else {
    for (const [key, entry] of Object.entries(data.words)) {
      if (doc.words[key]) { skipped++; continue }
      doc.words[key] = entry
      added++
    }
  }
  persist()
  return { added, skipped }
}

/** 跨设备同步预留：产品化阶段由 apiAdapter 实现增量同步，本地适配器为 no-op */
export async function sync() {}
