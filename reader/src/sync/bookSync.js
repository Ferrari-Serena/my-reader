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
 *
 * 为什么是独立 fetch（不走 useSync 的 apiFetch）：书体最大 8 MB，而 /api/sync 那条
 * keepalive 路径的预算是 64 KiB —— 一裁就整条丢。上传也不带 `keepalive`。
 */

import { reactive } from 'vue'
import { putRecord, removeRecord, loadRecordsMap, loadRecordTombstones } from './recordStore.js'
import { splitRecordKey } from './records.js'
import { nowIso } from './clock.js'

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
 * 云书对账的**可见**状态（书架据此画「下载中」并在落盘后重列）。
 * 与 useSync 的 state 同姿态：模块级 reactive，跨组件共享同一份。
 */
export const bookSyncState = reactive({
  prefetching: false, // 有一趟对账在飞
  revision: 0,        // 每往本机落盘一本 +1 —— 书架 watch 它重列
  failed: 0           // 上一趟里没拉下来的本数（诊断用，不弹给用户）
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

/** 这台设备还没有的云书（纯函数）：本机已有的不再拉 */
export function planPrefetch(metas, localIds) {
  const have = new Set(localIds || [])
  return (metas || []).filter((m) => m && isByoBookId(m.bookId) && !have.has(m.bookId))
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
export async function prefetchCloudBooks({ metas, localIds, getBody = fetchBookBody, save, onSaved } = {}) {
  const saved = [], failed = []
  for (const meta of planPrefetch(metas, localIds)) {
    const r = await getBody(meta.bookId)
    if (!r.ok || !r.record) { failed.push(meta.bookId); continue }
    try {
      if (save) await save(r.record)
      saved.push(meta.bookId)
      if (onSaved) onSaved(meta.bookId)
    } catch { failed.push(meta.bookId) }
  }
  return { saved, failed }
}

/** 只拉一本（书架那条「下载」按钮走这里） */
export async function downloadCloudBook(bookId, { getBody = fetchBookBody, save } = {}) {
  if (!isByoBookId(bookId)) return { ok: false, reason: 'bad-id' }
  const r = await getBody(bookId)
  if (!r.ok || !r.record) return { ok: false, reason: 'fetch-failed', status: r.status }
  try {
    if (save) await save(r.record)
  } catch {
    return { ok: false, reason: 'save-failed' }
  }
  return { ok: true, bookId }
}

let _reconciling = false

/**
 * 登录 / 打开书架时对账一次，**两个方向都走**：
 *   ① 账号 → 本机：预取整本（D14-a「登录后自动后台预取」）；
 *   ② 本机 → 账号：把**还没上云**的书补登记 —— 判据是「记录通道里没有 `book:<id>` 这条
 *      元信息」（当初导入时没登录，或那次上传失败）。上传成功一定会留下 meta，所以这一步
 *      天然幂等，**不会**每次登录把整本重传一遍。
 * **不 await、不抛、同时只跑一趟**；失败静默（书体同步是附加动作，不该卡住登录或书架）。
 */
export function reconcileBooksInBackground() {
  void (async () => {
    if (_reconciling) return
    _reconciling = true
    bookSyncState.prefetching = true
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

      // ② 本机 → 账号：只补发**明确欠着**的那几本（导入时没登录 / 那次上传失败）。
      //    判据是上面那张「待发布」台账，不是「记录通道里没有 meta」—— 后者会把
      //    「已经删掉的书」又发回账号（删除只留墓碑、不留 meta），删了又活。
      let published = 0
      for (const bookId of loadPendingPublish()) {
        const record = await loadBook(bookId)
        if (!record) { clearPendingPublish(bookId); continue } // 本机也没了 -> 台账清掉
        const r = await publishByoBook(record, { accountCode, localCode })
        if (r.ok) published++
      }
      if (published) sync.pushSoon()

      // ① 账号 → 本机：用刚刷新过的两张表（上面那批 meta 刚写进去）
      const metas = cloudBookMetas(loadRecordsMap(), loadRecordTombstones())
      const localIds = (await listByoBooks()).map((m) => m.id)
      const r = await prefetchCloudBooks({
        metas,
        localIds,
        save: (rec) => saveBook(rec),
        onSaved: () => { bookSyncState.revision++ }
      })
      bookSyncState.failed = r.failed.length

      // ③ 收尾：本机台账里还留着墓碑的书，再删一次云端对象（幂等）。覆盖「上次删的时候
      //    离线、或 R2 打了个嗝」—— 那些正文会变成账号目录里看不见的残留。台账推成功后
      //    会被清掉，所以这不是每次登录都白跑。
      for (const key of Object.keys(loadRecordTombstones())) {
        const sp = splitRecordKey(key)
        if (sp && sp.kind === 'book' && isByoBookId(sp.id)) await deleteCloudBookBody(sp.id)
      }
    } catch { /* 对账失败不影响本机阅读：下次登录 / 下次开书架再来 */ } finally {
      _reconciling = false
      bookSyncState.prefetching = false
    }
  })()
}

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
 *      下一次推送变成服务端墓碑，别的设备拉到来就跟着丢）+「待发布」台账划掉；
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
  let localDeleted = false
  try { if (deleteLocal) localDeleted = !!(await deleteLocal(bookId)) } catch { localDeleted = false }
  const cloud = await deleteCloudBookBody(bookId, { fetchImpl })
  return { ok: true, bookId, localDeleted, cloud: cloud.ok, cloudStatus: cloud.status }
}