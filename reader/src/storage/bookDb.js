/**
 * BYO 书库的 IndexedDB 驱动（第 5 步 5.6：「书体用 OPFS / IndexedDB，不进 localStorage」）。
 *
 * 为什么非得是 IndexedDB：localStorage 只存字符串、配额约 5 MB，一本上限 100 MB 的书
 * 光 base64 膨胀就先炸了；IndexedDB 直接存结构化对象（结构化克隆自己做），
 * 配额按 origin 给、远大于 localStorage。
 *
 * 两个 store、同一个 DB：
 *   books —— 书体（键 bookId，值＝整本 chapters）
 *   shelf —— 书架索引（键 id，值＝元信息，**刻意不含 chapters**）
 * 之所以分两店：IndexedDB 没有字段投影，getAll 一定整条返回；列书架若读 books，
 * 每进一次书架页就把所有书的正文读进内存。
 *
 * ── 驱动契约 ────────────────────────────────────────────────
 * 本模块是「IndexedDB 版」。测试里的内存版必须满足同一组语义（不只是同名同参）：
 *   get(store, key)          -> Promise<value | undefined>
 *   all(store)               -> Promise<Array>
 *   count(store)             -> Promise<number>
 *   put(pairs, storeNames)   -> Promise<void>   pairs = [[店名, 值], …]
 *   del(storeNames, keys)    -> Promise<void>   keys  = [[店名, 键], …]
 *   clear(storeNames)        -> Promise<void>
 * 语义重点是**同一个事务**：书体与书架索引必须同生共死 —— 只写进去一半，
 * 书架上就会出现一本点开就报「不在这台设备上」的书。
 * 这条契约在 Node 里测不到（Node 没有 IndexedDB），由浏览器实测覆盖。
 */

export const BOOK_DB_NAME = 'my-reader-books'
export const BOOK_DB_VERSION = 1
export const STORE_BOOKS = 'books'
export const STORE_SHELF = 'shelf'

/** 书库层错误：code 是机器可判的（UNAVAILABLE / OPEN_FAILED / BLOCKED / TX_FAILED），detail 只进日志 */
export class BookStoreError extends Error {
  constructor(code, detail) {
    super(code)
    this.name = 'BookStoreError'
    this.code = code
    if (detail !== undefined) this.detail = String((detail && detail.message) || detail)
  }
}

/** 当前环境的 IDBFactory；取不到（老浏览器 / 隐私模式 / Node）返回 null */
export function idbFactory() {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null
  } catch {
    return null
  }
}

let _dbPromise = null

/**
 * 打开（必要时建）书库。连接在模块级缓存，全应用只开一次。
 * @param {{factory?: IDBFactory|null}} [opts] 只为测试留缝：显式传 null 可模拟「没有 IndexedDB」
 */
export function openBookDb(opts = {}) {
  const factory = 'factory' in opts ? opts.factory : idbFactory()
  if (!factory) return Promise.reject(new BookStoreError('UNAVAILABLE'))
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    let req
    try {
      req = factory.open(BOOK_DB_NAME, BOOK_DB_VERSION)
    } catch (e) {
      reject(new BookStoreError('OPEN_FAILED', e))
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_BOOKS)) db.createObjectStore(STORE_BOOKS, { keyPath: 'bookId' })
      if (!db.objectStoreNames.contains(STORE_SHELF)) db.createObjectStore(STORE_SHELF, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new BookStoreError('OPEN_FAILED', req.error))
    // 另一个标签页卡着旧版本升级：不静默挂起，报出来
    req.onblocked = () => reject(new BookStoreError('BLOCKED'))
  })
  // 失败不缓存：一次瞬时失败（如首次被拒绝授权）不该把整个会话锁死
  _dbPromise.catch(() => { _dbPromise = null })
  return _dbPromise
}

/** 关掉并清空缓存的连接（测试 / 换库用） */
export async function closeBookDb() {
  const p = _dbPromise
  _dbPromise = null
  if (!p) return
  try {
    const db = await p
    if (db && typeof db.close === 'function') db.close()
  } catch { /* 打开本来就失败了，没什么可关 */ }
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new BookStoreError('TX_FAILED', request.error))
  })
}

/** 跑一个事务，等它**提交完成**才算成功（不是请求发出就算） */
function txDone(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx
    try {
      tx = db.transaction(storeNames, mode)
    } catch (e) {
      reject(new BookStoreError('TX_FAILED', e))
      return
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(new BookStoreError('TX_FAILED', tx.error))
    tx.onabort = () => reject(new BookStoreError('TX_FAILED', tx.error))
    try {
      work(tx)
    } catch (e) {
      try { tx.abort() } catch { /* 已经在失败路径上 */ }
      reject(new BookStoreError('TX_FAILED', e))
    }
  })
}

/** IndexedDB 版驱动（契约见文件头） */
export const idbDriver = {
  async get(store, key) {
    const db = await openBookDb()
    return asPromise(db.transaction(store, 'readonly').objectStore(store).get(key))
  },
  async all(store) {
    const db = await openBookDb()
    return asPromise(db.transaction(store, 'readonly').objectStore(store).getAll())
  },
  async count(store) {
    const db = await openBookDb()
    return asPromise(db.transaction(store, 'readonly').objectStore(store).count())
  },
  async put(pairs, storeNames) {
    const db = await openBookDb()
    await txDone(db, storeNames, 'readwrite', (tx) => {
      for (const [store, value] of pairs) tx.objectStore(store).put(value)
    })
  },
  async del(storeNames, keys) {
    const db = await openBookDb()
    await txDone(db, storeNames, 'readwrite', (tx) => {
      for (const [store, key] of keys) tx.objectStore(store).delete(key)
    })
  },
  async clear(storeNames) {
    const db = await openBookDb()
    await txDone(db, storeNames, 'readwrite', (tx) => {
      for (const store of storeNames) tx.objectStore(store).clear()
    })
  }
}

export default idbDriver
