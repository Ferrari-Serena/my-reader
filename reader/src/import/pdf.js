/**
 * PDF（有文本层）导入（第 5 步 5.1 / 5.4）。
 *
 * 只取文本，不渲染 —— 所以 disableFontFace，也不需要 standardFontDataUrl
 * （缺标准字体的告警只影响显示，不影响取字）。
 *
 * 分两层：
 *   · 纯函数（groupLines / linesToParagraphs / pagesToChapters）—— 可在 Node 里直接单测；
 *   · parsePdf —— 壳，只负责调 pdfjs 把页取出来喂给上面三个。
 *
 * pdfjs 的取法有个坑（2026-10-05 实测）：非 legacy 版在 Node 里 import 就炸
 * （"hashOriginal.toHex is not a function"，它自己会提示用 legacy 构建）。
 * 所以这里 pdfjs 由调用方注入（测试注入 legacy 版），浏览器侧默认走正式构建。
 */
import { ImportError, throwIfAborted } from './errors.js'
import { collapse } from './book.js'

/** 只取文本时的加载参数；verbosity:0 压掉「缺标准字体」这类与我们无关的告警 */
export const PDF_LOAD_OPTIONS = {
  useWorkerFetch: false,
  isEvalSupported: false,
  disableFontFace: true,
  verbosity: 0,
}

async function loadPdfjs(injected) {
  if (injected) return injected
  const mod = await import('pdfjs-dist')
  if (!mod.GlobalWorkerOptions.workerSrc) {
    // Vite 的 ?url：把 worker 当静态资源发出去，路径由构建产物决定
    const { default: url } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    mod.GlobalWorkerOptions.workerSrc = url
  }
  return mod
}

function pdfLoadError(e) {
  const name = e && e.name
  if (name === 'PasswordException') return new ImportError('PDF_PASSWORD')
  if (name === 'InvalidPDFException' || name === 'MissingPDFException') return new ImportError('PDF_INVALID', e.message)
  return new ImportError('PDF_INVALID', e && e.message ? e.message : String(e))
}

/**
 * 文本项 -> 行（纯函数）。
 * pdfjs 的 y 轴向上，所以按 y 降序 = 从上到下；同一行的判定用「y 差 <= 0.4 行高」。
 * 同一行内按 x 升序拼；词与词之间按 x 间距补空格（间距小就是同一个词被切断）。
 */
