/**
 * 离线可用（第 14 步 块 C）的**手感层**：把「现在是不是离线」摊成给用户看的一句话。
 *
 * 只认一个信号：`navigator.onLine === false`。它在浏览器里表示**明确断网**（飞行模式／网线拔了）；
 * 反过来 `true` **不代表**连得上（连着一个出不了网的 Wi-Fi 也是 true）—— 所以这里只做「false 才提示」，
 * **不替同步下「现在能推上去」的结论**：真正的判据是同步自己的成功／失败与有界退避（`composables/useSync.js` · 4.5）。
 * `onLine` 读不到（老浏览器／非浏览器）时一律当**在线** —— 宁可少提示，不可瞎提示。
 *
 * 第 4 步已经把「离线写 → 本地队列 → 恢复补推」那一半做完了（脏集合落盘、`online` 即补推、
 * 已知离线不空转定时器）；块 C 只补**看得见**的那一半：断网时告诉用户「改动存在这台机器上了」。
 */
import { ref } from 'vue'

/** 断网时那句常驻提示（短 —— 手机上要和 tabbar 抢地方） */
export const OFFLINE_MSG = 'Offline — reading works, changes are saved on this device.'

/**
 * 待上传条数那一句。**0 条回空串**：没有「待传」时不说这句话，
 * 免得「有 N 条要传」和「什么都没攒下」长得一样（与同步面板那两档文案同口径）。
 */
export function offlinePendingMsg(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0))
  if (!k) return ''
  return k === 1
    ? '1 change will upload when you are back online.'
    : `${k} changes will upload when you are back online.`
}

/** 当前是否**明确离线**（`navigator.onLine === false`） */
export const isOffline = ref(false)

/** 已挂上的监听（同一份 window 只挂一次；换 window＝重挂） */
let _bound = null

/**
 * 挂上 `online` / `offline` 监听并**立刻读一次**当前状态（页面本来就是断网打开的，这时不会有事件）。
 * 返回重读函数（单测用它驱动状态）；同一个 window 上重复调用不会重复挂监听。
 * 拿不到 navigator／window（SSR、裸 node）时是空操作并返回 `null`，状态维持原样。
 */
export function startOfflineWatch(options = {}) {
  const nav = options.navigator !== undefined ? options.navigator : (typeof navigator !== 'undefined' ? navigator : null)
  const win = options.window !== undefined ? options.window : (typeof window !== 'undefined' ? window : null)
  if (!nav || !win || typeof win.addEventListener !== 'function') return null
  const read = () => { isOffline.value = nav.onLine === false }
  read()
  if (_bound && _bound.win === win) return _bound.read
  win.addEventListener('offline', read)
  win.addEventListener('online', read)
  _bound = { win, read }
  return read
}

/** 单测用：状态清回初始 ＋ 解绑监听（免得跨用例互相干扰） */
export function resetOfflineWatch() {
  if (_bound && _bound.win && typeof _bound.win.removeEventListener === 'function') {
    _bound.win.removeEventListener('offline', _bound.read)
    _bound.win.removeEventListener('online', _bound.read)
  }
  _bound = null
  isOffline.value = false
}