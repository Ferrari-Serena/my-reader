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
import { runParseInWorker, hasWorkerSupport } from './workerClient.js'
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

/** TXT / EPUB 的主线程同步解析（Node、无 Worker 环境、以及 worker 基础设施失败后的唯一回退）。 */
function parseSync(format, bytes, title) {
  return format === 'epub' ? parseEpub(bytes, { title }) : parseTxt(bytes, { title })
}

/**
 * 能不能把 TXT / EPUB 丢给 Worker：浏览器看全局 Worker；单测里注入 workerFactory 也算
 * （Node 没有 Worker 全局，但假 Worker 足以验证协议与路由）。
 */
function canUseWorker(options) {
  return typeof options.workerFactory === 'function' || hasWorkerSupport()
}

/**
 * input：File（浏览器）或 { name, bytes }（测试）。
 * options：{ title, pdfjs, onProgress, signal, format }
 * 返回 makeBook 的产物：{ bookId, title, author, chapters, coverUrl, chapterCount, paragraphCount, charCount }
 */
export async function importBook(input, options = {}) {
  // 取消口（第 5 步 5.5）：PDF 逐页 await，信号能真打断；TXT / EPUB 在浏览器里进 Worker 后，
  // abort 直接 terminate 也能真打断（RK-15）。只有 Node / 无 Worker 的同步回退路径，
  // 才只能在进它之前和出它之后各查一次。
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
  let bookId
  if (format === 'pdf') {
    // PDF 路径不动：pdfjs 在 Worker 里还要额外处理 workerSrc，不在本任务范围。
    parsed = await parsePdf(bytes, { ...options, title })
    throwIfAborted(signal)
    bookId = await bookIdFromBytes(bytes)
  } else if (canUseWorker(options)) {
    // 先算 bookId 再交接：worker 拿到的是副本，但指纹顺序仍先定，
    // 也避免任何 transfer 语义变化把原始字节弄丢。
    bookId = await bookIdFromBytes(bytes)
    try {
      parsed = await runParseInWorker({
        format,
        bytes,
        title,
        signal,
        workerFactory: options.workerFactory,
      })
    } catch (err) {
      // 只有基础设施失败才回退一次主线程；格式/内容错误（ImportError）原样上抛，不回退。
      if (!err || !err.workerInfraFailure) throw err
      throwIfAborted(signal)
      parsed = parseSync(format, bytes, title)
      throwIfAborted(signal)
    }
    throwIfAborted(signal)
  } else {
    // Node / 无 Worker：保持原来的同步路径。
    parsed = parseSync(format, bytes, title)
    throwIfAborted(signal)
    bookId = await bookIdFromBytes(bytes)
  }

  return makeBook({
    bookId,
    title: parsed.title || title,
    author: parsed.author || '',
    chapters: parsed.chapters || [],
    cover: parsed.cover || null,
  })
}
