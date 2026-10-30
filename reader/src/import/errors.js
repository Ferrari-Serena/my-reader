/**
 * BYO 导入的错误口径（第 5 步 5.4）。
 *
 * 「每种失败给可读原因 + 建议动作」是 5.4 的硬要求，所以错误文本集中放这里，
 * 不让各解析器自己拼字符串 —— 否则同一类失败会冒出好几种说法。
 *
 * 消息自 2026-10-31（#35 中文 UI 第一刀）起改为中文；本文件是导入错误的唯一文案来源。
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
    message: '不支持这个文件类型。',
    hint: '用 EPUB、有文字层的 PDF，或 TXT。',
  },
  FILE_TOO_BIG: {
    message: '这个文件超过了 {max} MB 的上限。',
    hint: '把书拆成更小的文件，或换一份小于上限的。',
  },
  EPUB_ENCRYPTED: {
    message: '这本 EPUB 有加密（DRM），读不到里面的文字。',
    hint: '换一份无 DRM 的版本。我们不破解、也不会破解 DRM。',
  },
  EPUB_INVALID: {
    message: '这个文件不是有效的 EPUB。',
    hint: '重新导出成 EPUB 2／3，或改用 TXT、PDF。',
  },
  PDF_PASSWORD: {
    message: '这个 PDF 有密码。',
    hint: '在 PDF 阅读器里去掉密码、另存一份，再导入那份。',
  },
  PDF_NO_TEXT: {
    message: '这个 PDF 没有文字层——多半是扫描件。',
    hint: '扫描件识别在 M2。现在请先自行 OCR，或导入一份有文字层的版本。',
  },
  PDF_INVALID: {
    message: '这个文件不是能读的 PDF。',
    hint: '重新导出成 PDF，或改用 EPUB、TXT。',
  },
  ENCODING_UNKNOWN: {
    message: '认不出这个文本文件的编码。',
    hint: '另存为 UTF-8（或 UTF-16／GBK）再试。',
  },
  CANCELLED: {
    message: '导入已取消。',
    hint: '准备好了再导入一次。',
  },
  EMPTY_CONTENT: {
    message: '这个文件里没有可读的文字。',
    hint: '确认文件不是空的，或文字不在图片里。',
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
