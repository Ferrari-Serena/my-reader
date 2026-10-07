/**
 * 第 16 步（D14）· 前端侧 —— BYO 书体同步（块 2 上云 ＋ 块 3 预取/补登记 ＋ 块 4 删书）。
 *
 * 一件事的两半，先后不能反（服务端契约见 worker/src/booksync.js）：
 *   ① 正文 → R2：`PUT /api/sync/book/<bookId>`。**URL 里不带 code** —— 租户由会话
 *      反推（`users.sync_code`），带了服务端一律 400；
 *   ② 元信息 → 记录通道（`kind='book'`，键 `book:<bookId>`，7 个字段）：**正文上去
 *      之后才写**。反过来先写元信息，别的设备书架会挂着一条点不开的书。
 *
 * 为什么每个失败都不抛（§12.6）：本机已经有正文，上云是**附加**动作 —— 弱网、会话过期、
 * 服务端 5xx 都不该打断阅读。失败就留在本机，下次导入 / 下次登录自愈。
 *
 * 块 3 加的是另外两半（见文件尾）：**账号 → 本机**（登录后自动预取整本，D14-a）与
 * **本机 → 账号**（把还没上云的书用台账补发）。
 * 块 4 加删除（D14-c「删书同步删云端」）：本机记录＋台账＋正文先删，云端对象尽力删。
 * 第 16.5 步块 4（D16-b）再把补发升级成**对账扫本机书**（功能上线前导入的书唯一的补登记
 * 路径），并加**永久退役名单**（bookRetire.js）—— 删过的书不许被补发或预取拉活。
 *
 * 为什么是独立 fetch（不走 useSync 的 apiFetch）：书体最大 8 MB，而 /api/sync 那条
 * keepalive 路径的预算是 64 KiB —— 一裁就整条丢。上传也不带 `keepalive`。
 */

import { reactive } from 'vue'
import { putRecord, removeRecord, loadRecordsMap, loadRecordTombstones } from './recordStore.js'
import { splitRecordKey } from './records.js'
import { nowIso } from './clock.js'
import { loadRetiredBooks, clearBookRetired } from './bookRetire.js'
import { fetchCloudIndex, indexUsable } from '../utils/audioCloud.js'
import { saveAudioIndex, clearAudioIndex } from './audioIndexCache.js'

export const BOOK_ROUTE = '/api/sync/book/'
/** 书体可达 8 MB，同步通道那档 8 s 不够用 */
export const BOOK_UPLOAD_TIMEOUT_MS = 60000

/** BYO 书 id 的形状（与 utils/bookId.js、worker/src/booksync.js 同一条正则） */
export function isByoBookId(v) { return typeof v === 'string' && /^bk_[0-9a-f]{16}$/.test(v) }

// ── 「还没上云」的本地台账（第 16 步块 4）────────────────────────────────
// 为什么不用「记录通道里没有 meta」当判据：删除只留墓碑、不留 meta。拿它当判据，
// 每次登录都会把**已经删掉的书**又发回账号（删了又活）。所以单独记一笔：
// 导入时没登录 / 那次上传失败 -> 记上；发送成功 -> 划掉。离线也持久，登录后自愈。
const PENDING_PUBLISH_KEY = 'reader-books-to-publish'

export function loadPendingPublish() {
  try {
    const raw = localStorage.getItem(PENDING_PUBLISH_KEY)
    const arr = raw ? JSON.parse(raw) : null
    return Array.isArray(arr) ? arr.filter((v) => isByoBookId(v)) : []
  } catch {
    return [] // 私有模式 / 表坏了：退回「不记得」，下次导入同一本会补
  }
}

function writePendingPublish(list) {
  try {
    const arr = [...new Set((list || []).filter((v) => isByoBookId(v)))]
    if (arr.length) localStorage.setItem(PENDING_PUBLISH_KEY, JSON.stringify(arr))
    else localStorage.removeItem(PENDING_PUBLISH_KEY) // 空表不留 `[]` 垃圾
  } catch { /* 配额满：不记也不影响本机阅读 */ }
}

export function markPendingPublish(bookId) {
  if (isByoBookId(bookId)) writePendingPublish([...loadPendingPublish(), bookId])
}

