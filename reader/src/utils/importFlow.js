/**
 * 自带书导入流程的纯逻辑（第 5 步 5C）—— 「按钮什么时候能点」「这个失败该说什么」
 * 「这个百分比能不能信」这类判断，埋在组件里就测不到，全放这儿；组件只做渲染与调用。
 *
 * 口径来源：格式/上限/错误文案都从 import/errors.js 取（5A 定的唯一副本），
 * 这里不另抄一份表 —— 抄了迟早跟解析层说的不一样。
 */
import { ImportError, IMPORT_LIMITS } from '../import/errors.js'

export const IMPORT_STEP = {
  IDLE: 'idle',       // 等着选文件 / 选好了等着点导入
  READING: 'reading', // 把文件读进内存
  PARSING: 'parsing', // 解码 / 切章
  SAVING: 'saving',   // 落 IndexedDB
  DONE: 'done',
  ERROR: 'error'
}

/** file input 的 accept：扩展名为主，补两种 MIME 给系统选择器兜底 */
export const ACCEPT_ATTR = '.epub,.pdf,.txt,.text,application/epub+zip,application/pdf,text/plain'

/** 「大到该提醒一句」的线（不是上限；上限见 IMPORT_LIMITS.MAX_FILE_MB） */
export const HEAVY_FILE_MB = 50

/** 'My Book.epub' -> 'My Book'（导入默认书名，与 5A 的 title 缺省同口径） */
export function stripExt(name) {
  return String(name || '').replace(/\.[a-z0-9]+$/i, '').trim()
}

/** 人看的字节数 */
export function formatBytes(n) {
  const b = Math.max(0, Number(n) || 0)
  if (b < 1024) return `${Math.round(b)} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 大到该提醒一声（解析这类文件会明显吃内存与时间） */
export function isHeavy(size) {
  return (Number(size) || 0) >= HEAVY_FILE_MB * 1024 * 1024
}

/**
 * 选中文件后的**先验检查**（只看文件名与大小，不读内容）。
 * 存在的意义：别为了发现「超限」，先把 100 MB 读进内存再说。
 * 口径与 5A 的 importBook 同源（同一个 IMPORT_LIMITS / 同一组错误码），这里只是更早一步挡。
 * @throws {ImportError}
 */
export function preflightFile(file) {
  const size = Number((file && file.size) || 0)
  const name = String((file && file.name) || '')
  if (!size) throw new ImportError('EMPTY_CONTENT', `size=0 (${name})`)
  if (size > IMPORT_LIMITS.MAX_FILE_BYTES) throw new ImportError('FILE_TOO_BIG', `${size} bytes (${name})`)
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]
  if (!/^(epub|pdf|txt|text)$/i.test(String(ext || ''))) throw new ImportError('UNSUPPORTED_FORMAT', name)
  return true
}

/**
 * 解析层回报的 { stage, loaded, total } -> 0..100；拿不到就 null（进度条走不定式）。
 * 夹在 0..100：total 为 0 / loaded 越界时，进度条不许跑出格子。
 */
export function progressPercent(progress) {
  if (!progress || typeof progress !== 'object') return null
  const total = Number(progress.total)
  const loaded = Number(progress.loaded)
  if (!Number.isFinite(total) || !Number.isFinite(loaded) || total <= 0) return null
  const pct = (loaded / total) * 100
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return pct >= 100 ? 100 : pct
}

const STEP_TEXT = {
  [IMPORT_STEP.READING]: 'Reading the file...',
  [IMPORT_STEP.PARSING]: 'Reading the text...',
  [IMPORT_STEP.SAVING]: 'Saving to this device...'
}

/** 步骤 -> 正在干什么 */
export function stepText(step) {
  return STEP_TEXT[step] || 'Working...'
}

/** 是不是用户自己按了「取消」—— 得跟真失败分开说，取消不是错误 */
export function isCancelled(err) {
  return !!err && err.code === 'CANCELLED'
}

const STORE_ERROR_TEXT = {
  UNAVAILABLE: {
    message: 'This browser is not letting the app store books on this device.',
    hint: 'Private browsing blocks local storage. Try a normal window, or another browser.'
  },
  TX_FAILED: {
    message: 'The book could not be saved to this device.',
    hint: 'Free up some disk space and try again.'
  },
  BLOCKED: {
    message: 'Another tab is holding an older version of the book store.',
    hint: 'Close the other my-reader tabs and try again.'
  },
  OPEN_FAILED: {
    message: 'The book store could not be opened on this device.',
    hint: 'Try reloading the page.'
  }
}

const UNKNOWN_TEXT = {
  message: 'Something went wrong while importing this file.',
  hint: 'Try again, or use a different copy of the book.'
}

/**
 * 任意异常 -> 给用户看的 { code, message, hint }。
 * 认得出的码说人话；认不出的**不把技术消息漏给用户**（那对读者没有意义）。
 */
export function errorText(err) {
  const code = err && typeof err.code === 'string' ? err.code : ''
  if (code && STORE_ERROR_TEXT[code]) return { code, ...STORE_ERROR_TEXT[code] }
  // 带 code ＋ hint 的（ImportError 一族）：它的 message 本来就是给人看的，原样带上。
  // 这里**不能**过 toImportError —— 那是「兜住裸异常」用的，会把别人的码改写成 PDF_INVALID。
  if (code && typeof err.hint === 'string' && err.hint) {
    return {
      code,
      message: typeof err.message === 'string' && err.message ? err.message : 'Could not import this file.',
      hint: err.hint
    }
  }
  return { code: code || 'UNKNOWN', ...UNKNOWN_TEXT }
}

/** 同一份文件已经在这台设备的书架上（bookId 是内容指纹，天然认得出来） */
export function alreadyOnShelfText() {
  return {
    code: 'ALREADY_ON_SHELF',
    message: 'This book is already on your shelf.',
    hint: 'Open it from My Books. Importing again would change nothing.'
  }
}

/** 「开始导入」能不能点：勾了版权、选了文件、且没在忙 */
export function canStart({ consent, file, busy } = {}) {
  return !!consent && !!file && !busy
}
