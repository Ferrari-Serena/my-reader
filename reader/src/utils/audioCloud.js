/**
 * 第 17 步（D17）· 块 D —— BYO 音频的**读取侧**：云端就绪索引 ＋ 音频／timings 路径。
 *
 * 为什么这段在 `utils/` 而不在 `src/generate/`：**主包不许引 `src/generate/`**
 * （体积 ＋ lamejs 的 LGPL 边界，见 `verify-generate.mjs` 的卫生断言），可「打开一本书读一次
 * 索引」是播放器的日常动作，必须留在主包。写入侧（生成后上传）在
 * `src/generate/audioUpload.js`，两边**共用这里的路径与索引口径** —— 键名与合并规则只有
 * 一份，免得服务端／读侧／写侧三处各写一套再各自漂。
 *
 * 服务端契约见 `worker/src/bookaudio.js`；索引结构与内置书**同形**，读取判定复用
 * `utils/audioIndex.js`（`chapterHasAudio` / `noAudioReason` / `tocMissingAudio`）。
 * URL **一律不含 code**（D16）：租户由会话反推 —— 未登录 401、账号没认领主码 403。
 */
export const AUDIO_ROUTE = '/api/book/'
/** 索引很小（一份章 id 清单），但终究是网络请求；给个短超时 */
export const INDEX_TIMEOUT_MS = 10000

/** 章级产物的路径（file 形如 `ch-01.mp3` / `ch-01.timings.json`） */
export function chapterAudioPath(bookId, file) {
  return `${AUDIO_ROUTE}${encodeURIComponent(bookId)}/audio/${encodeURIComponent(file)}`
}
/** 就绪索引的路径 */
export function bookIndexPath(bookId) {
  return `${AUDIO_ROUTE}${encodeURIComponent(bookId)}/audio-index.json`
}
/** 章音频 URL（播放器用） */
export function chapterAudioUrl(bookId, chapterId) {
  return chapterAudioPath(bookId, chapterId + '.mp3')
}
/** 章 timings URL（段落定位播放用） */
export function chapterTimingsUrl(bookId, chapterId) {
  return chapterAudioPath(bookId, chapterId + '.timings.json')
}

/** `audioPost.stitchChapter` 的结果 → 与内置书同形的 timings（照搬 `tts.py`：秒数两位小数已在 stitch 里） */
export function timingsOf(stitched) {
  const paragraphs = {}
  for (const [id, sec] of Object.entries((stitched && stitched.offsets) || {})) paragraphs[id] = sec
  const duration = stitched && Number.isFinite(stitched.duration) ? stitched.duration : 0
  return { duration, paragraphs }
}

/**
 * 把一章并进就绪索引（**纯函数**）。索引结构见 `utils/audioIndex.js`：
 *   `{ book, withAudio: [章id], missing: { 章id: 原因 } }`
 *   · `withAudio` 去重追加（顺序不参与判定，前端只做 includes）
 *   · 并入时把该章从 `missing` 里删掉（有音频了就不再是「没有」）
 *   · 索引缺失／形状坏 → 建一份新的（**不妄断别的章**）
 */
export function mergeAudioIndex(index, chapterId, bookId = '') {
  const id = String(chapterId || '')
  const base = (index && typeof index === 'object' && !Array.isArray(index)) ? index : {}
  const withAudio = Array.isArray(base.withAudio) ? base.withAudio.map(String) : []
  if (id && !withAudio.includes(id)) withAudio.push(id)
  const missing = (base.missing && typeof base.missing === 'object' && !Array.isArray(base.missing))
    ? { ...base.missing } : {}
  if (id) delete missing[id]
  return { book: String(base.book || bookId || ''), withAudio, missing }
}

/**
 * 拿到的索引是不是**这本书**的。`book` 字段对不上 → 一律当没拿到（宁缺勿错：
 * 拿错书的清单会让播放器去找根本不存在的章）。
 */
export function indexUsable(index, bookId) {
  if (!index || typeof index !== 'object' || Array.isArray(index)) return false
  return !index.book || String(index.book) === String(bookId || '')
}

/**
 * 拉某本书的云端就绪索引。**恒不抛**（与 `sync/bookSync.js` 同姿态）：
 *   200 → `{ ok:true, index }`（index 可能是 null —— JSON 坏了也不当错误）
 *   404 → `{ ok:false, status:404 }` 这本书还没生成过音频 —— **正常态**，不是错
 *   401 → `{ ok:false, status:401 }` 未登录 —— 不显示、不报错，退回浏览器朗读
 *   其它 → `{ ok:false, status, reason: 'http' | 'timeout' | 'network' }`
 */
export async function fetchCloudIndex(bookId, { fetchImpl = globalThis.fetch, timeoutMs = INDEX_TIMEOUT_MS } = {}) {
  if (!bookId) return { ok: false, status: 0, reason: 'bad-input' }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(bookIndexPath(bookId), { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
    const status = Number((res && res.status) || 0)
    if (!res || !res.ok) return { ok: false, status, reason: 'http' }
    let index = null
    try { index = await res.json() } catch { index = null }
    return { ok: true, status, index }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}