export function clearPendingPublish(bookId) {
  writePendingPublish(loadPendingPublish().filter((id) => id !== bookId))
}

/**
 * 记录通道的元信息载荷 —— 恰好 7 个字段，与 worker/src/sync.js 的 FIELDS.book
 * 是**同一份名单**。**不含** chapters / coverUrl：正文走 R2，元信息只负责让别的设备
 * 「知道有这本书」。
 */
export function bookMetaPayload(record, now = nowIso) {
  const id = String((record && (record.bookId || record.id)) || '').trim()
  if (!isByoBookId(id)) return null
  const addedAt = String(record.addedAt || '')
  return {
    bookId: id,
    title: String(record.title || ''),
    author: String(record.author || ''),
    chapterCount: Number(record.chapterCount) || 0,
    charCount: Number(record.charCount) || 0,
    addedAt,
    // 记录通道按 updatedAt 判新旧（recordTime）：缺了就回退 addedAt，再缺才用现在 ——
    // 空串比不过任何有效时间戳，会让远端的旧值永远赢
    updatedAt: String(record.updatedAt || addedAt || now())
  }
}

/** 要 PUT 上去的书体原文；不是一整本（没有章节 / id 形状不对）就回 ''，不传半本 */
export function bookBodyText(record) {
  if (!record || typeof record !== 'object') return ''
  if (!isByoBookId(String(record.bookId || ''))) return ''
  if (!Array.isArray(record.chapters) || !record.chapters.length) return ''
  return JSON.stringify(record)
}

/**
 * 租户一致性闸（纯函数）。正文的租户由**会话**决定，元信息却走**同步码**通道 —— 两者
 * 不同源：登录认领还没跑完就导入，正文会落进账号目录、元信息却指向旧游客码，别的设备
 * 拿着账号码就永远看不到这本。宁可这一轮不写元信息（正文已经在云上，下次自愈）。
 */
export function tenantReady({ accountCode, localCode } = {}) {
  const a = String(accountCode || '')
  return !!a && a === String(localCode || '')
}

