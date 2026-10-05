/**
 * 书架数据源（第 5 步 5B）：静态书目表 ＋ 本机 BYO 书库 -> 一列书架。
 *
 * 两个来源各自独立降级，一个坏掉不该让另一个也消失：
 *   · 静态 book-index.json 取不到（离线首访）-> 只剩 BYO，书架别空转 -> error 记原因
 *   · IndexedDB 打不开（隐私模式 / 老浏览器）-> 只剩内置书 -> byoError 记原因
 * 组件只认 books（已合成、已排序），不必关心哪一本从哪来；画「Your book」角标时才看 kind。
 */
import { ref } from 'vue'
import { shelfOf } from '../utils/bookShelf.js'
import { bookStore } from '../storage/index.js'

/**
 * Vite 构建时静态替换 import.meta.env.BASE_URL；Node 里的自检脚本没有 import.meta.env，
 * 所以它只许在「真要发请求」那一刻求值（测试传了 indexUrl 就永远走不到这一行）。
 */
function defaultIndexUrl() {
  return `${import.meta.env.BASE_URL}books/book-index.json`
}

/**
 * @param {{indexUrl?: string, store?: object}} [opts]
 *   store 只为测试留缝（内存驱动版书库）；应用侧一律用默认单例。
 */
export function useBookShelf({ indexUrl, store = bookStore } = {}) {
  const books = ref([])        // 合成后的书架（BYO 在前、内置在后）
  const loading = ref(true)
  const error = ref(null)      // 静态书目表取不到（内置书缺席）
  const byoError = ref(null)   // 本机书库打不开（BYO 缺席）
  const byoCount = ref(0)

  async function loadBuiltin() {
    try {
      const res = await fetch(indexUrl || defaultIndexUrl())
      if (!res.ok) throw new Error(`book-index.json ${res.status}`)
      const data = await res.json()
      error.value = null
      return Array.isArray(data?.books) ? data.books : []
    } catch (e) {
      error.value = e?.message || 'BOOK_INDEX_FAILED'
      return []
    }
  }

  async function loadByo() {
    try {
      const metas = await store.listByoBooks()
      byoError.value = null
      return metas
    } catch (e) {
      byoError.value = e?.code || e?.message || 'BOOK_STORE_FAILED'
      return []
    }
  }

  async function refresh() {
    loading.value = true
    const [builtin, byo] = await Promise.all([loadBuiltin(), loadByo()])
    books.value = shelfOf(builtin, byo)
    byoCount.value = byo.length
    loading.value = false
  }

  /**
   * 把一本自带书移出书架（正文与索引一起删，书体不出设备），删完刷新列表。
   * 5C 的书架交互调它；本轮只落能力、不接按钮。
   */
  async function removeByoBook(bookId) {
    await store.deleteBook(bookId)
    await refresh()
  }

  return { books, loading, error, byoError, byoCount, refresh, removeByoBook }
}
