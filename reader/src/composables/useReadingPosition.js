/**
 * 阅读进度持久化 —— 退出后下次进入同一本书恢复章节 + 段落位置。
 *
 * 键格式与取值形状由 sync/progress.js 统一给出：同步层必须认得这些键才能把远程位置
 * 写回同一个 key，所以格式只能有一处定义。值里带 updatedAt 是为了 last-write-wins——
 * 纯位置没有时间戳，两台设备就没法判断谁更新。
 */

import { readingStorageKey } from '../sync/progress.js'
import { nowIso } from '../sync/clock.js'

// 懒加载 useSync：进度是「保存即要同步」的数据，但阅读页不该被同步栈的初始化拖住。
// 失败保持 undefined，下次保存还能重试。
let _syncApi = undefined

function notifySync() {
  const poke = (api) => {
    // 页面正在隐藏（切 tab / 关页）时不能等防抖定时器——它不会执行，直接 flush
    if (document.visibilityState === 'hidden') api.flushNow()
    else api.pushSoon()
  }
  if (_syncApi === undefined) {
    import('./useSync.js')
      .then(m => { _syncApi = m.useSync; return _syncApi() })
      .then(poke)
      .catch(() => { _syncApi = undefined })
  } else if (_syncApi) {
    poke(_syncApi())
  }
}

export function savePosition(bookId, chapterId, paragraphIndex) {
  if (!bookId) return
  try {
    localStorage.setItem(readingStorageKey(bookId), JSON.stringify({
      chapterId,
      paragraphIndex,
      updatedAt: nowIso()
    }))
    notifySync()
  } catch { /* quota full / private mode — silently ignore */ }
}

export function loadPosition(bookId) {
  try {
    const raw = localStorage.getItem(readingStorageKey(bookId))
    if (!raw) return null
    const data = JSON.parse(raw)
    // 形状校验：防止脏数据导致后续 findIndex 异常
    if (data && typeof data.chapterId === 'string' && typeof data.paragraphIndex === 'number') {
      return { chapterId: data.chapterId, paragraphIndex: data.paragraphIndex }
    }
    return null
  } catch { return null }
}
