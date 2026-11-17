/**
 * 数据导出的纯逻辑（笔记 + 卡片 → JSON）——UI-22（方案 #22，M3 前）。
 *
 * 边界：
 *   · 只导出「笔记」与「卡片」（生词条目，含 FSRS 状态），不含音频、不含书体；
 *   · 全部在本机生成，不上传；下载由浏览器 Blob 完成；
 *   · 字段走白名单，存储里的内部字段（脏标记、墓碑、同步码）一律不进文件。
 */

export const EXPORT_SCHEMA = 'my-reader-export/v1'
export const LAST_EXPORT_KEY = 'reader-last-export-at'

const NOTE_FIELDS = ['id', 'bookId', 'bookTitle', 'chapterId', 'paraId', 'charStart', 'charEnd', 'quote', 'text', 'color', 'createdAt', 'updatedAt']
const CARD_FIELDS = ['word', 'addedAt', 'updatedAt', 'bookId', 'chapterId']
const SRS_FIELDS = ['due', 'stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'reps', 'lapses', 'state', 'last_review']

function pick(obj, fields) {
  const out = {}
  if (!obj || typeof obj !== 'object') return out
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f]
  return out
}

export function noteRow(note) {
  const n = pick(note, NOTE_FIELDS)
  return n.id ? n : null
}

export function cardRow(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.word !== 'string' || !entry.word) return null
  const card = pick(entry, CARD_FIELDS)
  card.word = String(entry.word).toLowerCase()
  const snap = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot : null
  card.snapshot = snap ? pick(snap, ['lemma', 'phonetic', 'partOfSpeech', 'definitions', 'level']) : null
  // FSRS 状态：只认服务端/本地都用的形状；坏的当没有，不把垃圾写进导出文件
  const srs = entry.srs && typeof entry.srs === 'object' && typeof entry.srs.due === 'string' ? pick(entry.srs, SRS_FIELDS) : null
  card.srs = srs
  return card
}

/**
 * 组装导出文件。
 * @param {{notes?: Array, vocab?: {words?: object}|null, exportedAt?: string, app?: string}} input
 */
export function buildExport({ notes = [], vocab = null, exportedAt = new Date().toISOString(), app = 'my-reader' } = {}) {
  const noteRows = (Array.isArray(notes) ? notes : []).map(noteRow).filter(Boolean)
  const words = vocab && vocab.words && typeof vocab.words === 'object' && !Array.isArray(vocab.words) ? vocab.words : {}
  const cards = Object.values(words).map(cardRow).filter(Boolean)
  return {
    schema: EXPORT_SCHEMA,
    app,
    exportedAt,
    counts: { notes: noteRows.length, cards: cards.length },
    notes: noteRows,
    cards
  }
}

export function isEmptyExport(data) {
  const c = data && data.counts
  return !c || (c.notes + c.cards) === 0
}

const pad = (n) => String(n).padStart(2, '0')

/** `my-reader-export-20261117-1805.json`（本地时间） */
export function exportFileName(exportedAt) {
  const d = new Date(exportedAt)
  if (!Number.isFinite(d.getTime())) return 'my-reader-export.json'
  return 'my-reader-export-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json'
}

/** 「12 条笔记 · 48 张卡片」 */
export function exportCountsText(data) {
  const c = (data && data.counts) || { notes: 0, cards: 0 }
  return c.notes + ' 条笔记 · ' + c.cards + ' 张卡片'
}

/** 浏览器端：生成并触发下载（非浏览器环境返回 false，便于自测直接调用纯函数） */
export function downloadJson(filename, obj) {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => { try { URL.revokeObjectURL(url) } catch {} }, 0)
  return true
}
