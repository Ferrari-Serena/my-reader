/**
 * 封面 data URL（第 7 步 7.4）：用户自带 EPUB 的内嵌封面。
 *
 * 为什么存 data URL 字符串、而不是 Blob：
 *   · 与内置书的 coverUrl 合成**同一个字段** —— BookCard / metaOf 不用为 BYO 分叉；
 *   · 自检脚本跑在 Node 上，字符串能直接断言，不必引入 Blob / createObjectURL 那套浏览器 API
 *     （objectURL 还要管 revoke 生命周期，忘了就泄漏）。
 * 代价是约 33% 的 base64 膨胀，靠 COVER_MAX_BYTES 封顶（超了就当没有封面，回占位图）。
 *
 * 本模块**不 import 任何东西**：生产端（import/book.js）与存储/书架端
 * （storage/bookAdapter.js、utils/bookShelf.js）都要用它，挂在任一侧都会形成环。
 */

/** 原图上限 512 KB：一本带 5 MB 扫描封面的书不该把书架页拖慢 */
export const COVER_MAX_BYTES = 512 * 1024

/** data URL 长度上限（base64 每 3 字节 -> 4 字符，另留 media-type 前缀余量） */
export const COVER_MAX_DATA_URL = 4 * Math.ceil(COVER_MAX_BYTES / 3) + 64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/

/** 手写 base64：不碰 btoa 的二进制串坑，且浏览器 / Node 行为完全一致 */
export function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])
  let out = ''
  for (let i = 0; i < b.length; i += 3) {
    const rem = b.length - i
    const n = (b[i] << 16) | ((rem > 1 ? b[i + 1] : 0) << 8) | (rem > 2 ? b[i + 2] : 0)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (rem > 1 ? B64[(n >> 6) & 63] : '=') + (rem > 2 ? B64[n & 63] : '=')
  }
  return out
}

/**
 * { bytes, mediaType } -> data URL。任一条不满足就回 ''（调用方回占位图）：
 * media-type 不是图片 / 空字节 / 超过 COVER_MAX_BYTES。
 */
export function coverDataUrl(cover) {
  const mediaType = String(cover?.mediaType || '').trim().toLowerCase()
  if (!/^image\/[a-z0-9.+-]+$/.test(mediaType)) return ''
  const bytes = cover?.bytes
  if (!bytes || !bytes.length) return ''
  if (bytes.length > COVER_MAX_BYTES) return ''
  return `data:${mediaType};base64,${bytesToBase64(bytes)}`
}

/** 只认自己产的那种串（strict：不做 trim，前后带空白一律不算） */
export function isCoverDataUrl(value) {
  if (typeof value !== 'string' || !value) return false
  if (value.length > COVER_MAX_DATA_URL) return false
  return DATA_URL_RE.test(value)
}
