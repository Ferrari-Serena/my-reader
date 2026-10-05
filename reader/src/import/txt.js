/**
 * TXT 导入（第 5 步 5.1）。
 *
 * 两件事：① 认出编码（BOM -> UTF-8 -> GBK，逐级退让）；② 切段切章。
 * 切章是启发式，说明写在 isChapterHeading 上 —— 纯文本没有结构信息，
 * 只能靠「短行 + 像标题」这类形状去猜，猜错也只是章节分得粗/细，不丢字。
 */
import { ImportError } from './errors.js'
import { collapse } from './book.js'

const BOMS = [
  { sig: [0xef, 0xbb, 0xbf], enc: 'utf-8', skip: 3 },
  { sig: [0xff, 0xfe], enc: 'utf-16le', skip: 2 },
  { sig: [0xfe, 0xff], enc: 'utf-16be', skip: 2 },
]

/**
 * 字节 -> 文本。顺序：BOM 说了算 -> UTF-8（strict）-> GBK（strict）-> 放弃。
 * 为什么 GBK 兜底：这台机器/这个产品的用户群大量是中文 TXT，GBK 是默认编码；
 * 而 GBK 解不出错的字节序列很少，所以「UTF-8 严格失败」之后猜 GBK 命中率很高。
 */
export function decodeBytes(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const bom = BOMS.find(x => x.sig.every((v, i) => b[i] === v))
  if (bom) {
    try {
      const text = new TextDecoder(bom.enc).decode(b.subarray(bom.skip))
      return { text, encoding: bom.enc }
    } catch { /* 环境不支持该编码 -> 继续往下试 */ }
  }
  for (const enc of ['utf-8', 'gbk']) {
    try {
      const text = new TextDecoder(enc, { fatal: true }).decode(b)
      return { text: text.replace(/^\uFEFF/, ''), encoding: enc }
    } catch { /* 试下一种 */ }
  }
  throw new ImportError('ENCODING_UNKNOWN')
}

/**
 * 文本 -> 段落。有空行分隔就按空行切（正常排版）；
 * 整篇一个空行都没有时退化成「一行一段」—— 否则整本书会变成一段，阅读页就没法定位了。
 */
export function splitTextToParagraphs(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n')
  const blocks = s.split(/\n[ \t]*\n+/)
  const source = blocks.length > 1 ? blocks : s.split('\n')
  return source.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/**
 * 像不像章标题（启发式，纯文本唯一可用的信号）：
 *   · 短（<= 60 字）
 *   · 裸数字 / 罗马数字 / 「CHAPTER 12」这类带编号的
 *   · PROLOGUE / APPENDIX 这类固定词
 *   · 全大写短行（"THE GIVER"）
 * 有意不做「首字母大写 + 短」这类判断 —— 误切太狠，宁可少切。
 */
export function isChapterHeading(paragraph) {
  const t = collapse(paragraph)
  if (!t || t.length > 60) return false
  if (/^\d{1,4}$/.test(t)) return true
  if (/^[IVXLCDM]{1,8}$/.test(t)) return true
  if (/^(chapter|part|book|section|act|scene)\b[\s.:\u2014-]*[\dIVXLC]{1,6}\b/i.test(t)) return true
  if (/^(prologue|epilogue|foreword|preface|introduction|afterword|appendix|dedication|acknowledgements|contents)\b/i.test(t) && t.length <= 40) return true
  // 中文标题：用户群大量是中文 TXT（GBK 兜底那一段已经说明这点），不认中文标题的话
  // 整本中文书会塌成一章，阅读页就没法定位了。规则从紧：必须「第<数字>章/节/回/卷/篇/部」
  // 开头，或整行就是一个常见件名。
  if (/^\u7b2c\s*[0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u96f6\u4e24]{1,8}\s*[\u7ae0\u8282\u56de\u5377\u7bc7\u90e8]/.test(t)) return true
  if (/^(\u5e8f|\u5e8f\u8a00|\u81ea\u5e8f|\u524d\u8a00|\u540e\u8bb0|\u8dcb|\u694e\u5b50|\u5c3e\u58f0|\u76ee\u5f55|\u9644\u5f55)$/.test(t)) return true
  // 全大写短行 = 标题（"THE GIVER"）。但必须排除含中文的行：
  // “这是一段正文，用了 UTF-8 编码。”里只有 UTF 是大写拉丁字母，无护栏就会被误判成标题。
  if (!/[\u3400-\u9fff]/.test(t) && !/[a-z]/.test(t) && /[A-Za-z]/.test(t) && t.length <= 40) return true
  return false
}

/** 段落 -> 章：标题行当章名（不进正文），标题前面的散段归到 fallbackTitle */
export function paragraphsToChapters(paragraphs, { fallbackTitle = 'Chapter 1' } = {}) {
  const chapters = []
  let cur = null
  const flush = () => { if (cur && cur.paragraphs.length) chapters.push(cur); cur = null }
  for (const raw of Array.isArray(paragraphs) ? paragraphs : []) {
    const t = collapse(raw)
    if (!t) continue
    if (isChapterHeading(t)) { flush(); cur = { title: t, paragraphs: [] }; continue }
    if (!cur) cur = { title: fallbackTitle, paragraphs: [] }
    cur.paragraphs.push(t)
  }
  flush()
  if (!chapters.length) {
    return [{ title: fallbackTitle, paragraphs: (paragraphs || []).map(collapse).filter(Boolean) }]
  }
  return chapters
}

export function parseTxt(bytes, { title = '' } = {}) {
  const { text } = decodeBytes(bytes)
  const paragraphs = splitTextToParagraphs(text)
  if (!paragraphs.length) throw new ImportError('EMPTY_CONTENT')
  const fallbackTitle = collapse(title) || 'Chapter 1'
  return { title: collapse(title), author: '', chapters: paragraphsToChapters(paragraphs, { fallbackTitle }) }
}
