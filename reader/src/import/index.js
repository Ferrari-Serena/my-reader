/**
 * BYO 导入入口（第 5 步 5.1–5.3）：一个文件 -> 一本可以进书架的「书」。
 *
 * 解析在浏览器端做（D3），书不出设备；产物形状与服务端静态书一致（见 book.js）。
 * 5B 负责把这本书落进 IndexedDB，5C 负责上传 UI（进度/取消/错误提示）。
 */
import { ImportError, throwIfAborted } from './errors.js'
import { MAX_FILE_BYTES, MAX_FILE_MB, formatOf, makeBook, collapse } from './book.js'
import { parseTxt } from './txt.js'
import { parseEpub } from './epub.js'
import { parsePdf } from './pdf.js'
import { bookIdFromBytes } from '../utils/bookId.js'

export { MAX_FILE_BYTES, MAX_FILE_MB, formatOf }
export { ImportError } from './errors.js'
export { chapterId, paragraphId, makeBook } from './book.js'

function toBytes(x) {
  if (!x) return null
  if (x instanceof Uint8Array) return x
  if (x instanceof ArrayBuffer) return new Uint8Array(x)
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
  return null
}

/**
 * input：File（浏览器）或 { name, bytes }（测试）。
 * options：{ title, pdfjs, onProgress, signal, format }
 * 返回 makeBook 的产物：{ bookId, title, author, chapters, coverUrl, chapterCount, paragraphCount, charCount }
 */
export async function importBook(input, options = {}) {
  // 取消口（第 5 步 5.5）：PDF 逐页 await，信号能真打断；TXT / EPUB 是一次同步解码，
  // 只能在进它之前和出它之后各查一次 —— 骗人说「随时可取消」不如说清哪一段取消不了。
  const signal = options.signal
  throwIfAborted(signal)
  const name = input && input.name ? String(input.name) : String(options.name || '')
  let bytes = toBytes(input && input.bytes)
  if (!bytes && input && typeof input.arrayBuffer === 'function') {
    bytes = new Uint8Array(await input.arrayBuffer())
  }
  if (!bytes) throw new ImportError('UNSUPPORTED_FORMAT', 'no bytes')
  throwIfAborted(signal)

  if (bytes.length > MAX_FILE_BYTES) throw new ImportError('FILE_TOO_BIG', `${bytes.length} bytes`)
  if (!bytes.length) throw new ImportError('EMPTY_CONTENT', 'empty file')

  const format = options.format || formatOf({ name, bytes })
  if (!format) throw new ImportError('UNSUPPORTED_FORMAT', name)

  const title = collapse(options.title) || name.replace(/\.[a-z0-9]+$/i, '')
  throwIfAborted(signal)
  let parsed
  if (format === 'txt') parsed = parseTxt(bytes, { title })
  else if (format === 'epub') parsed = parseEpub(bytes, { title })
  else parsed = await parsePdf(bytes, { ...options, title })

  throwIfAborted(signal)
  const bookId = await bookIdFromBytes(bytes)
  return makeBook({
    bookId,
    title: parsed.title || title,
    author: parsed.author || '',
    chapters: parsed.chapters || [],
    cover: parsed.cover || null,
  })
}
