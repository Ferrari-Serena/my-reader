/**
 * 第 17 步（D17）· 块 E —— BYO 就绪索引的**本机缓存**（「预取带 index」的落点）。
 *
 * 为什么要缓存：索引现在只在「打开一本书」时拉一次（ReaderView.loadByoBook），那要等一个来回。
 * 预取（登录后把账号里的书体自动搬下来）本来就是「先把东西搬到位」的动作 —— 顺手把这本书的
 * 就绪清单也拉回来存着，B 设备打开同一本书时**第一帧就知道哪几章有云端音色**（判据 3：已生成章
 * 直接命中、不再触发本机生成），而不是先当「没有音色」再翻脸。
 *
 * **不是真相来源**：打开书时仍会再拉一次并覆盖它。缓存只负责让首帧不空转；别的设备新生成的
 * 章靠那次覆盖追平。删书时一并清掉（`removeByoBookEverywhere`）。
 *
 * 形状：一个 bookId 一份；上限 MAX_CACHED_BOOKS 本，按写入顺序淘汰最老的（防无界增长）。
 * 恒不抛（私有模式／配额满 → 退化成「没缓存」，不影响阅读；姿态同 `sync/bookSync.js`）。
 */
const CACHE_KEY = 'reader-audio-index'
export const MAX_CACHED_BOOKS = 40

function readAll() {
  try {
    const ls = globalThis.localStorage
    const raw = ls ? ls.getItem(CACHE_KEY) : null
    const obj = raw ? JSON.parse(raw) : null
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {}
  } catch { return {} }
}

function writeAll(map) {
  try {
    const ls = globalThis.localStorage
    if (ls) ls.setItem(CACHE_KEY, JSON.stringify(map))
  } catch { /* 配额满／私有模式：不缓存也不影响阅读 */ }
}

/** 形状体检：只认「像索引」的值（`withAudio` 是数组）——索引口径本身仍在 utils/audioIndex.js */
export function looksLikeIndex(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.withAudio)
}

export function loadAudioIndex(bookId) {
  if (!bookId) return null
  const v = readAll()[String(bookId)]
  return looksLikeIndex(v) ? v : null
}

export function saveAudioIndex(bookId, index) {
  if (!bookId || !looksLikeIndex(index)) return false
  const map = readAll()
  const id = String(bookId)
  delete map[id] // 先删再写：这本因此排到「最新」，淘汰从最老的开始
  map[id] = index
  const keys = Object.keys(map)
  if (keys.length > MAX_CACHED_BOOKS) {
    for (const k of keys.slice(0, keys.length - MAX_CACHED_BOOKS)) delete map[k]
  }
  writeAll(map)
  return true
}

export function clearAudioIndex(bookId) {
  if (!bookId) return false
  const map = readAll()
  const id = String(bookId)
  if (!(id in map)) return false
  delete map[id]
  writeAll(map)
  return true
}