export function groupLines(items) {
  const rows = []
  for (const it of Array.isArray(items) ? items : []) {
    const str = it && it.str
    if (!str) continue
    const tr = it.transform || []
    const y = Number(tr[5]) || 0
    const x = Number(tr[4]) || 0
    const h = Number(it.height) || Math.abs(Number(tr[3]) || 0) || 10
    let row = rows.find(r => Math.abs(r.y - y) <= Math.max(1.5, 0.4 * h))
    if (!row) { row = { y, h, items: [] }; rows.push(row) }
    row.items.push({ x, str, width: Number(it.width) || 0 })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows.map(r => {
    const parts = r.items.slice().sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = null
    for (const p of parts) {
      if (prevEnd !== null && p.x - prevEnd > r.h * 0.3) text += ' '
      text += p.str
      prevEnd = p.x + p.width
    }
    const right = parts.length ? Math.max(...parts.map(p => p.x + p.width)) : 0
    return { y: r.y, h: r.h, text: text.replace(/\s+/g, ' ').trim(), right }
  }).filter(l => l.text)
}

/**
 * 行 -> 段落（纯函数，启发式）：
 *   · 行距明显大于一个行高（> 1.6x）-> 断段；
 *   · 上一行明显没排满（右端 < 本页最右的 85%）-> 断段（短行通常就是段末）。
 * 不做连字符还原：宁可留个断字，也不要把 well-known 这种合成词粘错。
 */
export function linesToParagraphs(lines) {
  const rows = Array.isArray(lines) ? lines : []
  const maxRight = rows.reduce((m, l) => Math.max(m, l.right || 0), 0)
  const out = []
  let cur = ''
  for (let i = 0; i < rows.length; i++) {
    const l = rows[i]
    const prev = rows[i - 1]
    if (cur && prev) {
      const gap = prev.y - l.y
      const bumps = gap > Math.max(prev.h || 0, l.h || 0) * 1.6
      const short = maxRight > 0 && (prev.right || 0) < maxRight * 0.85
      if (bumps || short) { out.push(cur); cur = '' }
      else if (!/\s$/.test(cur)) cur += ' '
    }
    cur += l.text
  }
  if (cur) out.push(cur)
  return out.map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/**
 * 页 -> 章（纯函数）。
 * 有目录（outline）就按目录切，目录第一条之前的正文归 "Front matter"；
 * 没有目录就退化成「一页一章」（title = Page N）。
 * 章标题与正文首段完全相同时，把那段去掉（避免标题在正文里重复一遍）。
 */
export function pagesToChapters(pages, outline) {
  const list = Array.isArray(pages) ? pages : []
  const heads = (Array.isArray(outline) ? outline : [])
    .filter(h => h && Number.isFinite(h.page) && h.page >= 1)
    .slice()
    .sort((a, b) => a.page - b.page)

  const slice = (from, to) => {
    const paras = []
    for (let i = from; i <= to && i <= list.length; i++) paras.push(...((list[i - 1] && list[i - 1].paragraphs) || []))
    return paras
  }

  if (heads.length) {
    const chapters = []
    if (heads[0].page > 1) {
      const paras = slice(1, heads[0].page - 1)
      if (paras.length) chapters.push({ title: 'Front matter', paragraphs: paras })
    }
    heads.forEach((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].page - 1 : list.length
      const paras = slice(h.page, end)
      if (!paras.length) return
      const body = paras[0] === h.title ? paras.slice(1) : paras
      if (!body.length) return
      chapters.push({ title: h.title, paragraphs: body })
    })
    if (chapters.length) return chapters
  }

  return list
    .map((p, i) => ({ title: `Page ${i + 1}`, paragraphs: (p && p.paragraphs) || [] }))
    .filter(c => c.paragraphs.length)
}

async function resolvePage(doc, dest) {
  try {
    const d = typeof dest === 'string' ? (await doc.getDestinations())[dest] : dest
    if (!d || !d.length) return null
    const ref = d[0]
    if (typeof ref === 'number') return ref + 1
    if (ref && typeof ref === 'object') return (await doc.getPageIndex(ref)) + 1
    return null
  } catch { return null }
}

/** 目录拍平（子项也算章）：深目录会切得细，但比整本一章强 */
async function readOutline(doc) {
  let raw = null
  try { raw = await doc.getOutline() } catch { raw = null }
  if (!Array.isArray(raw) || !raw.length) return []
  const out = []
  const walk = async (nodes) => {
    for (const n of nodes || []) {
      const page = await resolvePage(doc, n && n.dest)
      if (page) out.push({ title: collapse(n && n.title) || `Page ${page}`, page })
      if (n && Array.isArray(n.items) && n.items.length) await walk(n.items)
    }
  }
  await walk(raw)
  return out.sort((a, b) => a.page - b.page)
}

async function readMeta(doc) {
  try {
    const m = await doc.getMetadata()
    const info = (m && m.info) || {}
    return { title: collapse(info.Title), author: collapse(info.Author) }
  } catch { return { title: '', author: '' } }
}

export async function parsePdf(bytes, { pdfjs, onProgress, signal, title = '' } = {}) {
  const lib = await loadPdfjs(pdfjs)
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

  let doc
  try {
    doc = await lib.getDocument({ data, ...PDF_LOAD_OPTIONS }).promise
  } catch (e) {
    throw pdfLoadError(e)
  }

  try {
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      throwIfAborted(signal)
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      pages.push({ paragraphs: linesToParagraphs(groupLines((tc && tc.items) || [])) })
      if (typeof onProgress === 'function') onProgress({ stage: 'pdf', loaded: i, total: doc.numPages })
    }
    const outline = await readOutline(doc)
    const meta = await readMeta(doc)
    const chars = pages.reduce((n, p) => n + p.paragraphs.join('').length, 0)
    if (!chars) throw new ImportError('PDF_NO_TEXT')
    return { title: meta.title || collapse(title), author: meta.author, chapters: pagesToChapters(pages, outline) }
  } finally {
    try { await doc.destroy() } catch { /* 清理失败不影响结果 */ }
  }
}
