/**
 * EPUB 导入（第 5 步 5.1）。
 *
 * 只做「取正文文本」这一段，不复刻 EPUB 渲染（D8：Phase 1 不提供用户书加工）。
 * 链路：mimetype 校验 -> encryption.xml 查 DRM -> container.xml 找 OPF
 *       -> OPF 里读 manifest/spine -> 按 spine 顺序把 XHTML 转成段落。
 * 目录顺序以 spine 为准（EPUB 的阅读顺序就是 spine 顺序，nav 只是目录视图）。
 */
import { unzipSync, strFromU8 } from 'fflate'
import { ImportError } from './errors.js'
import { htmlToParagraphs, stripTags } from './html.js'
import { collapse } from './book.js'

function attr(tag, name) {
  const m = String(tag).match(new RegExp(name + "\\s*=\\s*(\"([^\"]*)\"|'([^']*)')", 'i'))
  if (!m) return ''
  return m[2] !== undefined ? m[2] : (m[3] || '')
}

/** 取某个局部名的首个元素内容（命名空间前缀可有可无：dc:title / title 都吃） */
function pick(xml, local) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}\\s*>`, 'i')
  const m = String(xml).match(re)
  return m ? m[1] : ''
}

function oneLine(s) {
  return stripTags(s).replace(/\s+/g, ' ').trim()
}

/** 相对 OPF 目录解析 href（去 #fragment / ?query，解码 %20，处理 ../） */
export function resolvePath(dir, href) {
  const raw = String(href || '').split('#')[0].split('?')[0]
  let decoded = raw
  try { decoded = decodeURIComponent(raw) } catch { /* 非法编码就按原样 */ }
  const out = []
  for (const part of (String(dir || '') + decoded).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') { out.pop(); continue }
    out.push(part)
  }
  return out.join('/')
}

export function readEpubEntries(bytes) {
  try {
    return unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  } catch (e) {
    throw new ImportError('EPUB_INVALID', e && e.message)
  }
}

/** META-INF/encryption.xml 存在 = 有加密资源（DRM）-> 不碰 */
export function isEncryptedEpub(entries) {
  return !!(entries && entries['META-INF/encryption.xml'])
}

export function findOpfPath(containerXml) {
  const tag = (String(containerXml).match(/<rootfile\b[^>]*>/i) || [])[0]
  return tag ? attr(tag, 'full-path') : ''
}

export function parseOpf(opfXml) {
  const xml = String(opfXml || '')
  const items = [...xml.matchAll(/<item\b[^>]*>/gi)].map(m => ({
    id: attr(m[0], 'id'),
    href: attr(m[0], 'href'),
    mediaType: attr(m[0], 'media-type'),
    properties: attr(m[0], 'properties'),
  }))
  const spine = [...xml.matchAll(/<itemref\b[^>]*>/gi)].map(m => ({
    idref: attr(m[0], 'idref'),
    linear: attr(m[0], 'linear'),
  }))
  return { title: oneLine(pick(xml, 'title')), author: oneLine(pick(xml, 'creator')), items, spine }
}

/**
 * 从 OPF 找封面那个 manifest item（只认图片）。三条线索，从强到弱：
 *   ① EPUB3：item 的 properties 里写着 cover-image；
 *   ② EPUB2：<meta name="cover" content="item-id"/> 指向的 item；
 *   ③ 兜底：id / href 里带 cover 的图片。
 * 都没有 -> null（调用方回占位图，不是错误）。
 */
export function findCoverItem(opfXml, items) {
  const list = Array.isArray(items) ? items : []
  const isImage = (it) => !!it && /^image\//i.test(it.mediaType || '')
  const byProp = list.find(it => isImage(it) && /(^|\s)cover-image(\s|$)/i.test(it.properties || ''))
  if (byProp) return byProp
  const meta = String(opfXml || '').match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*>/i)
  const id = meta ? attr(meta[0], 'content') : ''
  if (id) {
    const hit = list.find(it => it.id === id)
    if (hit) return hit
  }
  return list.find(it => isImage(it) && /cover/i.test(`${it.id || ''} ${it.href || ''}`)) || null
}

/** 章名：优先文档里的第一个 h1..h6，其次 <title>，最后 Chapter N */
export function chapterTitle(html, n) {
  for (let i = 1; i <= 6; i++) {
    const m = String(html).match(new RegExp(`<h${i}\\b[^>]*>([\\s\\S]*?)</h${i}\\s*>`, 'i'))
    if (m) {
      const t = oneLine(m[1])
      if (t) return t
    }
  }
  return oneLine(pick(html, 'title')) || `Chapter ${n}`
}

export function parseEpub(bytes, { title = '' } = {}) {
  const entries = readEpubEntries(bytes)
  if (!entries['mimetype']) throw new ImportError('EPUB_INVALID', 'missing mimetype')
  const mt = strFromU8(entries['mimetype']).trim()
  if (mt !== 'application/epub+zip') throw new ImportError('EPUB_INVALID', 'mimetype=' + mt)
  if (isEncryptedEpub(entries)) throw new ImportError('EPUB_ENCRYPTED')

  const container = entries['META-INF/container.xml']
  if (!container) throw new ImportError('EPUB_INVALID', 'missing container.xml')
  const opfPath = findOpfPath(strFromU8(container))
  if (!opfPath || !entries[opfPath]) throw new ImportError('EPUB_INVALID', 'missing opf: ' + opfPath)

  const { title: opfTitle, author, items, spine } = parseOpf(strFromU8(entries[opfPath]))
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const byId = new Map(items.map(i => [i.id, i]))

  // 封面（第 7 步 7.4）：用好解包结果里现成的字节，零额外解压；找不到就是 null
  const coverItem = findCoverItem(strFromU8(entries[opfPath]), items)
  const coverFile = coverItem && coverItem.href
    ? (entries[resolvePath(dir, coverItem.href)] || entries[coverItem.href])
    : null
  const cover = coverFile && coverFile.length
    ? { bytes: coverFile, mediaType: coverItem.mediaType || '' }
    : null

  const chapters = []
  for (const ref of spine) {
    if (!ref.idref) continue
    if (String(ref.linear).toLowerCase() === 'no') continue // 封面/目录这类不进正文
    const item = byId.get(ref.idref)
    if (!item || !item.href) continue
    if (!(/xhtml|html/i.test(item.mediaType) || /\.x?html?$/i.test(item.href))) continue
    const file = entries[resolvePath(dir, item.href)] || entries[item.href]
    if (!file) continue
    const html = strFromU8(file)
    const paragraphs = htmlToParagraphs(html)
    if (!paragraphs.length) continue
    // 章名多半就来自正文里的第一个 h1..h6；那段再当一次正文 = 标题重复一遍，去掉
    const chapterName = chapterTitle(html, chapters.length + 1)
    const body = paragraphs[0] === chapterName ? paragraphs.slice(1) : paragraphs
    if (!body.length) continue
    chapters.push({ title: chapterName, paragraphs: body })
  }

  if (!chapters.length) throw new ImportError('EMPTY_CONTENT')
  return { title: collapse(opfTitle) || collapse(title), author: collapse(author), chapters, cover }
}
