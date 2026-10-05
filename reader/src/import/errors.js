/**
 * BYO 导入的错误口径（第 5 步 5.4）。
 *
 * 「每种失败给可读原因 + 建议动作」是 5.4 的硬要求，所以错误文本集中放这里，
 * 不让各解析器自己拼字符串 —— 否则同一类失败会冒出好几种说法。
 *
 * 消息一律英文：App 的界面语言是英文（VocabularyView / AccountView 同此）。
 */

/** 导入的硬限制（方案 D5：单本 50–100 MB）。book.js 从这里取，避免两处漂移。 */
export const IMPORT_LIMITS = {
  MAX_FILE_MB: 100,
  MAX_FILE_BYTES: 100 * 1024 * 1024,
}

/**
 * code -> { message（出了什么事）, hint（该怎么办） }
 * message 里的 {max} 会被 IMPORT_LIMITS.MAX_FILE_MB 替换。
 */
export const IMPORT_ERRORS = {
  UNSUPPORTED_FORMAT: {
    message: "This file type isn't supported.",
    hint: 'Use EPUB, PDF (with a text layer), or TXT.',
  },
  FILE_TOO_BIG: {
    message: 'This file is larger than the {max} MB limit.',
    hint: 'Split the book into smaller files, or use a copy under the limit.',
  },
  EPUB_ENCRYPTED: {
    message: "This EPUB is encrypted (DRM), so its text can't be read.",
    hint: 'Use a DRM-free copy. We neither can nor will break DRM.',
  },
  EPUB_INVALID: {
    message: "This file isn't a valid EPUB.",
    hint: 'Re-export it as EPUB 2/3, or try a TXT or PDF copy instead.',
  },
  PDF_PASSWORD: {
    message: 'This PDF is password-protected.',
    hint: 'Open it in a PDF reader, remove the password, and save a copy — then import that.',
  },
  PDF_NO_TEXT: {
    message: "This PDF has no text layer — it's most likely a scan.",
    hint: 'Run OCR on it first. Phase 1 does not include OCR.',
  },
  PDF_INVALID: {
    message: "This file isn't a readable PDF.",
    hint: 'Re-export it as PDF, or try an EPUB or TXT copy instead.',
  },
  ENCODING_UNKNOWN: {
    message: "Couldn't work out this text file's encoding.",
    hint: 'Save it as UTF-8 (or UTF-16 / GBK) and try again.',
  },
  CANCELLED: {
    message: 'Import cancelled.',
    hint: 'Start the import again when you are ready.',
  },
  EMPTY_CONTENT: {
    message: 'No readable text was found in this file.',
    hint: "Check that the file isn't empty, or that its text isn't inside images.",
  },
}

function textFor(code, values) {
  const t = IMPORT_ERRORS[code] || IMPORT_ERRORS.UNSUPPORTED_FORMAT
  const message = t.message.replace(/\{(\w+)\}/g, (_, k) => (values && k in values) ? values[k] : `{${k}}`)
  return { code, message, hint: t.hint }
}

/** 带 code / hint 的导入错误。`detail` 只进日志，不给用户看。 */
export class ImportError extends Error {
  constructor(code, detail, values) {
    const t = textFor(code, values || { max: IMPORT_LIMITS.MAX_FILE_MB })
    super(t.message)
    this.name = 'ImportError'
    this.code = t.code
    this.hint = t.hint
    if (detail !== undefined) this.detail = String(detail)
  }
}

/** 任意异常 -> ImportError。已经是 ImportError 就原样返回（别裹第二层）。 */
export function toImportError(err) {
  if (err instanceof ImportError) return err
  return new ImportError('PDF_INVALID', err && err.message ? err.message : String(err))
}

/**
 * AbortSignal 已中止就抛 CANCELLED。
 * 解析循环里每圈调一次 —— 「可取消」只有真的能在中途打断才有意义（第 5 步 5.5）。
 * 放在这里是因为 pdf.js 与 index.js 都要用同一份判断，两处各写一个迟早会漂。
 */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw new ImportError('CANCELLED')
}

/** 给 UI 用的形状：{ code, message, hint } */
export function importErrorText(err) {
  return toImportError(err)
}
