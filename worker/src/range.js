/**
 * HTTP Range 头解析（纯函数，不依赖 Cloudflare 全局 —— 可直接在 Node 里断言）。
 *
 * R2 的 get() 虽然也接受整个 Headers 去自己解析，但 R2 对「越界区间」没有干净的信号：
 * 预条件失败时返回的是 body === undefined 的 R2Object，与「对象不存在」无法区分。
 * 所以这里自己解析，好在 416 与 404 之间做出区分，也便于单测。
 *
 * 返回：
 *   { offset, length }  可满足的区间
 *   'unsatisfiable'     语法合法但越界/为空对象 → 调用方回 416
 *   null                没有 Range 头，或语法不认识（多段、单位不是 bytes 等）
 *                       → 调用方按 RFC 忽略该头，回整份 200
 */
export function parseRange(header, size) {
  if (typeof header !== 'string' || !header) return null
  if (!Number.isFinite(size) || size <= 0) return 'unsatisfiable'

  // 只认单段 bytes。多段（bytes=0-9,20-29）不匹配 → 返回 null 走整份 200，
  // 这是 RFC 允许的「服务器忽略 Range」，好过悄悄只回第一段。
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null // "bytes=-" 无意义

  let start, end
  if (rawStart === '') {
    // 后缀式 bytes=-N：最后 N 字节
    const n = Number(rawEnd)
    if (!Number.isFinite(n) || n <= 0) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(rawStart)
    // 末段式 bytes=N-：从 N 到文件尾；bytes=N-M 的 M 超出文件尾时截到文件尾
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start >= size || start > end) return 'unsatisfiable'
  return { offset: start, length: end - start + 1 }
}
