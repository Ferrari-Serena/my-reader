/**
 * XHTML/HTML -> 段落数组（EPUB 正文用；纯字符串处理，不依赖 DOM）。
 *
 * 为什么不用 DOMParser：① 导入解析要能在 Node 里跑单测（verify-import.mjs 没有 DOM）；
 * ② 我们只要文本，不需要树。规则是「块级标签 = 段落边界，其余标签直接抹掉」。
 */

const BLOCK = 'address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul'

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00b7',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  laquo: '\u00ab', raquo: '\u00bb', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
  deg: '\u00b0', times: '\u00d7', divide: '\u00f7', frac12: '\u00bd',
  szlig: '\u00df', aacute: '\u00e1', agrave: '\u00e0', eacute: '\u00e9', egrave: '\u00e8',
  iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa', ntilde: '\u00f1',
  auml: '\u00e4', ouml: '\u00f6', uuml: '\u00fc', euml: '\u00eb', iuml: '\u00ef', ccedil: '\u00e7',
}

/** 解实体：命名表 + 十进制/十六进制数字实体；认不出的原样留着（无害） */
export function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole
    }
    const v = NAMED[body.toLowerCase()]
    return v === undefined ? whole : v
  })
}

/** 抹标签、留文本（标题抽取等零散场景用） */
export function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' '))
}

/** HTML -> 段落数组 */
export function htmlToParagraphs(html) {
  let s = String(html ?? '')
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  s = s.replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(new RegExp(`<(${BLOCK})\\b[^>]*>`, 'gi'), '\n\n')
  s = s.replace(new RegExp(`</(${BLOCK})\\s*>`, 'gi'), '\n\n')
  s = s.replace(/<[^>]*>/g, '')
  s = decodeEntities(s).replace(/\u00a0/g, ' ')
  return s
    .split(/\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}
