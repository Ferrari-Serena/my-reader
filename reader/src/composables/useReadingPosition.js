/**
 * 阅读进度持久化 —— 退出后下次进入同一本书恢复章节 + 段落位置。
 * 与 AudioPlayer 的 reader-audio-pos:* 模式一致：独立 localStorage key，零迁移负担。
 */
const PREFIX = 'reader-reading-pos:'

export function savePosition(bookId, chapterId, paragraphIndex) {
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify({
      chapterId,
      paragraphIndex,
      updatedAt: new Date().toISOString()
    }))
  } catch { /* quota full / private mode — silently ignore */ }
}

export function loadPosition(bookId) {
  try {
    const raw = localStorage.getItem(PREFIX + bookId)
    if (!raw) return null
    const data = JSON.parse(raw)
    // 形状校验：防止脏数据导致后续 findIndex 异常
    if (data && typeof data.chapterId === 'string' && typeof data.paragraphIndex === 'number') {
      return { chapterId: data.chapterId, paragraphIndex: data.paragraphIndex }
    }
    return null
  } catch { return null }
}

export function clearPosition(bookId) {
  try { localStorage.removeItem(PREFIX + bookId) } catch { /* ignore */ }
}
