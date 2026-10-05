/**
 * BYO 书库的读写口径（第 5 步 5.6 / 5B）。
 *
 * 只管三件事：① 入库前净化（白名单 + 计数重算，与 schema.js 的 sanitizeEntry 同姿态）；
 * ② 书体与书架索引**同一个事务**落盘（同生共死）；③ 列书架只读元信息、按加入时间倒序。
 * 真正的 IO 在 bookDb.js（IndexedDB 驱动）；driver 参数只为测试留缝 ——
 * 应用侧一律用文件尾的默认单例。
 */
import idbDriver, { BookStoreError, STORE_BOOKS, STORE_SHELF } from './bookDb.js'
import { isBookId } from '../utils/bookId.js'
import { metaOf, sortByAddedAtDesc } from '../utils/bookShelf.js'
import { nowIso } from '../sync/clock.js'
import { isCoverDataUrl } from '../utils/bookCover.js'

export { BookStoreError, STORE_BOOKS, STORE_SHELF } from './bookDb.js'

/**
 * 入库前净化：白名单剪裁 + 计数重算。
 * 存储层是最后一道闸 —— 脏数据不落盘；空段/空章直接丢，全空则拒收（不产半本空书）。
 */
export function normalizeRecord(raw) {
  const bookId = String((raw && raw.bookId) || '').trim()
  if (!isBookId(bookId)) throw new BookStoreError('BAD_ID', bookId)
  const chapters = (Array.isArray(raw?.chapters) ? raw.chapters : [])
    .map((ch) => {
      const id = String(ch?.id || '').trim()
      const paragraphs = (Array.isArray(ch?.paragraphs) ? ch.paragraphs : [])
        .map((p) => ({ id: String(p?.id || '').trim(), text: String(p?.text ?? '') }))
        .filter((p) => p.text.trim() !== '')
      return { id, title: String(ch?.title || '').trim(), paragraphs }
    })
    .filter((ch) => ch.id && ch.paragraphs.length)
  if (!chapters.length) throw new BookStoreError('NO_CHAPTERS', bookId)
  const charCount = chapters.reduce(
    (n, ch) => n + ch.paragraphs.reduce((m, p) => m + p.text.length, 0), 0)
  return {
    bookId,
    title: String(raw.title || '').trim() || 'Untitled',
    author: String(raw.author || '').trim(),
    // 封面：只认自己产的 image data URL，其余（外链 / 非图片 / 超长）一律丢
    coverUrl: isCoverDataUrl(raw.coverUrl) ? raw.coverUrl : '',
    chapters,
    chapterCount: chapters.length,
    charCount,
    // addedAt 是书架的排序键：5C 导入时给一次，缺了就用当前时刻补 —— 绝不留空
    addedAt: typeof raw.addedAt === 'string' && raw.addedAt ? raw.addedAt : nowIso(),
    updatedAt: nowIso()
  }
}

/**
 * 建一个书库门面。driver 缺省＝IndexedDB 版；测试传内存版，跑的必须是同一组语义（见 bookDb.js 契约）。
 * @param {object} [driver]
 */
export function createBookStore(driver = idbDriver) {
  return {
    /** 入库（新增，或同 id 覆盖）。返回书架条目。 */
    async saveBook(raw) {
      const record = normalizeRecord(raw)
      const meta = metaOf(record)
      await driver.put([[STORE_BOOKS, record], [STORE_SHELF, meta]], [STORE_BOOKS, STORE_SHELF])
      return meta
    },

    /** 取整本（含 chapters）。没有 / 形状坏了 → null；调用方只需判空，不必分辨两种「没有」 */
    async loadBook(bookId) {
      const id = String(bookId || '')
      if (!isBookId(id)) return null
      const record = await driver.get(STORE_BOOKS, id)
      if (!record || record.bookId !== id) return null
      if (!Array.isArray(record.chapters) || !record.chapters.length) return null
      return record
    },

    /** 书架索引（不含正文），按加入时间倒序 */
    async listByoBooks() {
      const metas = (await driver.all(STORE_SHELF)).map(metaOf).filter(Boolean)
      return sortByAddedAtDesc(metas)
    },

    /** 移出书架：正文与索引同一个事务删掉 */
    async deleteBook(bookId) {
      const id = String(bookId || '')
      if (!isBookId(id)) return false
      await driver.del([STORE_BOOKS, STORE_SHELF], [[STORE_BOOKS, id], [STORE_SHELF, id]])
      return true
    },

    async countByoBooks() {
      return driver.count(STORE_SHELF)
    },

    /** 清空书库（测试 / 将来「退出登录并清本机」这类重活） */
    async clearByoBooks() {
      await driver.clear([STORE_BOOKS, STORE_SHELF])
    }
  }
}

/** 应用侧单例 —— 组件只从这里拿（见 storage/index.js 的出口约定） */
export const bookStore = createBookStore()

export const saveBook = (...args) => bookStore.saveBook(...args)
export const loadBook = (...args) => bookStore.loadBook(...args)
export const listByoBooks = (...args) => bookStore.listByoBooks(...args)
export const deleteBook = (...args) => bookStore.deleteBook(...args)
export const countByoBooks = (...args) => bookStore.countByoBooks(...args)
export const clearByoBooks = (...args) => bookStore.clearByoBooks(...args)
