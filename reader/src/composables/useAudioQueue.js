/**
 * 播放队列（纯 JS，无 Vue 依赖）—— 供播放器 composable 与验证脚本共用。
 * 语义与播放器 UI 的「上一首／下一首／列表循环」一致：
 *   - repeat off：到末尾 next() 返回 null 并停在最后一首
 *   - repeat all：末尾 next() 回第一首、开头 prev() 回最后一首
 *   - repeat one：next()／prev() 都返回当前首（不移动）
 * 用法: const q = createAudioQueue(tracks)
 */

export function createAudioQueue(initial = []) {
  let items = Array.isArray(initial) ? initial.slice() : []
  let currentIndex = items.length ? 0 : -1
  let repeat = 'off'

  function current() {
    return items[currentIndex] ?? null
  }

  function enqueue(track) {
    items.push(track)
    if (currentIndex < 0) currentIndex = 0
    return track
  }

  function enqueueNext(track) {
    if (currentIndex < 0) return enqueue(track)
    items.splice(currentIndex + 1, 0, track)
    return track
  }

  function next() {
    if (!items.length) return null
    if (repeat === 'one') return current()
    if (currentIndex < items.length - 1) {
      currentIndex++
      return current()
    }
    if (repeat === 'all') {
      currentIndex = 0
      return current()
    }
    return null
  }

  function prev() {
    if (!items.length) return null
    if (repeat === 'one') return current()
    if (currentIndex > 0) {
      currentIndex--
      return current()
    }
    if (repeat === 'all') {
      currentIndex = items.length - 1
      return current()
    }
    return null
  }

  /** 直接把当前项定到第 i 项（clamp 到 0..length-1）；空队列返回 -1 */
  function setIndex(i) {
    if (!items.length) return -1
    const n = Math.trunc(Number(i))
    const target = Number.isFinite(n) ? n : 0
    currentIndex = Math.max(0, Math.min(target, items.length - 1))
    return currentIndex
  }

  function remove(at = currentIndex) {
    if (currentIndex < 0 || at < 0 || at >= items.length) return null
    const [removed] = items.splice(at, 1)
    if (!items.length) currentIndex = -1
    else if (at < currentIndex) currentIndex--
    else if (at === currentIndex && currentIndex >= items.length) currentIndex = items.length - 1
    return removed
  }

  function clear() {
    items = []
    currentIndex = -1
  }

  function setRepeat(mode) {
    if (mode === 'off' || mode === 'all' || mode === 'one') repeat = mode
    return repeat
  }

  function size() {
    return items.length
  }

  function getState() {
    return { currentIndex, repeat, size: items.length, current: current() }
  }

  return {
    enqueue, enqueueNext, current, next, prev, setIndex, remove, clear, setRepeat, size, getState,
  }
}
