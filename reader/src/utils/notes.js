/**
 * 第 9 步 9.2「划线笔记」的纯逻辑：锚点模型、词级对齐、漂移判读、颜色域。
 *
 * 锚点 = {paraId, charStart, charEnd}，charStart/End 是**段内字符偏移**（对 para.text 而言）。
 * 另存一段 quote（选中原文）：重解析后偏移会漂，靠引文才能判定
 * 「是同一处（自动重锚）」还是「已经对不上了（降级，不静默错位）」（盲点 B22）。
 *
 * 纯逻辑（不 import Vue / storage / DOM），可直接在 Node 里断言。
 * 真的落盘与同步走记录通道的 note 记录（composables/useNotes.js），与生词/设置同一套。
 */

export const NOTE_COLORS = Object.freeze(['yellow', 'green', 'blue', 'pink'])
export const DEFAULT_NOTE_COLOR = 'yellow'

export function isNoteColor(c) { return NOTE_COLORS.indexOf(c) >= 0 }

export function noteKey(id) { return 'note:' + id }
export function noteIdFromKey(key) {
  return typeof key === 'string' && key.slice(0, 5) === 'note:' ? key.slice(5) : null
}

const asStr = v => (typeof v === 'string' ? v : '')
const isInt = v => typeof v === 'number' && Number.isFinite(v) && Math.floor(v) === v

/**
 * 按渲染用的同一套分词切出每个 token 的字符区间（与 text.split(/(\s+)/) 下标一一对应）。
 * 空白 token 位置留 null —— 下标必须对齐，否则词标注会串位。
 */
export function tokenSpans(text) {
  const out = []
  let off = 0
  for (const tok of String(text == null ? '' : text).split(/(\s+)/)) {
    out.push(/\S/.test(tok) ? { start: off, end: off + tok.length } : null)
    off += tok.length
  }
  return out
}

/**
 * 把 [a,b) 向外扩到词边界（词级对齐）。
 * 存的就是所见：渲染时只需判断「这个词与范围相交吗」。
 * 一个词都没碰上返回 null。
 */
export function snapToWords(text, a, b) {
  if (typeof text !== 'string' || !isInt(a) || !isInt(b) || a >= b) return null
  let start = -1
  let end = -1
  for (const s of tokenSpans(text)) {
    if (!s || s.end <= a || s.start >= b) continue
    if (start < 0) start = s.start
    end = s.end
  }
  return start < 0 ? null : { start, end }
}

/** 两区间是否相交 */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

/**
 * 段落文本 + 笔记 -> 锚点判读（9.5）。
 *   ok    精确命中（偏移落界内且引文一致）
 *   moved 偏移漂了，但引文还在本段 -> 自动重锚（标注「已跟随重解析」）
 *   lost  引文都没了 -> 降级为段落级，由上层标记（绝不静默错位）
 * 没有 quote 的老记录退化为「界内即信」。
 */
export function resolveAnchor(paraText, note) {
  if (typeof paraText !== 'string') return { kind: 'lost', why: 'no-paragraph' }
  const s = note && note.charStart
  const e = note && note.charEnd
  const quote = asStr(note && note.quote)
  const inBounds = isInt(s) && isInt(e) && s >= 0 && s < e && e <= paraText.length
  if (quote) {
    if (inBounds && paraText.slice(s, e) === quote) return { kind: 'ok', start: s, end: e }
    const hit = paraText.indexOf(quote)
    if (hit >= 0) return { kind: 'moved', start: hit, end: hit + quote.length }
    return { kind: 'lost', why: 'quote-gone' }
  }
  return inBounds ? { kind: 'ok', start: s, end: e } : { kind: 'lost', why: 'out-of-bounds' }
}

/** 一条 note 记录的净化读法（记录通道已剪过白名单，这里再挡一道脏值）；不合法返回 null */
export function normalizeNote(id, payload) {
  if (typeof id !== 'string' || !id) return null
  const p = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {}
  const anchor = (p.anchor && typeof p.anchor === 'object') ? p.anchor : {}
  const bookId = asStr(p.bookId)
  const chapterId = asStr(p.chapterId)
  const paraId = asStr(anchor.paraId)
  if (!bookId || !chapterId || !paraId) return null
  if (!isInt(anchor.charStart) || !isInt(anchor.charEnd) || anchor.charStart >= anchor.charEnd) return null
  return {
    id,
    bookId,
    bookTitle: asStr(p.bookTitle),
    chapterId,
    paraId,
    charStart: anchor.charStart,
    charEnd: anchor.charEnd,
    quote: asStr(p.quote),
    text: asStr(p.text),
    color: isNoteColor(p.color) ? p.color : DEFAULT_NOTE_COLOR,
    createdAt: asStr(p.createdAt),
    updatedAt: asStr(p.updatedAt)
  }
}

/** 归一化后的 note -> 记录载荷（写进 note 记录的就这些字段） */
export function toNotePayload(note) {
  return {
    bookId: asStr(note.bookId),
    bookTitle: asStr(note.bookTitle),
    chapterId: asStr(note.chapterId),
    anchor: {
      paraId: asStr(note.paraId),
      charStart: isInt(note.charStart) ? note.charStart : 0,
      charEnd: isInt(note.charEnd) ? note.charEnd : 0
    },
    quote: asStr(note.quote),
    text: asStr(note.text),
    color: isNoteColor(note.color) ? note.color : DEFAULT_NOTE_COLOR
  }
}

/**
 * 一条笔记在某本书的章表里的判读（列表面板用）：找到它所属章的该段，交给 resolveAnchor。
 * 章或段都找不到 -> lost（书换了版本 / 段被整段删掉）。
 */
export function noteStatus(chapters, note) {
  if (!note) return { kind: 'lost', why: 'no-note' }
  const list = Array.isArray(chapters) ? chapters : []
  const ch = list.find(c => c && typeof c === 'object' && c.id === note.chapterId)
  if (!ch || !Array.isArray(ch.paragraphs)) return { kind: 'lost', why: 'no-chapter' }
  const para = ch.paragraphs.find(pa => pa && pa.id === note.paraId)
  if (!para) return { kind: 'lost', why: 'no-paragraph' }
  return resolveAnchor(para.text, note)
}

/**
 * 把某本书的笔记按**章序**分组（供列表面板）：[{chapterId, title, notes:[...]}]。
 * 组内按段内位置排；章表里没有的章（换版本）排在最后，title 用 chapterId 兜底。
 */
export function groupNotesByChapter(notes, chapters) {
  const list = Array.isArray(chapters) ? chapters : []
  const order = new Map()
  const titles = new Map()
  list.forEach((c, i) => {
    if (c && typeof c === 'object' && typeof c.id === 'string') {
      order.set(c.id, i)
      titles.set(c.id, asStr(c.title))
    }
  })
  const byChapter = new Map()
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n) continue
    const key = asStr(n.chapterId)
    if (!byChapter.has(key)) byChapter.set(key, [])
    byChapter.get(key).push(n)
  }
  const rows = []
  for (const [key, arr] of byChapter) {
    arr.sort((a, b) => (a.paraId === b.paraId ? a.charStart - b.charStart : a.paraId < b.paraId ? -1 : 1))
    rows.push({ chapterId: key, title: titles.get(key) || key, notes: arr, idx: order.has(key) ? order.get(key) : Number.MAX_SAFE_INTEGER })
  }
  rows.sort((a, b) => a.idx - b.idx)
  return rows.map(({ chapterId, title, notes: ns }) => ({ chapterId, title, notes: ns }))
}
