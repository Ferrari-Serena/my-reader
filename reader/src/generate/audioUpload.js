/**
 * 第 17 步 · 块 C2 —— 把一章的产物传上**自己账号**的空间（接块 B 的 `/api/book/` 契约）
 *
 * 三次请求，**顺序不能反**：
 *   ① PUT /api/book/<bookId>/audio/<ch>.mp3            音频体
 *   ② PUT /api/book/<bookId>/audio/<ch>.timings.json   timings
 *   ③ GET ＋ 合并 ＋ PUT /api/book/<bookId>/audio-index.json
 * 索引**最后写**：前端靠轮询索引把 pending 翻成就绪（§13.2），mp3／timings 没到齐就翻，
 * 等于把「还没传完」当就绪播给用户（点下去 404）。
 *
 * 恒不抛（与 `bookSync.uploadBookBody` 同姿态）：回 `{ ok, step, status, reason }`，
 * 调用方按 status 分流 —— 403 配额满 / 429 限流 → 退回浏览器 TTS；其余 → 下次重试。
 * 路径与索引口径（`AUDIO_ROUTE`／`chapterAudioPath`／`mergeAudioIndex`…）的**权威在
 * `utils/audioCloud.js`** —— 主包侧（播放器读索引）也要用同一份，而主包不许引 `src/generate/`。
 *
 * 幂等：目标键唯一、上传是用户显式动作 → 同一章重传就是覆盖（R2 没有 create-if-absent，
 * 不需要锁，已核）。**URL 一律不含 code**（D16）：租户由会话反推。
 */
import {
  AUDIO_ROUTE, chapterAudioPath, bookIndexPath, timingsOf, mergeAudioIndex,
} from '../utils/audioCloud.js'
// 读侧（主包）与写侧共用同一份路径／索引口径；这里原样再导出，调用方不必知道分了几层
export {
  AUDIO_ROUTE, chapterAudioPath, bookIndexPath, timingsOf, mergeAudioIndex,
}

/** 一章 mp3 ≈ 5 MB，弱网下给足（与 bookSync 的 60 s 分开，这里多了音频体） */
export const UPLOAD_TIMEOUT_MS = 120000

/** 头尾一次请求。恒不抛 → `{ ok, status, reason }`；未 2xx 一律不 ok。 */
async function send(fetchImpl, url, init, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl ? ctrl.signal : undefined })
    const status = Number((res && res.status) || 0)
    if (!res || !res.ok) return { ok: false, status, reason: 'http' }
    return { ok: true, status }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 带体解析的 GET（只给索引读用）。JSON 坏了不算失败（回 data:null，让调用方自己建新的）。 */
async function getJson(fetchImpl, url, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined })
    const status = Number((res && res.status) || 0)
    if (!res || !res.ok) return { ok: false, status, reason: 'http' }
    let data = null
    try { data = await res.json() } catch { data = null }
    return { ok: true, status, data }
  } catch (e) {
    return { ok: false, status: 0, reason: (e && e.name === 'AbortError') ? 'timeout' : 'network' }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * 上传一章（mp3 ＋ timings ＋ 索引）。**恒不抛**。
 * @param {{bookId:string, chapterId:string, mp3:Uint8Array, timings:object,
 *          fetchImpl?:Function, timeoutMs?:number}} opts
 * @returns {Promise<{ok:boolean, step:string, status:number, reason?:string,
 *                    index?:object, mp3Bytes?:number}>}
 *   step ∈ input | mp3 | timings | read-index | index | done
 */
export async function uploadChapterAudio({
  bookId, chapterId, mp3, timings, fetchImpl = globalThis.fetch, timeoutMs = UPLOAD_TIMEOUT_MS
} = {}) {
  const bid = String(bookId || '')
  const ch = String(chapterId || '')
  if (!bid || !ch) return { ok: false, step: 'input', status: 0, reason: 'bad-input' }
  if (!mp3 || !mp3.byteLength) return { ok: false, step: 'input', status: 0, reason: 'empty-audio' }

  const r1 = await send(fetchImpl, chapterAudioPath(bid, ch + '.mp3'),
    { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: mp3 }, timeoutMs)
  if (!r1.ok) return { ok: false, step: 'mp3', status: r1.status, reason: r1.reason }

  const r2 = await send(fetchImpl, chapterAudioPath(bid, ch + '.timings.json'),
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(timings || {}) }, timeoutMs)
  if (!r2.ok) return { ok: false, step: 'timings', status: r2.status, reason: r2.reason }

  // 读现状再合并：404 = 第一次（建新的）；**别的错就中止** —— 宁可这章留在 pending，
  // 也不能拿一份空清单覆盖掉账号里别的章（那会让已就绪的章一起变回 pending）。
  const rIdx = await getJson(fetchImpl, bookIndexPath(bid), timeoutMs)
  if (!rIdx.ok && rIdx.status !== 404) {
    return { ok: false, step: 'read-index', status: rIdx.status, reason: rIdx.reason }
  }
  const next = mergeAudioIndex(rIdx.ok ? rIdx.data : null, ch, bid)

  const r3 = await send(fetchImpl, bookIndexPath(bid),
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }, timeoutMs)
  if (!r3.ok) return { ok: false, step: 'index', status: r3.status, reason: r3.reason }

  return { ok: true, step: 'done', status: 200, index: next, mp3Bytes: mp3.byteLength }
}