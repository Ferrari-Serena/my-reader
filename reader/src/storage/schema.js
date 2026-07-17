/**
 * 生词本数据 schema：版本、空结构、迁移链、条目校验。
 * 版本升级规则：只在 migrate() 里加 case，绝不改旧版本的写入逻辑。
 */

export const SCHEMA_VERSION = 1

export function emptyVocab() {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    words: {}
  }
}

/** 条目字段白名单：导入外部 JSON 时剪裁掉未知字段，防污染 */
const ENTRY_FIELDS = ['word', 'bookId', 'chapterId', 'addedAt', 'snapshot', 'srs', 'quiz']
const SNAPSHOT_FIELDS = ['lemma', 'phonetic', 'partOfSpeech', 'definitions', 'audioUrl', 'level', 'chapters']

export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.word !== 'string') return null
  const entry = {}
  for (const f of ENTRY_FIELDS) entry[f] = raw[f] ?? null
  entry.word = raw.word.toLowerCase()
  entry.addedAt = typeof raw.addedAt === 'string' ? raw.addedAt : new Date().toISOString()
  const snap = raw.snapshot && typeof raw.snapshot === 'object' ? raw.snapshot : {}
  entry.snapshot = {}
  for (const f of SNAPSHOT_FIELDS) entry.snapshot[f] = snap[f] ?? (f === 'definitions' || f === 'chapters' ? [] : '')
  // 类型收紧：导入的脏数据不能崩渲染
  if (typeof entry.snapshot.level !== 'string') entry.snapshot.level = null
  entry.snapshot.definitions = Array.isArray(entry.snapshot.definitions)
    ? entry.snapshot.definitions.filter(d => typeof d === 'string')
    : []
  entry.snapshot.chapters = Array.isArray(entry.snapshot.chapters)
    ? entry.snapshot.chapters.filter(c => typeof c === 'string')
    : []
  for (const f of ['lemma', 'phonetic', 'partOfSpeech', 'audioUrl']) {
    if (typeof entry.snapshot[f] !== 'string') entry.snapshot[f] = ''
  }
  return entry
}

/**
 * 把任意历史版本的数据升级到当前版本。
 * 输入非法时返回 null（调用方决定回退到 emptyVocab）。
 */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.words !== 'object' || raw.words === null) {
    return null
  }
  let data = raw
  switch (data.version) {
    case SCHEMA_VERSION:
      break
    // case 1: → 2 时在此处补 FSRS 卡片（7.2 实现）
    default:
      return null // 未知版本（比当前还新的数据不降级处理）
  }

  // 逐条目校验剪裁（跳过原型污染 key）
  const words = {}
  for (const [key, val] of Object.entries(data.words)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const entry = sanitizeEntry(val)
    if (entry) words[key.toLowerCase()] = entry
  }
  return { version: SCHEMA_VERSION, updatedAt: data.updatedAt || new Date().toISOString(), words }
}
