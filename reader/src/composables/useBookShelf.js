/**
 * 书架数据源（第 5 步 5B；第 7 步 7.2 拆两栏）：静态书目表 ＋ 本机 BYO 书库 -> 「公开书库 / 我的书架」。
 *
 * 两个来源各自独立降级，一个坏掉不该让另一个也消失：
 *   · 静态 book-index.json 取不到（离线首访）-> 公开书库空着，我的书架照常 -> error 记原因
 *   · IndexedDB 打不开（隐私模式 / 老浏览器）-> 只剩公开书库 -> byoError 记原因
 * 组件只认 publicBooks / myBooks 两个已经分好栏的数组，不必关心哪一本从哪来。
 */
import { ref } from 'vue'
import { columnsOf } from '../utils/bookShelf.js'
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
  const publicBooks = ref([])   // 「公开书库」：book-index.json 里 visibility=public 的书
  const myBooks = ref([])       // 「我的书架」：本机 BYO 书，按加入时间倒序
  const loading = ref(true)
  const error = ref(null)       // 静态书目表取不到（公开书库缺席）
  const byoError = ref(null)    // 本机书库打不开（我的书架缺席）
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
    const { publicBooks: pub, mine } = columnsOf(builtin, byo)
    publicBooks.value = pub
    myBooks.value = mine
    byoCount.value = mine.length
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

  return { publicBooks, myBooks, loading, error, byoError, byoCount, refresh, removeByoBook }
}
