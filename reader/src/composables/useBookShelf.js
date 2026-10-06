/**
 * 书架数据源（第 5 步 5B；第 7 步 7.2 拆两栏）：静态书目表 ＋ 本机 BYO 书库 -> 「公开书库 / 我的书架」。
 *
 * 两个来源各自独立降级，一个坏掉不该让另一个也消失：
 *   · 静态 book-index.json 取不到（离线首访）-> 公开书库空着，我的书架照常 -> error 记原因
 *   · IndexedDB 打不开（隐私模式 / 老浏览器）-> 只剩公开书库 -> byoError 记原因
 * 组件只认 publicBooks / myBooks 两个已经分好栏的数组，不必关心哪一本从哪来。
 *
 * 第 16 步块 3 起多一份数据源：**账号里的书**（记录通道 kind='book'）。账号有、本机没有的
 * 列进 cloudBooks（书架把「待接入」区升级成可直接下载）；云书落盘后 bookSyncState.revision
 * 自增，这里 watch 它重列 —— 与 useNotes / useReaderSettings 同一套「远程写盘 -> 重读」姿态。
 */
import { computed, ref, watch } from 'vue'
import { columnsOf, sortByAddedAtDesc } from '../utils/bookShelf.js'
import { bookStore } from '../storage/index.js'
import { loadRecordTombstones, loadRecordsMap } from '../sync/recordStore.js'
import { loadRetiredBooks } from '../sync/bookRetire.js'
import {
  bookSyncState, cloudBookMetas, downloadCloudBook, planPrefetch, reconcileBooksInBackground,
  removeByoBookEverywhere
} from '../sync/bookSync.js'
import { useAuth } from './useAuth.js'
import { useSync } from './useSync.js'

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
export function useBookShelf({ indexUrl, store = bookStore, auth = null } = {}) {
  // auth / store 只为测试留缝（真机上一律用同一份会话与书库单例）
  const authRef = auth || useAuth()
  const sync = useSync()
  const publicBooks = ref([])   // 「公开书库」：book-index.json 里 visibility=public 的书
  const myBooks = ref([])       // 「我的书架」：本机 BYO 书，按加入时间倒序
  const loading = ref(true)
  const error = ref(null)       // 静态书目表取不到（公开书库缺席）
  const byoError = ref(null)    // 本机书库打不开（我的书架缺席）
  const byoCount = ref(0)
  const cloudBooks = ref([])      // 账号里有、这台设备没有的书（第 16 步块 3）
  const downloading = ref([])     // 正在下载的 bookId（点了「下载」的那几本）
  const downloadFailed = ref([])  // 上一次没下来的（按钮改成「重试」，不弹错误框）
  const prefetching = computed(() => bookSyncState.prefetching)

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

  /**
   * 账号里有、这台设备没有的书。**没登录就不列** —— 登出后本地还留着记录通道那份表，
   * 那些 meta 属于上一个账号，摆出来就成了假的「在你的账号里」。
   */
  function loadCloud(localIds) {
    if (!authRef.user.value) return []
    const metas = cloudBookMetas(loadRecordsMap(), loadRecordTombstones())
    // 退役名单上的书不再自动列进「待接入」/ 不再自动预取（删过的不许回来）；显式导入 / 下载不受影响
    return sortByAddedAtDesc(planPrefetch(metas, localIds, loadRetiredBooks()))
  }

  async function refresh() {
    loading.value = true
    const [builtin, byo] = await Promise.all([loadBuiltin(), loadByo()])
    const { publicBooks: pub, mine } = columnsOf(builtin, byo)
    publicBooks.value = pub
    myBooks.value = mine
    byoCount.value = mine.length
    cloudBooks.value = loadCloud(mine.map((b) => b.id))
    loading.value = false
    // 打开书架就把账号里缺的书拉下来（后台、不 await；落盘后 revision 自增 → watch 再 refresh）
    reconcileBooksInBackground()
  }

  /** 点书架上的「下载」：拉一本落盘，然后重列 */
  async function fetchCloudBook(bookId) {
    if (downloading.value.includes(bookId)) return false
    downloading.value = [...downloading.value, bookId]
    downloadFailed.value = downloadFailed.value.filter((id) => id !== bookId)
    try {
      const r = await downloadCloudBook(bookId, { save: (rec) => store.saveBook(rec) })
      if (!r.ok) downloadFailed.value = [...downloadFailed.value, bookId]
      return !!r.ok
    } finally {
      downloading.value = downloading.value.filter((id) => id !== bookId)
      await refresh()
    }
  }

  /**
   * 删一本自带书（第 16 步块 4 / D14-c）：**本机 ＋ 云端一起删**，删完刷新列表。
   * 本机那半是确定的（记录 ＋ 台账 ＋ 正文/索引）；云端那半尽力（`cloud:false` 时如实回报 ——
   * 服务端墓碑由本机台账下一次推送带上，别的设备照样会跟着丢）。删完催一次推送。
   */
  async function removeByoBook(bookId) {
    const r = await removeByoBookEverywhere(bookId, { deleteLocal: (id) => store.deleteBook(id) })
    sync.pushSoon()
    await refresh()
    return r
  }

  // 远程同步过来了（recordRevision）／账号里的书刚落盘（revision）→ 重列
  watch(bookSyncState.revision, () => { refresh() })
  watch(() => sync.recordRevision.value, () => { refresh() })

  return {
    publicBooks, myBooks, cloudBooks, loading, error, byoError, byoCount,
    downloading, downloadFailed, prefetching,
    refresh, removeByoBook, fetchCloudBook
  }
}