/** PUT 书体。恒不抛：网络 / 超时 / 非 2xx 都回 { ok:false } */
export async function uploadBookBody(bookId, text, {
  fetchImpl = globalThis.fetch, timeoutMs = BOOK_UPLOAD_TIMEOUT_MS
} = {}) {
  if (!isByoBookId(bookId) || !text) return { ok: false, status: 0, reason: 'bad-input' }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${BOOK_ROUTE}${encodeURIComponent(bookId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: text,
      signal: ctrl ? ctrl.signal : undefined
    })
    return { ok: !!(res && res.ok), status: Number((res && res.status) || 0) }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 一本 BYO 书的完整上云：正文 PUT → 元信息写进记录通道（标脏，等下一次推送）。
 * 元信息**跟着正文走**：正文没上去就不写元信息。**恒不抛**（与 uploadBookBody 同姿态）——
 * 存储层抛（配额 / 形状坏了）时正文已经在云上，只回 metaWritten:false。
 * @returns {{ok:boolean, bookId?:string, reason?:string, status?:number, metaWritten?:boolean}}
 */
export async function publishByoBook(record, {
  accountCode = '', localCode = '', fetchImpl = globalThis.fetch, putMeta = putRecord
} = {}) {
  const meta = bookMetaPayload(record)
  if (!meta) return { ok: false, reason: 'bad-record' }
  // 有意上云 ＝ 撤销退役（第 16.5 步块 4）：重新导入同一本要能回来。放在租户闸之前 ——
  // 离线重新导入也得先撤销，否则这笔永远卡在退役名单里发不出去（台账会记着，下次登录补）。
  clearBookRetired(meta.bookId)
  if (!tenantReady({ accountCode, localCode })) {
    markPendingPublish(meta.bookId) // 还没登录 / 认领没跑完 -> 记着，登录后自动补
    return { ok: false, reason: 'tenant-not-ready' }
  }
  const text = bookBodyText(record)
  const up = await uploadBookBody(meta.bookId, text, { fetchImpl })
  if (!up.ok) {
    markPendingPublish(meta.bookId) // 弱网 / 5xx -> 记着，下次登录或下次开书架补
    return { ok: false, reason: 'upload-failed', status: up.status }
  }
  let written = null
  try { written = putMeta('book', meta, { id: meta.bookId }) } catch { written = null }
  clearPendingPublish(meta.bookId) // 上云成功 -> 台账划掉
  return { ok: true, bookId: meta.bookId, metaWritten: !!written }
}

/**
 * 落盘之后调它（导入流程只写这一行）：读会话与同步码 → 上云。
 * **不 await、不抛** —— 调用方在导入流程里，不该为一次上云多等一秒；
 * 书体取自**盘上那份**（loadBook），与 IndexedDB 里存的逐字一致。
 */
export function publishByoBookInBackground(bookId) {
  void (async () => {
    try {
      if (!isByoBookId(bookId)) return
      const [{ loadBook }, { useAuth }, { useSync }] = await Promise.all([
        import('../storage/index.js'),
        import('../composables/useAuth.js'),
        import('../composables/useSync.js')
      ])
      const auth = useAuth()
      const sync = useSync()
      const record = await loadBook(bookId)
      const r = await publishByoBook(record, {
        accountCode: auth.user.value && auth.user.value.syncCode,
        localCode: sync.code.value
      })
      // 元信息已标脏；催一次推送，别等到下次词表变动才顺带上去
      if (r.ok) sync.pushSoon()
    } catch { /* 上云失败不打断阅读：本机正文已经在（§12.6） */ }
  })()
}

// ── 块 3：账号 → 本机（预取整本）＋ 本机 → 账号（补登记）────────────────────

/**
 * 云书对账的**可见**状态（书架据此画「加载中」并在落盘后重列）。
 * 与 useSync 的 state 同姿态：模块级 reactive，跨组件共享同一份。
 */
export const bookSyncState = reactive({
  prefetching: false, // 这一趟正在拉书（有活才为真 —— 书架据此把云书那几行画成「加载中」）
  queued: 0,          // 这一趟要拉的本数（账号里有、本机没有的）—— 同步卡据此显示「正在加载」
  revision: 0,        // 每往本机落盘一本 +1 —— 书架 watch 它重列
  failedIds: []       // 上一趟没拉下来的 bookId（书架把这几行画成「重试」，不再和「没拉」同形）
})

/** 记录通道里属于账号的书（kind='book'）：跳过墓碑、跳过形状坏的 —— 纯函数 */
export function cloudBookMetas(recordsMap, tombstones) {
  const tombs = tombstones || {}
  const out = []
  for (const [key, payload] of Object.entries(recordsMap || {})) {
    if (tombs[key]) continue // 这条键有墓碑＝云端已删，别把它又拉回本机
    const sp = splitRecordKey(key)
    if (!sp || sp.kind !== 'book') continue
    const meta = bookMetaPayload(payload)
    if (meta && meta.bookId === sp.id) out.push(meta)
  }
  return out
}

/**
 * 本机 -> 账号：这一趟该补发哪几本（纯函数，专门钉住「删了又活」）。
 * 候选取**并集**（同一本只发一次）：
 *   · 台账里欠着的（导入时没登录 / 那次上传失败 —— 一次明确的「我要这本」）；
 *   · 本机书架上有、账号没有的（无 meta、也无墓碑）—— 这是**功能上线前导入的书**唯一的
 *     补登记路径（那时还没有台账这回事）。
 * 再减掉退役名单：删过的书不许因为「本机还有正文」被重新推上去。
 */
export function planLocalPublish({ localIds, recordsMap, tombstones, pending, retired } = {}) {
  const recs = recordsMap || {}
  const tombs = tombstones || {}
  const gone = new Set((retired || []).filter(isByoBookId))
  const out = new Set()
  for (const id of pending || []) if (isByoBookId(id)) out.add(id)
  for (const id of localIds || []) {
    if (!isByoBookId(id)) continue
    if (recs['book:' + id] || tombs['book:' + id]) continue // 账号已有 / 本机删了还没推出去
    out.add(id)
  }
  return [...out].filter((id) => !gone.has(id))
}

/**
 * 这台设备还没有的云书（纯函数）：本机已有的不再拉，**退役名单上的也不拉**
 * （删过的书不许被自动预取拉回来 —— 第 16.5 步块 4；显式点「下载」那条路不受影响）。
 */
export function planPrefetch(metas, localIds, retired) {
  const have = new Set(localIds || [])
  const gone = new Set((retired || []).filter(isByoBookId))
  return (metas || []).filter((m) => m && isByoBookId(m.bookId)
    && !have.has(m.bookId) && !gone.has(m.bookId))
}

/** GET 书体。恒不抛；不是一整本的也算失败（宁可下次再拉，不落半本） */
export async function fetchBookBody(bookId, {
  fetchImpl = globalThis.fetch, timeoutMs = BOOK_UPLOAD_TIMEOUT_MS
} = {}) {
  if (!isByoBookId(bookId)) return { ok: false, status: 0, reason: 'bad-id' }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${BOOK_ROUTE}${encodeURIComponent(bookId)}`, {
      signal: ctrl ? ctrl.signal : undefined
    })
    if (!res || !res.ok) return { ok: false, status: Number((res && res.status) || 0) }
    let record = null
    try { record = await res.json() } catch { return { ok: false, status: 0, reason: 'bad-json' } }
    if (!record || record.bookId !== bookId) return { ok: false, status: 0, reason: 'bad-book' }
    if (!Array.isArray(record.chapters) || !record.chapters.length) return { ok: false, status: 0, reason: 'bad-book' }
    return { ok: true, status: 200, record }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 把账号里有、这台设备没有的书体拉下来落盘。逐本独立 —— 一本拉不动不影响别的
 * （§12.6：会话过期 → 静默，下次登录补）。
 */
export async function prefetchCloudBooks({ metas, localIds, retired, getBody = fetchBookBody, save, onSaved, getIndex = fetchCloudIndex, saveIndex = saveAudioIndex } = {}) {
  const saved = [], failed = []
  for (const meta of planPrefetch(metas, localIds, retired)) {
    const r = await getBody(meta.bookId)
    if (!r.ok || !r.record) { failed.push(meta.bookId); continue }
    try {
      if (save) await save(r.record)
      saved.push(meta.bookId)
      // 块 E「预取带 index」：书体落地后顺手把就绪清单也存下（拿不到就不存，不影响预取结果）
      await stashCloudIndex(meta.bookId, { getIndex, saveIndex })
      if (onSaved) onSaved(meta.bookId)
    } catch { failed.push(meta.bookId) }
  }
  return { saved, failed }
}

/**
 * 块 E「预取带 index」：把一本书的云端就绪索引拉回来、落到本机缓存。**恒不抛** ——
 * 索引只是让「打开书的首帧就知道哪几章有云端音色」，拉不到就当没缓存（打开书时那条路照旧）。
 * @returns {Promise<boolean>} 真存下了才 true
 */
export async function stashCloudIndex(bookId, { getIndex = fetchCloudIndex, saveIndex = saveAudioIndex } = {}) {
  try {
    const r = await getIndex(bookId)
    if (!r || !r.ok) return false
    if (!indexUsable(r.index, bookId)) return false // `book` 字段对不上 → 宁缺勿错
    return !!saveIndex(bookId, r.index)
  } catch { return false }
}

/** 只拉一本（书架那条「下载」按钮走这里） */
export async function downloadCloudBook(bookId, { getBody = fetchBookBody, save, getIndex = fetchCloudIndex, saveIndex = saveAudioIndex } = {}) {
  if (!isByoBookId(bookId)) return { ok: false, reason: 'bad-id' }
  const r = await getBody(bookId)
  if (!r.ok || !r.record) return { ok: false, reason: 'fetch-failed', status: r.status }
  try {
    if (save) await save(r.record)
  } catch {
    return { ok: false, reason: 'save-failed' }
  }
  // 块 E：单本下载（书架那颗「加载」按钮）与预取同一条口径 —— 一并把就绪清单带下来
  await stashCloudIndex(bookId, { getIndex, saveIndex })
  return { ok: true, bookId }
}

/**
 * 「一趟只能有一个」的排队器（第 16.6 步 · 修「对账漏拍」）。
 *
 * 病：对账原来拿一个 `_reconciling` 布尔去重，撞上正在飞的一趟就**直接 return**，没有补跑
 * 机制 —— 点 Sync 那一瞬正好有趟在对账（书架刚打开、或上一趟还在收尾），新合并进来的那本书
 * 就永远轮不到，界面一直停在「在你的账号里 · 本机没有」，只能手点「加载」。
 * 药：撞车时记一个补跑标记，跑完**自动补一趟**。对账本身就是「以账号与本机的差集为准」，
 * 天然幂等，多跑一趟的代价只是几次空转的读盘。
 *
 * 抽成独立函数是为了能**单测**：真对账要会话 ＋ IndexedDB，跑不起来；这里只认 `run`，
 * 注入一个计数替身就能钉住「撞车会补跑」。
 */
export function createSingleFlight(run) {
  let current = null
  let rerun = false
  return function kick() {
    if (current) { rerun = true; return current } // 撞车：不丢这次请求，等它跑完再补一趟
    current = (async () => {
      try {
        let out
        do { rerun = false; out = await run() } while (rerun)
        return out
      } finally { current = null }
    })()
    return current
  }
}

/** 可 await 的对账入口：「Sync now」用它 —— 书体走另一条路，也得跟着对一次账 */
export function reconcileBooksNow() { return _reconcileFlight() }

/** 后台版（不 await、不抛）：登录 / 打开书架用 */
export function reconcileBooksInBackground() {
  reconcileBooksNow().catch(() => { /* 对账失败不影响本机阅读：下次登录 / 下次开书架再来 */ })
}

/**
 * 对账一趟，**三个方向都走**：
 *   ② 本机 → 账号：补发 —— 台账欠着的 ∪ 本机有、账号没有的（功能上线前导入的书），
 *      减退役名单（判据见 planLocalPublish）。上传成功一定会留下 meta，所以天然幂等，
 *      **不会**每次登录把整本重传一遍；
 *   ① 账号 → 本机：预取整本（D14-a「登录后自动后台预取」），退役名单上的不拉；
 *   ③ 收尾：墓碑/退役名单上的书，再删一次云端对象（幂等，补「删书那次 R2 没删掉」的残留）。
 * **不抛、同时只跑一趟**（撞车的那次由 createSingleFlight 补跑）；失败静默
 * （书体同步是附加动作，不该卡住登录或书架）。
 */
const _reconcileFlight = createSingleFlight(async () => {
  try {
    const [{ useAuth }, { useSync }, storage] = await Promise.all([
      import('../composables/useAuth.js'),
      import('../composables/useSync.js'),
      import('../storage/index.js')
    ])
    const { loadBook, listByoBooks, saveBook } = storage
    const auth = useAuth()
    const sync = useSync()
    const user = auth.user.value
    if (!user) return // 边界＝账号（D14-b）：没登录就没有「账号里的书」
    const accountCode = user.syncCode
    const localCode = sync.code.value

    const localIds = (await listByoBooks()).map((m) => m.id)

    // ② 本机 → 账号：补发。候选 = 台账欠着的 ∪ 本机有、账号没有的（功能上线前导入的书），
    //    减退役名单（删过的书不许复活）。判据见 planLocalPublish —— 单看「记录通道里没有
    //    meta」不够：删除只留墓碑、不留 meta，那会把已删的书又发回账号（删了又活）。
    let published = 0
    for (const bookId of planLocalPublish({
      localIds,
      recordsMap: loadRecordsMap(),
      tombstones: loadRecordTombstones(),
      pending: loadPendingPublish(),
      retired: loadRetiredBooks()
    })) {
      const record = await loadBook(bookId)
      if (!record) { clearPendingPublish(bookId); continue } // 本机也没了 -> 台账清掉
      const r = await publishByoBook(record, { accountCode, localCode })
      if (r.ok) published++
    }
    if (published) sync.pushSoon()

    // ① 账号 → 本机：预取整本（D14-a）。候选先算出来 —— 同步卡要显示「正在加载几本」，书架
    //    要据此把这几行画成「加载中」；退役名单上的不拉（判据见 planPrefetch）。
    const metas = cloudBookMetas(loadRecordsMap(), loadRecordTombstones())
    const retiredNow = loadRetiredBooks()
    const candidates = planPrefetch(metas, localIds, retiredNow)
    bookSyncState.queued = candidates.length
    bookSyncState.prefetching = candidates.length > 0
    const r = await prefetchCloudBooks({
      metas: candidates,
      localIds,
      retired: retiredNow,
      save: (rec) => saveBook(rec),
      onSaved: () => { bookSyncState.revision++ }
    })
    bookSyncState.failedIds = r.failed // 把没拉下来的**点名**记下来：界面据此画「重试」，不再和「没拉」同形
    bookSyncState.queued = 0
    bookSyncState.prefetching = false

    // ③ 收尾：墓碑/退役名单上的书，再删一次云端对象（幂等）。覆盖「上次删的时候离线、或 R2
    //    打了个嗝」—— 那些正文会变成账号目录里看不见的残留；墓碑推成功后会被清掉，所以只靠
    //    墓碑会漏掉残留，退役名单这条正是补它（D14-c 的收尾）。本地记录表里还有 meta 的
    //    （别处重新建回来了）跳过：宁可留着数据，不删别人刚建的书。
    //    并发发出去、不逐本串等 —— 每本一个 DELETE，串等会把「一趟在对账」的窗口拉长，
    //    窗口越长，点 Sync 时撞车的机会越多（第 16.6 步修的就是这个）。
    const recsNow = loadRecordsMap()
    const wipe = new Set(loadRetiredBooks().filter((id) => !recsNow['book:' + id]))
    for (const key of Object.keys(loadRecordTombstones())) {
      const sp = splitRecordKey(key)
      if (sp && sp.kind === 'book' && isByoBookId(sp.id)) wipe.add(sp.id)
    }
    await Promise.all([...wipe].map((id) => deleteCloudBookBody(id)))
  } catch { /* 对账失败不影响本机阅读：下次登录 / 下次开书架再来 */ } finally {
    bookSyncState.prefetching = false
    bookSyncState.queued = 0
  }
})

/** DELETE 云端书体（第 16 步块 4）。恒不抛；URL 里同样不带 code。 */
export async function deleteCloudBookBody(bookId, {
  fetchImpl = globalThis.fetch, timeoutMs = BOOK_UPLOAD_TIMEOUT_MS
} = {}) {
  if (!isByoBookId(bookId)) return { ok: false, status: 0, reason: 'bad-id' }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${BOOK_ROUTE}${encodeURIComponent(bookId)}`, {
      method: 'DELETE',
      signal: ctrl ? ctrl.signal : undefined
    })
    return { ok: !!(res && res.ok), status: Number((res && res.status) || 0) }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 删一本自带书（第 16 步块 4 / D14-c「删书同步删云端」）。顺序有讲究：
 *   ① **本机先删**（确定性）：记录通道里的 meta ＋ 删除台账（离线也要能收敛 —— 台账会由
 *      下一次推送变成服务端墓碑，别的设备拉到来就跟着丢）+「待发布」台账划掉。meta 一消失
 *      就自动记入**永久退役名单**（第 16.5 步块 4，见 recordStore 那条不变式）—— 对账补发
 *      时跳过它，删掉的书不会因为「本机还剩正文」被重新推回账号；
 *   ② 本机正文与书架索引（IndexedDB）；
 *   ③ 云端对象**尽力**删（失败不假装成功：`cloud:false` 如实回报 —— 残留最多 8 MB，
 *      看不见也读不到，账号那边已经没有这本书了）。
 * 只做 ①②③，**不动别的设备的本地正文**：别的设备是「本机那份」的主人，删不删由它自己决定
 * （这一条是保守选择，等 Ferrari 裁）。
 * @returns {{ok:boolean, reason?:string, cloud?:boolean, cloudStatus?:number, localDeleted?:boolean}}
 */
export async function removeByoBookEverywhere(bookId, { fetchImpl = globalThis.fetch, deleteLocal = null } = {}) {
  if (!isByoBookId(bookId)) return { ok: false, reason: 'bad-id' }
  removeRecord('book', bookId, { record: true, dirty: true })
  clearPendingPublish(bookId)
  clearAudioIndex(bookId) // 块 E：删书连带清本机缓存的那份就绪清单（云端的由服务端 DELETE 同趟清）
  let localDeleted = false
  try { if (deleteLocal) localDeleted = !!(await deleteLocal(bookId)) } catch { localDeleted = false }
  const cloud = await deleteCloudBookBody(bookId, { fetchImpl })
  return { ok: true, bookId, localDeleted, cloud: cloud.ok, cloudStatus: cloud.status }
}