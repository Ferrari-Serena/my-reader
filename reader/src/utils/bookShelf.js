/**
 * 书架聚合（纯函数，无 reactive）—— 书架形状的唯一口径。
 *
 * 书架上住着两种书，靠 id 形状区分（第 3 步 3.5 定的口径，见 utils/bookId.js）：
 *   builtin —— 内置书，id 是 slug（sat-practice / dr-jekyll-and-mr-hyde / …），正文走 fetch 静态文件
 *   byo     —— 用户自带书，id 是内容指纹 bk_…，正文在本机 IndexedDB、不出设备
 *
 * 两栏（第 7 步 7.2 定的口径）：
 *   · 「公开书库」＝ builtin 里**显式 visibility=public** 的书，保持 book-index.json 原序（人工排的）；
 *   · 「我的书架」＝ byo，按加入时间倒序（刚放进去的先看见）；
 *   · visibility 缺字段 / 取值不认识 -> **不公开**（fail-closed —— 「公开目录只列 public」，决策台账 #8）；
 *   · 两侧都只认形状对的条目，坏的整条丢掉（别把 null 塞进 :key）。
 */
import { isBookId } from './bookId.js'
import { isCoverDataUrl } from './bookCover.js'

export const BOOK_KIND = { BUILTIN: 'builtin', BYO: 'byo' }

// ── 元数据四字段（第 7 步 7.1）─────────────────────────────────────────
// 取值域由决策台账 #7/#8 定：rights 四值；visibility ∈ {public, private}；
// category 是第 7 步 7.3 定的六类枚举（顺序即分组显示顺序）；license 是展示用自由文本。
export const RIGHTS = Object.freeze(['public-domain', 'original', 'licensed', 'private'])
export const VISIBILITY = Object.freeze({ PUBLIC: 'public', PRIVATE: 'private' })
export const CATEGORY_ORDER = Object.freeze([
  'classic-fiction',
  'short-stories',
  'exam-prep',
  'graded-reader',
  'nonfiction',
  'poetry'
])
export const CATEGORY_LABELS = Object.freeze({
  'classic-fiction': 'Classic Fiction',
  'short-stories': 'Short Stories',
  'exam-prep': 'Exam Prep',
  'graded-reader': 'Graded Readers',
  nonfiction: 'Nonfiction',
  poetry: 'Poetry',
  other: 'Other'
})
const CATEGORY_OTHER = 'other'
const BYO_RIGHTS = 'private'

/** 分类键：枚举外的取值（含空）一律归 'other' —— 别让拼写漂移把同一类裂成两组 */
export function categoryKeyOf(value) {
  const key = String(value || '').trim()
  return CATEGORY_ORDER.includes(key) ? key : CATEGORY_OTHER
}

export function categoryLabelOf(value) {
  return CATEGORY_LABELS[categoryKeyOf(value)]
}

/** slug（内置）还是 bk_（自带）；认不出的按内置处理 —— 宁可点开报「找不到」，也别当成 BYO 去查 IDB */
export function kindOfBook(id) {
  return isBookId(id) ? BOOK_KIND.BYO : BOOK_KIND.BUILTIN
}

/** 公开目录只列**显式** public 的书（fail-closed：缺字段＝不公开） */
export function isPublicBook(book) {
  return String(book?.visibility || '').trim() === VISIBILITY.PUBLIC
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
    rights: String(raw?.rights || '').trim(),
    visibility: String(raw?.visibility || '').trim(),
    category: categoryKeyOf(raw?.category),
    license: String(raw?.license || '').trim(),
    kind: BOOK_KIND.BUILTIN,
    chapterCount: 0,
    charCount: 0,
    addedAt: ''
  }
}

/**
 * 库存记录 -> 书架条目（shelf 店里存的就是这个形状，**不含 chapters**）。
 * 只认 bk_ 形状的 id：书架索引里混进 slug 说明是别的代码写坏的，宁可丢这一条。
 * 元数据：用户自带书一律私有（决策 #9），不进公开目录、不谈授权。
 */
export function metaOf(record) {
  const id = String((record && (record.bookId || record.id)) || '').trim()
  if (!isBookId(id)) return null
  return {
    id,
    title: String(record.title || '').trim() || 'Untitled',
    author: String(record.author || '').trim(),
    coverUrl: isCoverDataUrl(record.coverUrl) ? record.coverUrl : '',
    rights: BYO_RIGHTS,
    visibility: VISIBILITY.PRIVATE,
    category: '',
    license: 'Personal use only',
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

/** 公开书库按 category 分组（组序固定，'other' 沉底；组内保持传入顺序） */
export function groupByCategory(books) {
  const buckets = new Map()
  for (const book of Array.isArray(books) ? books : []) {
    const key = categoryKeyOf(book?.category)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(book)
  }
  const rank = (key) => {
    const i = CATEGORY_ORDER.indexOf(key)
    return i === -1 ? CATEGORY_ORDER.length : i
  }
  return [...buckets.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({ key, label: CATEGORY_LABELS[key], books: buckets.get(key) }))
}

/**
 * 「正文不在本机」的行（第 9 步 9.4 的缺书占位 ＋ 第 16 步块 3 的云端可下载）。
 *
 * 两个来源按 bookId 取并集，一个 id 只出一行：
 *   · 有笔记但本机没正文的（别的设备划过线，笔记同步过来了）；
 *   · 账号里有正文的（别的设备导入了书，书体同步过来了）。
 * 账号里有 → `cloud: true`，这一行给「下载」；只有笔记 → 只能自己去导入那一本。
 * 并集而不是相加，是因为同一本书常常两边都有 —— 相加会让它出现两行。
 */
export function notOnDeviceRows(noteGroups, cloudMetas, downloadingIds = [], failedIds = []) {
  const blank = (id) => ({ bookId: id, title: '', noteCount: 0, cloud: false })
  const byId = new Map()

  for (const g of Array.isArray(noteGroups) ? noteGroups : []) {
    const id = String((g && (g.bookId || g.id)) || '').trim()
    if (!id) continue
    const row = byId.get(id) || blank(id)
    row.title = row.title || String(g.bookTitle || g.title || '')
    row.noteCount += Number(g.count) || 0
    byId.set(id, row)
  }

  for (const m of Array.isArray(cloudMetas) ? cloudMetas : []) {
    const id = String((m && (m.bookId || m.id)) || '').trim()
    if (!id) continue
    const row = byId.get(id) || blank(id)
    row.cloud = true                       // 账号里有正文 → 这一行可以直接下载
    row.title = row.title || String(m.title || '')
    byId.set(id, row)
  }

  const downloading = new Set(downloadingIds || [])
  const failed = new Set(failedIds || [])
  return [...byId.values()].map((r) => ({
    ...r,
    downloading: downloading.has(r.bookId),
    failed: failed.has(r.bookId)
  }))
}

/** 两个来源 -> 两栏书架（第 7 步 7.2）：公开书库 / 我的书架 */
export function columnsOf(builtinBooks, byoMetas) {
  const mine = sortByAddedAtDesc(
    (Array.isArray(byoMetas) ? byoMetas : []).map(metaOf).filter(Boolean)
  )
  const publicBooks = (Array.isArray(builtinBooks) ? builtinBooks : [])
    .map(builtinEntry)
    .filter(Boolean)
    .filter(isPublicBook)
  return { publicBooks, mine }
}
