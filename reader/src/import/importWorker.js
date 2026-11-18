/**
 * TXT / EPUB 解析 Worker（RK-15 根治）。
 *
 * 50 MB+ 的 TXT 解码（TextDecoder）与 EPUB 解包（fflate unzipSync）都是**同步**的，
 * 放在主线程里会整段卡死 UI。这里把同一对解析器搬进模块 Worker，协议只有一问一答：
 *
 *   in : { format: 'txt' | 'epub', bytes: ArrayBuffer, title: string }
 *   out: { ok: true, parsed } | { ok: false, error: { code, message } }
 *
 * 解析器一行不改 —— Worker 只是换了个线程跑 parseTxt / parseEpub，
 * 所以 worker 路径与主线程路径的产物天然一致（verify-import.mjs 有对照断言）。
 * 错误码沿用 errors.js 的 ImportError 码，不新增用户可见文案。
 */
import { parseTxt } from './txt.js'
import { parseEpub } from './epub.js'
import { IMPORT_ERRORS } from './errors.js'

/** 把解析器抛出的异常压成可结构化克隆的纯对象（Error 实例跨线程会丢自定义字段）。 */
function errorPayload(err) {
  const code = err && err.code && IMPORT_ERRORS[err.code] ? err.code : 'UNSUPPORTED_FORMAT'
  return {
    code,
    message: err && err.message ? String(err.message) : String(err),
  }
}

function toBytes(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return null
}

self.onmessage = (event) => {
  const data = (event && event.data) || {}
  const format = data.format
  const title = data.title ? String(data.title) : ''
  const bytes = toBytes(data.bytes)
  try {
    if (!bytes) throw new Error('worker: missing or invalid bytes')
    const parsed = format === 'epub'
      ? parseEpub(bytes, { title })
      : parseTxt(bytes, { title })
    self.postMessage({ ok: true, parsed })
  } catch (err) {
    self.postMessage({ ok: false, error: errorPayload(err) })
  }
}
