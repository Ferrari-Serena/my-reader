/**
 * BYO（自带书）的 bookId ＝ 内容指纹。口径见 Phase 1 方案 §4 第 3 步 3.5（Ferrari 2026-10-05 裁）。
 *
 *   bookId = 'bk_' + sha256(文件**原始字节**) 的前 16 个 hex 字符（64 bit）
 *
 * 为什么是内容指纹而不是文件名 / 顺序号：
 *   · 与文件名、路径无关 → 同一本书改名、挪目录都不会换 id（书内锚点不会漂）；
 *   · 同一份内容在任何设备上算出同一个 id → 天然去重、跨设备对齐；
 *   · 16 hex = 64 bit，撞的概率可忽略。
 * **存量 6 本书仍是 slug（the-giver / sat-practice / …），一个都不动**；
 * 只有 BYO 新书用指纹 —— 两者靠形状区分：slug 不含 'bk_' 前缀。
 *
 * 服务端 / 生成器按**同一算法**实现（生成器侧孪生见 generator/pipeline/bookid.py，
 * 两侧都以真 SHA-256 的 known-answer 值自证，不会悄悄漂移）。
 */

export const BOOK_ID_PREFIX = 'bk_'
export const BOOK_ID_HEX_LEN = 16

/** 从 sha256 hex 摘要取前 16 位拼成 bookId —— 纯函数，便于断言。hex 不足 16 位返回 '' */
export function bookIdFromHex(hex) {
  const clean = String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '')
  if (clean.length < BOOK_ID_HEX_LEN) return ''
  return BOOK_ID_PREFIX + clean.slice(0, BOOK_ID_HEX_LEN)
}

/** 形状判据：只有 BYO 书的 id 长这样 */
export function isBookId(v) {
  return typeof v === 'string' && /^bk_[0-9a-f]{16}$/.test(v)
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}

/** 原始字节 -> bookId。浏览器与 Node 都走 WebCrypto（crypto.subtle） */
export async function bookIdFromBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bookIdFromHex(toHex(digest))
}

/** 文本 -> bookId（便利函数：按 UTF-8 编码后取指纹） */
export async function bookIdFromText(text) {
  return bookIdFromBytes(new TextEncoder().encode(String(text)))
}
