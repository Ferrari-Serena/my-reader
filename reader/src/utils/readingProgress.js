/**
 * 阅读进度（章节粒度）：有 chapterIds 且有位置才算；否则 null。
 * @param {object} book 书架条目（含 chapterIds）
 * @param {(id: string) => object | null} loadPosition 位置读取函数
 */
/** 章节粒度：idx/len，0–100。 */
export function progressOfBook(book, loadPosition) {
  const ids = Array.isArray(book.chapterIds) ? book.chapterIds : []
  if (!ids.length) return null
  const pos = loadPosition(book.id)
  if (!pos) return 0
  const idx = ids.indexOf(pos.chapterId)
  if (idx < 0) return null
  return Math.max(0, Math.min(100, Math.round((idx / ids.length) * 100)))
}
