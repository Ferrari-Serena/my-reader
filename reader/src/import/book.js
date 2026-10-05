/**
 * 导入产物的统一形状（第 5 步 5.3）。
 *
 * 目标形状与**现有静态书**的 chapters.json 一致 —— 这样阅读页读 BYO 书和读内置书
 * 走的是同一套渲染路径，不需要为 BYO 分叉：
 *   { bookId, title, author, chapters: [ { id: 'ch-01', title, paragraphs: [ { id: 'p-01-001', text } ] } ] }
 * annotatedWords 可有可无（ReaderView 用 `para.annotatedWords || []`），BYO 不产出。
 */
import { ImportError, IMPORT_LIMITS } from './errors.js'

export const MAX_FILE_MB = IMPORT_LIMITS.MAX_FILE_MB
export const MAX_FILE_BYTES = IMPORT_LIMITS.MAX_FILE_BYTES

/** 现有 6 本内置书都是 slug；BYO 用内容指纹（bk_ 开头），两者靠形状区分。 */

const pad = (n, width) => String(n).padStart(width, '0')

/** 'ch-01'；超过 99 章自然变 3 位（'ch-100'），不截断、不重号 */
export function chapterId(n) {
  return `ch-${pad(n, Math.max(2, String(n).length))}`
}

/** 'p-01-001'（与内置书同形）；单章段落超过 999 时自然加宽 */
export function paragraphId(chapterNo, paraNo) {
  return `p-${pad(chapterNo, 2)}-${pad(paraNo, 3)}`
}

function sniff(bytes) {
  if (!bytes || bytes.length < 4) return null
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  return null
}

/**
 * 认格式：先看扩展名，再用 magic bytes 兜底。
 * 扩展名与内容打架（.pdf 里装着 zip）时返回 null —— 宁可报「不支持」，
 * 也不要拿错解析器去啃，那样报出来的错会驴唇不对马嘴。
 */
export function formatOf({ name, bytes } = {}) {
  const ext = (String(name || '').match(/\.([a-z0-9]+)$/i) || [])[1]
  const e = (ext || '').toLowerCase()
  const magic = sniff(bytes)
  if (e === 'pdf') return magic === 'zip' ? null : 'pdf'
  if (e === 'epub') return magic === 'pdf' ? null : 'epub'
  if (e === 'txt' || e === 'text') return 'txt'
  if (magic === 'pdf') return 'pdf'
  if (magic === 'zip') return 'epub'
  return null
}

export const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()

/**
 * 唯一的出口：净化 + 编号 + 称重。空段落/空章直接丢；
 * 全空 -> EMPTY_CONTENT（不产出半本空书）。
 */
export function makeBook({ bookId = '', title = '', author = '', chapters = [] } = {}) {
  const cleaned = []
  for (const ch of Array.isArray(chapters) ? chapters : []) {
    const paras = (Array.isArray(ch?.paragraphs) ? ch.paragraphs : [])
      .map(p => collapse(typeof p === 'string' ? p : p?.text))
      .filter(Boolean)
    if (!paras.length) continue
    cleaned.push({ title: collapse(ch?.title), paragraphs: paras })
  }
  if (!cleaned.length) throw new ImportError('EMPTY_CONTENT')

  let paragraphCount = 0
  let charCount = 0
  const out = cleaned.map((c, ci) => {
    const paragraphs = c.paragraphs.map((text, pi) => {
      paragraphCount++
      charCount += text.length
      return { id: paragraphId(ci + 1, pi + 1), text }
    })
    return { id: chapterId(ci + 1), title: c.title || `Chapter ${ci + 1}`, paragraphs }
  })

  return {
    bookId,
    title: collapse(title) || out[0].title || 'Untitled',
    author: collapse(author),
    chapters: out,
    chapterCount: out.length,
    paragraphCount,
    charCount,
  }
}
