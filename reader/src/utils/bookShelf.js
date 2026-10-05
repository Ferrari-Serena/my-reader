/**
 * 书架聚合（纯函数，无 reactive）—— 书架列表形状的唯一口径。
 *
 * 书架上住着两种书，靠 id 形状区分（第 3 步 3.5 定的口径，见 utils/bookId.js）：
 *   builtin —— 内置书，id 是 slug（the-giver / sat-practice / …），正文走 fetch 静态文件
 *   byo     —— 用户自带书，id 是内容指纹 bk_…，正文在本机 IndexedDB、不出设备
 *
 * 聚合规则：
 *   · BYO 在前（按加入时间倒序 —— 刚放进去的书该最先看见）；
 *   · 内置书保持 book-index.json 的原顺序在后（那是人工排的，不该被动）；
 *   · 两侧都只认形状对的条目，坏的整条丢掉（别把 null 塞进 :key）。
 */
import { isBookId } from './bookId.js'

export const BOOK_KIND = { BUILTIN: 'builtin', BYO: 'byo' }

/** slug（内置）还是 bk_（自带）；认不出的按内置处理 —— 宁可点开报「找不到」，也别当成 BYO 去查 IDB */
export function kindOfBook(id) {
  return isBookId(id) ? BOOK_KIND.BYO : BOOK_KIND.BUILTIN
}

/**
 * book-index.json 的一条 -> 书架条目。
 * chapterCount / charCount 留 0 ＝「未知」：静态书目表里没有这两个数，
 * 而为了显示它们去 fetch 每本书的 chapters.json，是拿一次网络换一个装饰性数字，不值。
 */
export function builtinEntry(raw) {
  const id = String(raw?.id || '').trim()
  if (!id) return null
  return {
    id,
    title: String(raw?.title || '').trim() || 'Untitled',
    author: String(raw?.author || '').trim(),
    coverUrl: String(raw?.coverUrl || ''),
    kind: BOOK_KIND.BUILTIN,
    chapterCount: 0,
    charCount: 0,
    addedAt: ''
  }
}

/**
 * 库存记录 -> 书架条目（shelf 店里存的就是这个形状，**不含 chapters**）。
 * 只认 bk_ 形状的 id：书架索引里混进 slug 说明是别的代码写坏的，宁可丢这一条。
 */
export function metaOf(record) {
  const id = String((record && (record.bookId || record.id)) || '').trim()
  if (!isBookId(id)) return null
  return {
    id,
    title: String(record.title || '').trim() || 'Untitled',
    author: String(record.author || '').trim(),
    coverUrl: '',
    kind: BOOK_KIND.BYO,
    chapterCount: Number(record.chapterCount) || 0,
    charCount: Number(record.charCount) || 0,
    addedAt: String(record.addedAt || '')
  }
}

/** 按加入时间倒序；没有时间戳的沉到底（同刻保持传入顺序 —— sort 是稳定的） */
export function sortByAddedAtDesc(metas) {
  return [...metas].sort((a, b) => {
    const x = a.addedAt || ''
    const y = b.addedAt || ''
    if (x === y) return 0
    if (!x) return 1
    if (!y) return -1
    return x < y ? 1 : -1
  })
}

/** 两个来源合成一列书架 */
export function shelfOf(builtinBooks, byoMetas) {
  const byo = sortByAddedAtDesc(
    (Array.isArray(byoMetas) ? byoMetas : []).map(metaOf).filter(Boolean)
  )
  const builtin = (Array.isArray(builtinBooks) ? builtinBooks : []).map(builtinEntry).filter(Boolean)
  return [...byo, ...builtin]
}
